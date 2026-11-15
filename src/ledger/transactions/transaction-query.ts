import { Prisma } from '@prisma/client';
import { parseMinorUnits } from '../../common/money/money';
import { LedgerErrors } from '../shared/ledger-errors';
import { TransactionSort } from './transactions.dto';

/**
 * Keyset pagination. Every sort ends in `id` so the order is total and stable:
 * rows inserted or deleted between pages can never cause a row to repeat or be
 * skipped among rows that existed when the first page was read.
 */
export function orderByFor(
  sort: TransactionSort,
): Prisma.TransactionOrderByWithRelationInput[] {
  switch (sort) {
    case 'NEWEST':
      return [{ occurredAt: 'desc' }, { id: 'desc' }];
    case 'OLDEST':
      return [{ occurredAt: 'asc' }, { id: 'asc' }];
    case 'HIGHEST_AMOUNT':
      return [{ amountMinor: 'desc' }, { occurredAt: 'desc' }, { id: 'desc' }];
    case 'LOWEST_AMOUNT':
      return [{ amountMinor: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }];
  }
}

interface CursorPayload {
  v: 1;
  s: TransactionSort;
  t: string;
  i: string;
  a?: string;
}

export interface CursorRow {
  id: string;
  occurredAt: Date;
  amountMinor: bigint;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(sort: TransactionSort, row: CursorRow): string {
  const payload: CursorPayload = {
    v: 1,
    s: sort,
    t: row.occurredAt.toISOString(),
    i: row.id,
    ...(sort === 'HIGHEST_AMOUNT' || sort === 'LOWEST_AMOUNT'
      ? { a: row.amountMinor.toString() }
      : {}),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string, sort: TransactionSort): CursorRow {
  let payload: Partial<CursorPayload>;
  try {
    payload = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<CursorPayload>;
  } catch {
    throw LedgerErrors.invalidCursor();
  }
  const occurredAt =
    typeof payload.t === 'string' ? new Date(payload.t) : undefined;
  const needsAmount = sort === 'HIGHEST_AMOUNT' || sort === 'LOWEST_AMOUNT';
  const amount = needsAmount ? parseMinorUnits(payload.a) : 0n;
  if (
    payload?.v !== 1 ||
    payload.s !== sort ||
    typeof payload.i !== 'string' ||
    !UUID.test(payload.i) ||
    !occurredAt ||
    Number.isNaN(occurredAt.getTime()) ||
    amount === undefined
  ) {
    throw LedgerErrors.invalidCursor();
  }
  return { id: payload.i, occurredAt, amountMinor: amount };
}

/** Rows strictly after `cursor` in `sort` order (lexicographic tuple comparison). */
export function afterCursor(
  sort: TransactionSort,
  cursor: CursorRow,
): Prisma.TransactionWhereInput {
  const desc = sort === 'NEWEST' || sort === 'HIGHEST_AMOUNT';
  const cmp = desc ? 'lt' : 'gt';
  const byTimeThenId: Prisma.TransactionWhereInput[] = [
    { occurredAt: { [cmp]: cursor.occurredAt } },
    { occurredAt: cursor.occurredAt, id: { [cmp]: cursor.id } },
  ];
  if (sort === 'NEWEST' || sort === 'OLDEST') {
    return { OR: byTimeThenId };
  }
  return {
    OR: [
      { amountMinor: { [cmp]: cursor.amountMinor } },
      { amountMinor: cursor.amountMinor, OR: byTimeThenId },
    ],
  };
}
