import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Transaction, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addDays,
  formatLocalDate,
  localDateOf,
  resolvePeriod,
  toUtcRange,
} from '../../common/time/local-calendar';
import { resolveOpenRange } from '../shared/date-range';
import { LedgerErrors } from '../shared/ledger-errors';
import {
  buildDraft,
  expectedCategoryType,
  fingerprintDraft,
  inputFromStored,
  mergePatch,
  TransactionDraft,
} from './transaction-rules';
import {
  afterCursor,
  decodeCursor,
  encodeCursor,
  orderByFor,
} from './transaction-query';
import {
  serializeTransaction,
  TRANSACTION_INCLUDE,
  TransactionView,
} from './transaction.serializer';
import {
  CreateTransactionDto,
  ListTransactionsQueryDto,
  TransactionSort,
  UpdateTransactionDto,
} from './transactions.dto';

type Tx = Prisma.TransactionClient;

const EARLIEST_OCCURRED_AT = new Date('2000-01-01T00:00:00Z');
/** Allow a day of clock skew / time-zone slop for "now" entries. */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 25;
const RECENT_MAX_ITEMS = 300;

export interface CreateResult {
  transaction: TransactionView;
  /** true when this request was a retry of an already-recorded transaction. */
  replayed: boolean;
}

export interface TransactionPage {
  items: TransactionView[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface RecentDay {
  date: string;
  label: 'TODAY' | 'YESTERDAY' | 'TWO_DAYS_AGO';
  items: TransactionView[];
}

function parseOccurredAt(
  value: string | undefined,
  now = new Date(),
): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (
    Number.isNaN(date.getTime()) ||
    date < EARLIEST_OCCURRED_AT ||
    date.getTime() > now.getTime() + MAX_FUTURE_MS
  ) {
    throw new BadRequestException({
      errorCode: 'INVALID_OCCURRED_AT',
      message:
        'occurredAt must be a real date between 2000-01-01 and tomorrow.',
    });
  }
  return date;
}

function isClientIdConflict(err: unknown): boolean {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== 'P2002'
  ) {
    return false;
  }
  const target = err.meta?.target;
  const text = Array.isArray(target)
    ? target.join(',')
    : typeof target === 'string'
      ? target
      : '';
  return text.includes('clientTransactionId');
}

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- create

  /**
   * Idempotent create. The (userId, clientTransactionId) unique index is the
   * arbiter: a retry — sequential or concurrent — never inserts a second row.
   * Same key + same content → the original is returned (replayed = true).
   * Same key + different content → 409 IDEMPOTENCY_KEY_REUSED.
   */
  async create(
    userId: string,
    dto: CreateTransactionDto,
  ): Promise<CreateResult> {
    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    let categoryId =
      dto.categoryId && UUID_REGEX.test(dto.categoryId)
        ? dto.categoryId
        : undefined;

    if (!categoryId && dto.category) {
      const expectedType = expectedCategoryType(dto.type);
      const match = await this.prisma.category.findFirst({
        where: {
          name: { equals: dto.category.trim(), mode: 'insensitive' },
          ...(expectedType ? { type: expectedType } : {}),
          OR: [{ isSystem: true }, { userId }],
        },
      });
      if (match) {
        categoryId = match.id;
      } else if (expectedType) {
        const fallback = await this.prisma.category.findFirst({
          where: {
            type: expectedType,
            OR: [{ isSystem: true }, { userId }],
          },
          orderBy: { isSystem: 'desc' },
        });
        if (fallback) categoryId = fallback.id;
      }
    }

    let sourceAccountId =
      dto.sourceAccountId ??
      (dto.type === TransactionType.EXPENSE ||
      dto.type === TransactionType.TRANSFER
        ? dto.accountId
        : undefined);
    let destinationAccountId =
      dto.destinationAccountId ??
      (dto.type === TransactionType.INCOME ||
      dto.type === TransactionType.REFUND
        ? dto.accountId
        : dto.type === TransactionType.TRANSFER
        ? dto.destinationAccountId
        : undefined);

    if (sourceAccountId && !UUID_REGEX.test(sourceAccountId)) {
      const defaultAcc =
        (await this.prisma.account.findFirst({
          where: { userId, isDefault: true },
        })) ??
        (await this.prisma.account.findFirst({ where: { userId } }));
      sourceAccountId = defaultAcc?.id;
    }

    if (destinationAccountId && !UUID_REGEX.test(destinationAccountId)) {
      const defaultAcc =
        (await this.prisma.account.findFirst({
          where: { userId, isDefault: true },
        })) ??
        (await this.prisma.account.findFirst({ where: { userId } }));
      destinationAccountId = defaultAcc?.id;
    }

    const draft = buildDraft({
      type: dto.type,
      amountMinor:
        dto.amountMinor ??
        (dto.amount !== undefined
          ? BigInt(Math.round(Number(dto.amount) * 100))
          : undefined),
      occurredAt: parseOccurredAt(dto.occurredAt ?? dto.incurredAt),
      categoryId,
      sourceAccountId,
      destinationAccountId,
      accountId:
        dto.type === TransactionType.ADJUSTMENT ? dto.accountId : undefined,
      direction: dto.direction ?? dto.adjustmentDirection,
      paymentMethod: dto.paymentMethod,
      payee: dto.payee ?? dto.merchant,
      note: dto.note ?? dto.reason ?? dto.notes,
      relatedTransactionId:
        dto.relatedTransactionId ?? dto.originalTransactionId,
    });
    const fingerprint = fingerprintDraft(draft);

    const prior = await this.findByClientId(userId, dto.clientTransactionId);
    if (prior) return this.replay(prior, fingerprint);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const resolved = await this.resolveReferences(tx, userId, draft, null);
        return tx.transaction.create({
          data: {
            userId,
            ...draft,
            categoryId: resolved.categoryId,
            currency: resolved.currency,
            clientTransactionId: dto.clientTransactionId,
            requestFingerprint: fingerprint,
          },
          include: TRANSACTION_INCLUDE,
        });
      });
      return { transaction: serializeTransaction(created), replayed: false };
    } catch (err) {
      if (isClientIdConflict(err)) {
        const winner = await this.findByClientId(
          userId,
          dto.clientTransactionId,
        );
        if (winner) return this.replay(winner, fingerprint);
      }
      throw err;
    }
  }

  private async findByClientId(userId: string, clientTransactionId: string) {
    return this.prisma.transaction.findUnique({
      where: { userId_clientTransactionId: { userId, clientTransactionId } },
      include: TRANSACTION_INCLUDE,
    });
  }

  private replay(
    existing: Prisma.TransactionGetPayload<{
      include: typeof TRANSACTION_INCLUDE;
    }>,
    fingerprint: string,
  ): CreateResult {
    if (existing.requestFingerprint !== fingerprint) {
      throw LedgerErrors.idempotencyKeyReused();
    }
    return { transaction: serializeTransaction(existing), replayed: true };
  }

  // ---------------------------------------------------------------- read

  async get(userId: string, id: string): Promise<TransactionView> {
    const t = await this.prisma.transaction.findFirst({
      where: { id, userId },
      include: TRANSACTION_INCLUDE,
    });
    if (!t) throw LedgerErrors.transactionNotFound();
    return serializeTransaction(t);
  }

  async list(
    userId: string,
    timezone: string,
    q: ListTransactionsQueryDto,
  ): Promise<TransactionPage> {
    const sort: TransactionSort = q.sort ?? 'NEWEST';
    const limit = q.limit ?? DEFAULT_PAGE_SIZE;
    if (
      q.minAmount !== undefined &&
      q.maxAmount !== undefined &&
      q.minAmount > q.maxAmount
    ) {
      throw new BadRequestException({
        errorCode: 'VALIDATION_ERROR',
        message: 'minAmount must not exceed maxAmount.',
      });
    }
    const range = resolveOpenRange(q, timezone);

    const and: Prisma.TransactionWhereInput[] = [];
    if (range.startUtc || range.endUtc) {
      and.push({
        occurredAt: {
          ...(range.startUtc ? { gte: range.startUtc } : {}),
          ...(range.endUtc ? { lt: range.endUtc } : {}),
        },
      });
    }
    if (q.type?.length) and.push({ type: { in: q.type } });
    if (q.categoryIds?.length) and.push({ categoryId: { in: q.categoryIds } });
    if (q.accountIds?.length) {
      and.push({
        OR: [
          { sourceAccountId: { in: q.accountIds } },
          { destinationAccountId: { in: q.accountIds } },
        ],
      });
    }
    if (q.paymentMethods?.length)
      and.push({ paymentMethod: { in: q.paymentMethods } });
    if (q.minAmount !== undefined || q.maxAmount !== undefined) {
      and.push({
        amountMinor: {
          ...(q.minAmount !== undefined ? { gte: q.minAmount } : {}),
          ...(q.maxAmount !== undefined ? { lte: q.maxAmount } : {}),
        },
      });
    }
    if (q.search) {
      // Prisma parameterises this; it is always ANDed with userId below, so a
      // search can never reach another user's rows.
      const match = { contains: q.search, mode: 'insensitive' as const };
      and.push({
        OR: [{ payee: match }, { note: match }, { category: { name: match } }],
      });
    }
    if (q.cursor) and.push(afterCursor(sort, decodeCursor(q.cursor, sort)));

    const rows = await this.prisma.transaction.findMany({
      where: { userId, deletedAt: null, AND: and },
      orderBy: orderByFor(sort),
      take: limit + 1,
      include: TRANSACTION_INCLUDE,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(serializeTransaction),
      nextCursor: hasMore && last ? encodeCursor(sort, last) : null,
      hasMore,
    };
  }

  /** Today, yesterday and the day before, as local calendar days in `timezone`. */
  async recent(
    userId: string,
    timezone: string,
    now = new Date(),
  ): Promise<{ timezone: string; days: RecentDay[]; truncated: boolean }> {
    const today = localDateOf(now, timezone);
    const { startUtc, endUtc } = toUtcRange(
      resolvePeriod('LAST_3_DAYS', today),
      timezone,
    );
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        occurredAt: { gte: startUtc, lt: endUtc },
      },
      orderBy: orderByFor('NEWEST'),
      take: RECENT_MAX_ITEMS + 1,
      include: TRANSACTION_INCLUDE,
    });
    const truncated = rows.length > RECENT_MAX_ITEMS;
    const labels: RecentDay['label'][] = ['TODAY', 'YESTERDAY', 'TWO_DAYS_AGO'];
    const days: RecentDay[] = labels.map((label, i) => ({
      date: formatLocalDate(addDays(today, -i)),
      label,
      items: [],
    }));
    const byDate = new Map(days.map((d) => [d.date, d]));
    for (const row of rows.slice(0, RECENT_MAX_ITEMS)) {
      byDate
        .get(formatLocalDate(localDateOf(row.occurredAt, timezone)))
        ?.items.push(serializeTransaction(row));
    }
    return { timezone, days, truncated };
  }

  // ---------------------------------------------------------------- update

  async update(
    userId: string,
    id: string,
    dto: UpdateTransactionDto,
  ): Promise<TransactionView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, userId, id);
      const current = await this.findOwned(tx, userId, id);
      if (current.deletedAt) throw LedgerErrors.transactionDeleted();

      const UUID_REGEX =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      let categoryId =
        dto.categoryId && UUID_REGEX.test(dto.categoryId)
          ? dto.categoryId
          : undefined;

      if (!categoryId && dto.category && typeof dto.category === 'string') {
        const expectedType = expectedCategoryType(current.type);
        const match = await this.prisma.category.findFirst({
          where: {
            name: { equals: dto.category.trim(), mode: 'insensitive' },
            ...(expectedType ? { type: expectedType } : {}),
            OR: [{ isSystem: true }, { userId }],
          },
        });
        if (match) categoryId = match.id;
      }

      let sourceAccountId =
        dto.sourceAccountId ??
        (current.type === TransactionType.EXPENSE ||
        current.type === TransactionType.TRANSFER
          ? dto.accountId
          : undefined);
      let destinationAccountId =
        dto.destinationAccountId ??
        (current.type === TransactionType.INCOME ||
        current.type === TransactionType.REFUND
          ? dto.accountId
          : current.type === TransactionType.TRANSFER
          ? dto.destinationAccountId
          : undefined);

      if (sourceAccountId && !UUID_REGEX.test(sourceAccountId)) {
        const defaultAcc =
          (await this.prisma.account.findFirst({
            where: { userId, isDefault: true },
          })) ??
          (await this.prisma.account.findFirst({ where: { userId } }));
        sourceAccountId = defaultAcc?.id;
      }

      if (destinationAccountId && !UUID_REGEX.test(destinationAccountId)) {
        const defaultAcc =
          (await this.prisma.account.findFirst({
            where: { userId, isDefault: true },
          })) ??
          (await this.prisma.account.findFirst({ where: { userId } }));
        destinationAccountId = defaultAcc?.id;
      }

      const draft = buildDraft(
        mergePatch(inputFromStored(current), {
          amountMinor:
            dto.amountMinor ??
            (dto.amount !== undefined
              ? BigInt(Math.round(Number(dto.amount) * 100))
              : undefined),
          occurredAt: parseOccurredAt(dto.occurredAt ?? dto.incurredAt),
          categoryId,
          sourceAccountId,
          destinationAccountId,
          accountId:
            current.type === TransactionType.ADJUSTMENT ? dto.accountId : undefined,
          direction: dto.direction ?? dto.adjustmentDirection,
          paymentMethod: dto.paymentMethod,
          payee: dto.payee ?? dto.merchant,
          note: dto.note !== undefined ? dto.note : (dto.reason ?? dto.notes),
          relatedTransactionId:
            dto.relatedTransactionId ?? dto.originalTransactionId,
        }),
      );
      const resolved = await this.resolveReferences(tx, userId, draft, current);

      if (
        current.type === TransactionType.EXPENSE &&
        draft.amountMinor < current.amountMinor
      ) {
        const refunded = await this.refundedAgainst(tx, current.id);
        if (draft.amountMinor < refunded)
          throw LedgerErrors.amountBelowRefunded(refunded);
      }

      // requestFingerprint is left as-is: it describes the original create
      // request, so a late retry of that request still replays cleanly.
      return tx.transaction.update({
        where: { id: current.id },
        data: {
          amountMinor: draft.amountMinor,
          occurredAt: draft.occurredAt,
          categoryId: resolved.categoryId,
          sourceAccountId: draft.sourceAccountId,
          destinationAccountId: draft.destinationAccountId,
          adjustmentDirection: draft.adjustmentDirection,
          paymentMethod: draft.paymentMethod,
          payee: draft.payee,
          note: draft.note,
          relatedTransactionId: draft.relatedTransactionId,
          currency: resolved.currency,
        },
        include: TRANSACTION_INCLUDE,
      });
    });
    return serializeTransaction(updated);
  }

  // ---------------------------------------------------------------- delete / restore

  /** Soft delete. Idempotent. An expense with live refunds must lose them first. */
  async remove(userId: string, id: string): Promise<TransactionView> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, userId, id);
      const current = await this.findOwned(tx, userId, id);
      if (current.deletedAt) return current;
      if (
        current.type === TransactionType.EXPENSE &&
        (await this.refundedAgainst(tx, current.id)) > 0n
      ) {
        throw LedgerErrors.transactionHasRefunds();
      }
      return tx.transaction.update({
        where: { id: current.id },
        data: { deletedAt: new Date() },
      });
    });
    return this.get(userId, result.id);
  }

  /** Undo for delete. Idempotent. A refund is re-checked against its expense. */
  async restore(userId: string, id: string): Promise<TransactionView> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, userId, id);
      const current = await this.findOwned(tx, userId, id);
      if (!current.deletedAt) return;
      if (
        current.type === TransactionType.REFUND &&
        current.relatedTransactionId
      ) {
        const original = await this.lockedOriginalExpense(
          tx,
          userId,
          current.relatedTransactionId,
        );
        if (original.deletedAt) {
          throw LedgerErrors.invalidRelatedTransaction(
            'Restore the original expense before restoring its refund.',
          );
        }
        const refunded = await this.refundedAgainst(tx, original.id);
        const remaining = original.amountMinor - refunded;
        if (current.amountMinor > remaining)
          throw LedgerErrors.refundExceedsOriginal(remaining);
      }
      await tx.transaction.update({
        where: { id: current.id },
        data: { deletedAt: null },
      });
    });
    return this.get(userId, id);
  }

  // ---------------------------------------------------------------- shared checks

  private async findOwned(
    tx: Tx,
    userId: string,
    id: string,
  ): Promise<Transaction> {
    const t = await tx.transaction.findFirst({ where: { id, userId } });
    if (!t) throw LedgerErrors.transactionNotFound();
    return t;
  }

  /** Row lock; parameterised raw SQL is the only way to express FOR UPDATE in Prisma. */
  private async lockRow(tx: Tx, userId: string, id: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM "Transaction" WHERE "id" = ${id}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
  }

  private async refundedAgainst(
    tx: Tx,
    expenseId: string,
    excludeId?: string,
  ): Promise<bigint> {
    const agg = await tx.transaction.aggregate({
      where: {
        relatedTransactionId: expenseId,
        type: TransactionType.REFUND,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      _sum: { amountMinor: true },
    });
    return agg._sum.amountMinor ?? 0n;
  }

  private async lockedOriginalExpense(
    tx: Tx,
    userId: string,
    relatedId: string,
  ): Promise<Transaction> {
    await this.lockRow(tx, userId, relatedId);
    const original = await tx.transaction.findFirst({
      where: { id: relatedId, userId },
    });
    if (!original) throw LedgerErrors.relatedTransactionNotFound();
    return original;
  }

  /**
   * Ownership and integrity checks for every id a draft references. Anything
   * not owned by `userId` is reported as not found. Archived accounts and
   * categories may stay on an edited transaction but cannot be newly attached.
   * Returns the currency (from the accounts) and the final category (a refund
   * inherits its expense's category when none is given).
   */
  private async resolveReferences(
    tx: Tx,
    userId: string,
    draft: TransactionDraft,
    current: Transaction | null,
  ): Promise<{ currency: string; categoryId: string | null }> {
    const accountIds = [
      draft.sourceAccountId,
      draft.destinationAccountId,
    ].filter((v): v is string => v !== null);
    const currentAccountIds = new Set(
      [current?.sourceAccountId, current?.destinationAccountId].filter(Boolean),
    );
    const accounts = await tx.account.findMany({
      where: { userId, id: { in: accountIds } },
    });
    if (accounts.length !== new Set(accountIds).size)
      throw LedgerErrors.accountNotFound();
    for (const a of accounts) {
      if (a.isArchived && !currentAccountIds.has(a.id))
        throw LedgerErrors.accountArchived();
    }
    const currencies = new Set(accounts.map((a) => a.currency));
    if (currencies.size !== 1) throw LedgerErrors.currencyMismatch();
    const [currency] = currencies;

    let categoryId = draft.categoryId;

    if (draft.type === TransactionType.REFUND && draft.relatedTransactionId) {
      if (draft.relatedTransactionId === current?.id) {
        throw LedgerErrors.invalidRelatedTransaction(
          'A refund cannot refer to itself.',
        );
      }
      const original = await this.lockedOriginalExpense(
        tx,
        userId,
        draft.relatedTransactionId,
      );
      if (original.type !== TransactionType.EXPENSE) {
        throw LedgerErrors.invalidRelatedTransaction(
          'Only an EXPENSE can be refunded.',
        );
      }
      if (original.deletedAt) {
        throw LedgerErrors.invalidRelatedTransaction(
          'The original expense has been deleted.',
        );
      }
      if (original.currency !== currency) throw LedgerErrors.currencyMismatch();
      const refunded = await this.refundedAgainst(tx, original.id, current?.id);
      const remaining = original.amountMinor - refunded;
      if (draft.amountMinor > remaining)
        throw LedgerErrors.refundExceedsOriginal(remaining);
      categoryId = categoryId ?? original.categoryId;
    }

    if (categoryId) {
      const category = await tx.category.findFirst({
        where: { id: categoryId, OR: [{ isSystem: true }, { userId }] },
      });
      if (!category) throw LedgerErrors.categoryNotFound();
      if (category.isArchived && category.id !== current?.categoryId) {
        throw LedgerErrors.categoryArchived();
      }
      const expected = expectedCategoryType(draft.type);
      if (expected && category.type !== expected) {
        throw LedgerErrors.categoryTypeMismatch(expected);
      }
    }

    return { currency, categoryId };
  }
}
