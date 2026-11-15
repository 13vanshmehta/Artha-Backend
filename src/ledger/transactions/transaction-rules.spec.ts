import { BadRequestException } from '@nestjs/common';
import {
  AdjustmentDirection,
  Transaction,
  TransactionType,
} from '@prisma/client';
import {
  buildDraft,
  fingerprintDraft,
  inputFromStored,
  mergePatch,
  TransactionInput,
} from './transaction-rules';
import { afterCursor, decodeCursor, encodeCursor } from './transaction-query';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CAT = '33333333-3333-4333-8333-333333333333';
const when = new Date('2026-11-15T09:00:00Z');

function fieldErrors(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    const body = (err as BadRequestException).getResponse() as {
      errorCode: string;
      details: { fieldErrors: Array<{ field: string }> };
    };
    expect(body.errorCode).toBe('INVALID_TRANSACTION_SHAPE');
    return body.details.fieldErrors.map((e) => e.field).sort();
  }
  throw new Error('expected buildDraft to throw');
}

const base = (
  type: TransactionType,
  extra: Partial<TransactionInput> = {},
): TransactionInput => ({
  type,
  amountMinor: 100n,
  occurredAt: when,
  ...extra,
});

describe('transaction type rules', () => {
  it('EXPENSE: source + category required; destination forbidden', () => {
    expect(fieldErrors(() => buildDraft(base('EXPENSE')))).toEqual([
      'categoryId',
      'sourceAccountId',
    ]);
    expect(
      fieldErrors(() =>
        buildDraft(
          base('EXPENSE', {
            sourceAccountId: A,
            categoryId: CAT,
            destinationAccountId: B,
          }),
        ),
      ),
    ).toEqual(['destinationAccountId']);
    expect(
      buildDraft(base('EXPENSE', { sourceAccountId: A, categoryId: CAT })),
    ).toMatchObject({ sourceAccountId: A, destinationAccountId: null });
  });

  it('INCOME: destination + category required', () => {
    expect(
      fieldErrors(() => buildDraft(base('INCOME', { categoryId: CAT }))),
    ).toEqual(['destinationAccountId']);
    expect(
      fieldErrors(() =>
        buildDraft(
          base('INCOME', {
            destinationAccountId: A,
            categoryId: CAT,
            sourceAccountId: B,
          }),
        ),
      ),
    ).toEqual(['sourceAccountId']);
  });

  it('TRANSFER: two different accounts, no category', () => {
    expect(
      fieldErrors(() =>
        buildDraft(
          base('TRANSFER', { sourceAccountId: A, destinationAccountId: A }),
        ),
      ),
    ).toEqual(['destinationAccountId']);
    expect(
      fieldErrors(() =>
        buildDraft(
          base('TRANSFER', {
            sourceAccountId: A,
            destinationAccountId: B,
            categoryId: CAT,
          }),
        ),
      ),
    ).toEqual(['categoryId']);
    expect(
      buildDraft(
        base('TRANSFER', { sourceAccountId: A, destinationAccountId: B }),
      ),
    ).toMatchObject({ categoryId: null });
  });

  it('REFUND: destination required, category and related optional', () => {
    expect(fieldErrors(() => buildDraft(base('REFUND')))).toEqual([
      'destinationAccountId',
    ]);
    expect(
      buildDraft(
        base('REFUND', { destinationAccountId: A, relatedTransactionId: B }),
      ),
    ).toMatchObject({ relatedTransactionId: B });
  });

  it('ADJUSTMENT: maps direction onto source/destination and requires a reason', () => {
    expect(
      fieldErrors(() => buildDraft(base('ADJUSTMENT', { accountId: A }))),
    ).toEqual(['direction', 'note']);
    expect(
      fieldErrors(() =>
        buildDraft(
          base('ADJUSTMENT', {
            accountId: A,
            direction: 'INCREASE',
            note: 'x',
            paymentMethod: 'UPI',
          }),
        ),
      ),
    ).toEqual(['paymentMethod']);
    expect(
      buildDraft(
        base('ADJUSTMENT', { accountId: A, direction: 'INCREASE', note: 'x' }),
      ),
    ).toMatchObject({
      destinationAccountId: A,
      sourceAccountId: null,
      adjustmentDirection: AdjustmentDirection.INCREASE,
    });
    expect(
      buildDraft(
        base('ADJUSTMENT', { accountId: A, direction: 'DECREASE', note: 'x' }),
      ),
    ).toMatchObject({
      destinationAccountId: null,
      sourceAccountId: A,
    });
  });

  it('round-trips a stored ADJUSTMENT through a PATCH merge', () => {
    const stored = {
      type: TransactionType.ADJUSTMENT,
      amountMinor: 100n,
      occurredAt: when,
      categoryId: null,
      sourceAccountId: A,
      destinationAccountId: null,
      adjustmentDirection: AdjustmentDirection.DECREASE,
      paymentMethod: null,
      payee: null,
      note: 'cash count',
      relatedTransactionId: null,
    } as unknown as Transaction;
    const flipped = buildDraft(
      mergePatch(inputFromStored(stored), { direction: 'INCREASE' }),
    );
    expect(flipped).toMatchObject({
      destinationAccountId: A,
      sourceAccountId: null,
      adjustmentDirection: 'INCREASE',
    });
    // Clearing the reason is rejected.
    expect(
      fieldErrors(() =>
        buildDraft(mergePatch(inputFromStored(stored), { note: null })),
      ),
    ).toEqual(['note']);
  });

  it('fingerprints content, not representation', () => {
    const a = buildDraft(
      base('EXPENSE', { sourceAccountId: A, categoryId: CAT }),
    );
    const sameInstant = buildDraft(
      base('EXPENSE', {
        sourceAccountId: A,
        categoryId: CAT,
        occurredAt: new Date('2026-11-15T14:30:00+05:30'),
      }),
    );
    const different = buildDraft(
      base('EXPENSE', {
        sourceAccountId: A,
        categoryId: CAT,
        amountMinor: 101n,
      }),
    );
    expect(fingerprintDraft(a)).toBe(fingerprintDraft(sameInstant));
    expect(fingerprintDraft(a)).not.toBe(fingerprintDraft(different));
  });
});

describe('cursor', () => {
  const row = { id: A, occurredAt: when, amountMinor: 5000n };

  it('round-trips and is bound to its sort', () => {
    const c = encodeCursor('HIGHEST_AMOUNT', row);
    expect(decodeCursor(c, 'HIGHEST_AMOUNT')).toEqual(row);
    expect(() => decodeCursor(c, 'NEWEST')).toThrow(BadRequestException);
    expect(() => decodeCursor('garbage', 'NEWEST')).toThrow(
      BadRequestException,
    );
    const tampered = Buffer.from(
      JSON.stringify({
        v: 1,
        s: 'NEWEST',
        t: when.toISOString(),
        i: "x' OR 1=1",
      }),
    ).toString('base64url');
    expect(() => decodeCursor(tampered, 'NEWEST')).toThrow(BadRequestException);
  });

  it('builds a lexicographic keyset predicate', () => {
    expect(afterCursor('NEWEST', row)).toEqual({
      OR: [{ occurredAt: { lt: when } }, { occurredAt: when, id: { lt: A } }],
    });
    expect(afterCursor('LOWEST_AMOUNT', row)).toEqual({
      OR: [
        { amountMinor: { gt: 5000n } },
        {
          amountMinor: 5000n,
          OR: [
            { occurredAt: { gt: when } },
            { occurredAt: when, id: { gt: A } },
          ],
        },
      ],
    });
  });
});
