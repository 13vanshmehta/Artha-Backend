import { createHash } from 'node:crypto';
import {
  AdjustmentDirection,
  PaymentMethod,
  Transaction,
  TransactionType,
} from '@prisma/client';
import { LedgerErrors } from '../shared/ledger-errors';

/**
 * The request-side view of a transaction, after DTO validation but before any
 * database lookup. `undefined` = not sent, `null` = explicitly empty.
 *
 * ADJUSTMENT is expressed as `accountId` + `direction` on the wire and stored as
 * INCREASE → destinationAccountId, DECREASE → sourceAccountId, so that every
 * balance and every filter works on source/destination alone.
 */
export interface TransactionInput {
  type: TransactionType;
  amountMinor?: bigint | null;
  occurredAt?: Date | null;
  categoryId?: string | null;
  sourceAccountId?: string | null;
  destinationAccountId?: string | null;
  accountId?: string | null;
  direction?: AdjustmentDirection | null;
  paymentMethod?: PaymentMethod | null;
  payee?: string | null;
  note?: string | null;
  relatedTransactionId?: string | null;
}

/** A fully shaped transaction, ready for ownership checks and persistence. */
export interface TransactionDraft {
  type: TransactionType;
  amountMinor: bigint;
  occurredAt: Date;
  categoryId: string | null;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  adjustmentDirection: AdjustmentDirection | null;
  paymentMethod: PaymentMethod | null;
  payee: string | null;
  note: string | null;
  relatedTransactionId: string | null;
}

type Field = keyof Omit<TransactionInput, 'type'>;

interface TypeRule {
  required: Field[];
  forbidden: Field[];
}

/**
 * Single source of truth for which fields each type needs or rejects. Mirrors
 * the DB CHECK constraint "Transaction_type_shape_check" and the table in
 * docs/API_CONTRACT.md.
 */
export const TYPE_RULES: Record<TransactionType, TypeRule> = {
  EXPENSE: {
    required: ['amountMinor', 'occurredAt', 'sourceAccountId', 'categoryId'],
    forbidden: [
      'destinationAccountId',
      'accountId',
      'direction',
      'relatedTransactionId',
    ],
  },
  INCOME: {
    required: [
      'amountMinor',
      'occurredAt',
      'destinationAccountId',
      'categoryId',
    ],
    forbidden: [
      'sourceAccountId',
      'accountId',
      'direction',
      'relatedTransactionId',
    ],
  },
  TRANSFER: {
    required: [
      'amountMinor',
      'occurredAt',
      'sourceAccountId',
      'destinationAccountId',
    ],
    forbidden: ['categoryId', 'accountId', 'direction', 'relatedTransactionId'],
  },
  REFUND: {
    required: ['amountMinor', 'occurredAt', 'destinationAccountId'],
    forbidden: ['sourceAccountId', 'accountId', 'direction'],
  },
  ADJUSTMENT: {
    required: ['amountMinor', 'occurredAt', 'accountId', 'direction', 'note'],
    forbidden: [
      'sourceAccountId',
      'destinationAccountId',
      'categoryId',
      'relatedTransactionId',
      'paymentMethod',
    ],
  },
};

const isPresent = (v: unknown) => v !== undefined && v !== null && v !== '';

/**
 * Applies the per-type rules. Reports every violation at once so the client can
 * highlight all bad fields in a single round trip.
 */
export function buildDraft(input: TransactionInput): TransactionDraft {
  const rule = TYPE_RULES[input.type];
  const violations: Array<{ field: string; message: string }> = [];

  for (const field of rule.required) {
    if (!isPresent(input[field])) {
      violations.push({
        field,
        message: `${field} is required for ${input.type}.`,
      });
    }
  }
  for (const field of rule.forbidden) {
    if (isPresent(input[field])) {
      violations.push({
        field,
        message: `${field} is not allowed for ${input.type}.`,
      });
    }
  }
  if (
    input.type === TransactionType.TRANSFER &&
    isPresent(input.sourceAccountId) &&
    input.sourceAccountId === input.destinationAccountId
  ) {
    violations.push({
      field: 'destinationAccountId',
      message: 'A transfer needs two different accounts.',
    });
  }

  if (violations.length > 0) {
    throw LedgerErrors.invalidShape(
      violations.map((v) => v.message).join(' '),
      {
        fieldErrors: violations,
      },
    );
  }

  const isAdjustment = input.type === TransactionType.ADJUSTMENT;
  const direction = isAdjustment
    ? (input.direction as AdjustmentDirection)
    : null;

  return {
    type: input.type,
    amountMinor: input.amountMinor as bigint,
    occurredAt: input.occurredAt as Date,
    categoryId: input.categoryId ?? null,
    sourceAccountId: isAdjustment
      ? direction === AdjustmentDirection.DECREASE
        ? (input.accountId as string)
        : null
      : (input.sourceAccountId ?? null),
    destinationAccountId: isAdjustment
      ? direction === AdjustmentDirection.INCREASE
        ? (input.accountId as string)
        : null
      : (input.destinationAccountId ?? null),
    adjustmentDirection: direction,
    paymentMethod: input.paymentMethod ?? null,
    payee: input.payee ?? null,
    note: input.note ?? null,
    relatedTransactionId: input.relatedTransactionId ?? null,
  };
}

/** Rebuilds the request-side view of a stored transaction (used to merge PATCHes). */
export function inputFromStored(t: Transaction): TransactionInput {
  const isAdjustment = t.type === TransactionType.ADJUSTMENT;
  return {
    type: t.type,
    amountMinor: t.amountMinor,
    occurredAt: t.occurredAt,
    categoryId: t.categoryId,
    sourceAccountId: isAdjustment ? undefined : t.sourceAccountId,
    destinationAccountId: isAdjustment ? undefined : t.destinationAccountId,
    accountId: isAdjustment
      ? (t.destinationAccountId ?? t.sourceAccountId)
      : undefined,
    direction: t.adjustmentDirection ?? undefined,
    paymentMethod: t.paymentMethod,
    payee: t.payee,
    note: t.note,
    relatedTransactionId: t.relatedTransactionId,
  };
}

/** Overlays a PATCH (undefined = keep, null = clear) on a stored transaction. */
export function mergePatch(
  base: TransactionInput,
  patch: Omit<TransactionInput, 'type'>,
): TransactionInput {
  const merged: TransactionInput = { ...base };
  for (const [key, value] of Object.entries(patch) as Array<[Field, unknown]>) {
    if (value !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/**
 * Fingerprint of a create request's financial content. A retry with the same
 * clientTransactionId and the same fingerprint is a replay; a different
 * fingerprint means the client reused the key for a different entry.
 */
export function fingerprintDraft(draft: TransactionDraft): string {
  const canonical = JSON.stringify([
    draft.type,
    draft.amountMinor.toString(),
    draft.occurredAt.toISOString(),
    draft.categoryId,
    draft.sourceAccountId,
    draft.destinationAccountId,
    draft.adjustmentDirection,
    draft.paymentMethod,
    draft.payee,
    draft.note,
    draft.relatedTransactionId,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** The category type a transaction type needs, or null if it takes no category. */
export function expectedCategoryType(
  type: TransactionType,
): 'INCOME' | 'EXPENSE' | null {
  switch (type) {
    case TransactionType.INCOME:
      return 'INCOME';
    case TransactionType.EXPENSE:
    case TransactionType.REFUND:
      return 'EXPENSE';
    default:
      return null;
  }
}
