import { BadRequestException, Injectable } from '@nestjs/common';
import { Account, AccountType, Prisma } from '@prisma/client';
import { minorToString } from '../../common/money/money';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerErrors } from '../shared/ledger-errors';
import { CreateAccountDto, UpdateAccountDto } from './accounts.dto';

export interface AccountView {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalanceMinor: string;
  currentBalanceMinor: string;
  isDefault: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

type Db = PrismaService | Prisma.TransactionClient;

const DEFAULT_CASH_ACCOUNT = {
  name: 'Cash',
  type: AccountType.CASH,
  currency: 'INR',
};

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gives a brand-new user a single real "Cash" account (zero balance) the first
   * time they touch the ledger. Never creates bank accounts or balances.
   * Concurrent first calls are safe: the partial unique indexes turn the losing
   * insert into a no-op.
   */
  async ensureDefaultAccount(userId: string): Promise<void> {
    const existing = await this.prisma.account.count({ where: { userId } });
    if (existing > 0) return;
    await this.prisma.account.createMany({
      data: [{ ...DEFAULT_CASH_ACCOUNT, userId, isDefault: true }],
      skipDuplicates: true,
    });
  }

  async list(userId: string, includeArchived: boolean): Promise<AccountView[]> {
    await this.ensureDefaultAccount(userId);
    const accounts = await this.prisma.account.findMany({
      where: { userId, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [
        { isDefault: 'desc' },
        { isArchived: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    });
    const balances = await this.balances(
      userId,
      accounts.map((a) => a.id),
    );
    return accounts.map((a) => this.serialize(a, balances.get(a.id) ?? 0n));
  }

  async get(userId: string, accountId: string): Promise<AccountView> {
    const account = await this.findOwned(userId, accountId);
    const balances = await this.balances(userId, [account.id]);
    return this.serialize(account, balances.get(account.id) ?? 0n);
  }

  async create(userId: string, dto: CreateAccountDto): Promise<AccountView> {
    try {
      const account = await this.prisma.$transaction(async (tx) => {
        const hasDefault = await tx.account.count({
          where: { userId, isDefault: true },
        });
        const makeDefault = dto.isDefault === true || hasDefault === 0;
        if (makeDefault) {
          await tx.account.updateMany({
            where: { userId, isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.account.create({
          data: {
            userId,
            name: dto.name,
            type: dto.type,
            currency: dto.currency ?? 'INR',
            openingBalanceMinor:
              dto.openingBalanceMinor ??
              dto.initialBalanceMinor ??
              dto.initialBalance ??
              0n,
            isDefault: makeDefault,
          },
        });
      });
      return this.serialize(account, 0n);
    } catch (err) {
      if (isUniqueViolation(err)) throw LedgerErrors.duplicateName('account');
      throw err;
    }
  }

  async update(
    userId: string,
    accountId: string,
    dto: UpdateAccountDto,
  ): Promise<AccountView> {
    const current = await this.findOwned(userId, accountId);
    if (dto.isDefault === false) {
      throw new BadRequestException({
        errorCode: 'VALIDATION_ERROR',
        message:
          'isDefault only accepts true. Make another account the default instead.',
      });
    }
    const willBeArchived = dto.isArchived ?? current.isArchived;
    if (dto.isDefault === true && willBeArchived) {
      throw LedgerErrors.accountArchived();
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault === true && !current.isDefault) {
          await tx.account.updateMany({
            where: { userId, isDefault: true },
            data: { isDefault: false },
          });
        }
        await tx.account.update({
          where: { id: current.id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.type !== undefined ? { type: dto.type } : {}),
            ...(dto.openingBalanceMinor !== undefined
              ? { openingBalanceMinor: dto.openingBalanceMinor }
              : {}),
            ...(dto.isDefault === true ? { isDefault: true } : {}),
            ...(dto.isArchived !== undefined
              ? { isArchived: dto.isArchived }
              : {}),
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw LedgerErrors.duplicateName('account');
      throw err;
    }
    return this.get(userId, accountId);
  }

  /**
   * Accounts are archived, never deleted: historical transactions keep pointing
   * at them. If the default is archived, the oldest remaining active account
   * becomes the default.
   */
  async archive(userId: string, accountId: string): Promise<AccountView> {
    const current = await this.findOwned(userId, accountId);
    if (!current.isArchived) {
      await this.prisma.$transaction(async (tx) => {
        await tx.account.update({
          where: { id: current.id },
          data: { isArchived: true, isDefault: false },
        });
        if (current.isDefault) {
          const successor = await tx.account.findFirst({
            where: { userId, isArchived: false },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
          if (successor) {
            await tx.account.update({
              where: { id: successor.id },
              data: { isDefault: true },
            });
          }
        }
      });
    }
    return this.get(userId, accountId);
  }

  async findOwned(
    userId: string,
    accountId: string,
    db: Db = this.prisma,
  ): Promise<Account> {
    const account = await db.account.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) throw LedgerErrors.accountNotFound();
    return account;
  }

  /**
   * Current balance = opening balance + money in − money out, over non-deleted
   * transactions. Every type is expressed through source (out) and destination
   * (in) accounts, so this is exact for all five types: INCOME/REFUND/
   * ADJUSTMENT+INCREASE credit the destination, EXPENSE/ADJUSTMENT+DECREASE
   * debit the source, TRANSFER does both.
   */
  async balances(
    userId: string,
    accountIds: string[],
    db: Db = this.prisma,
  ): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>();
    if (accountIds.length === 0) return result;

    const [accounts, outflows, inflows] = await Promise.all([
      db.account.findMany({
        where: { userId, id: { in: accountIds } },
        select: { id: true, openingBalanceMinor: true },
      }),
      db.transaction.groupBy({
        by: ['sourceAccountId'],
        where: { userId, deletedAt: null, sourceAccountId: { in: accountIds } },
        _sum: { amountMinor: true },
      }),
      db.transaction.groupBy({
        by: ['destinationAccountId'],
        where: {
          userId,
          deletedAt: null,
          destinationAccountId: { in: accountIds },
        },
        _sum: { amountMinor: true },
      }),
    ]);

    for (const a of accounts) result.set(a.id, a.openingBalanceMinor);
    for (const row of inflows) {
      if (row.destinationAccountId) {
        result.set(
          row.destinationAccountId,
          (result.get(row.destinationAccountId) ?? 0n) +
            (row._sum.amountMinor ?? 0n),
        );
      }
    }
    for (const row of outflows) {
      if (row.sourceAccountId) {
        result.set(
          row.sourceAccountId,
          (result.get(row.sourceAccountId) ?? 0n) -
            (row._sum.amountMinor ?? 0n),
        );
      }
    }
    return result;
  }

  serialize(account: Account, balance: bigint): AccountView {
    return {
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      openingBalanceMinor: minorToString(account.openingBalanceMinor),
      currentBalanceMinor: minorToString(balance),
      isDefault: account.isDefault,
      isArchived: account.isArchived,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }
}
