import {
  Account,
  AdjustmentDirection,
  Category,
  PaymentMethod,
  Prisma,
  Transaction,
  TransactionSource,
  TransactionType,
} from '@prisma/client';
import { minorToString } from '../../common/money/money';

/** Relations loaded with every transaction response. Kept minimal on purpose. */
export const TRANSACTION_INCLUDE = {
  category: true,
  sourceAccount: true,
  destinationAccount: true,
} satisfies Prisma.TransactionInclude;

export type TransactionWithRelations = Transaction & {
  category: Category | null;
  sourceAccount: Account | null;
  destinationAccount: Account | null;
};

interface AccountRef {
  id: string;
  name: string;
  type: Account['type'];
  isArchived: boolean;
}

interface CategoryRef {
  id: string;
  name: string;
  type: Category['type'];
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  isArchived: boolean;
}

export interface TransactionView {
  id: string;
  type: TransactionType;
  amountMinor: string;
  currency: string;
  occurredAt: string;
  categoryId: string | null;
  category: CategoryRef | null;
  sourceAccountId: string | null;
  sourceAccount: AccountRef | null;
  destinationAccountId: string | null;
  destinationAccount: AccountRef | null;
  /** ADJUSTMENT only: the corrected account (mirrors the request field). */
  accountId: string | null;
  direction: AdjustmentDirection | null;
  paymentMethod: PaymentMethod | null;
  payee: string | null;
  note: string | null;
  relatedTransactionId: string | null;
  source: TransactionSource;
  clientTransactionId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

const accountRef = (a: Account | null): AccountRef | null =>
  a ? { id: a.id, name: a.name, type: a.type, isArchived: a.isArchived } : null;

export function serializeTransaction(
  t: TransactionWithRelations,
): TransactionView {
  return {
    id: t.id,
    type: t.type,
    amountMinor: minorToString(t.amountMinor),
    currency: t.currency,
    occurredAt: t.occurredAt.toISOString(),
    categoryId: t.categoryId,
    category: t.category
      ? {
          id: t.category.id,
          name: t.category.name,
          type: t.category.type,
          icon: t.category.icon,
          color: t.category.color,
          isSystem: t.category.isSystem,
          isArchived: t.category.isArchived,
        }
      : null,
    sourceAccountId: t.sourceAccountId,
    sourceAccount: accountRef(t.sourceAccount),
    destinationAccountId: t.destinationAccountId,
    destinationAccount: accountRef(t.destinationAccount),
    accountId:
      t.type === TransactionType.ADJUSTMENT
        ? (t.destinationAccountId ?? t.sourceAccountId)
        : null,
    direction: t.adjustmentDirection,
    paymentMethod: t.paymentMethod,
    payee: t.payee,
    note: t.note,
    relatedTransactionId: t.relatedTransactionId,
    source: t.source,
    clientTransactionId: t.clientTransactionId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
  };
}
