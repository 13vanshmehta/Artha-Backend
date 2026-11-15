import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Domain errors for the ledger. Every one carries a stable `errorCode` that the
 * global AllExceptionsFilter puts in the standard error envelope. Codes are
 * listed in docs/API_CONTRACT.md §Errors — add new ones there first.
 *
 * Another user's resource is always reported as NOT FOUND (never FORBIDDEN) so
 * that ids cannot be probed for existence.
 */
export const LedgerErrors = {
  accountNotFound: () =>
    new NotFoundException({
      errorCode: 'ACCOUNT_NOT_FOUND',
      message: 'Account not found.',
    }),
  categoryNotFound: () =>
    new NotFoundException({
      errorCode: 'CATEGORY_NOT_FOUND',
      message: 'Category not found.',
    }),
  transactionNotFound: () =>
    new NotFoundException({
      errorCode: 'TRANSACTION_NOT_FOUND',
      message: 'Transaction not found.',
    }),
  relatedTransactionNotFound: () =>
    new NotFoundException({
      errorCode: 'RELATED_TRANSACTION_NOT_FOUND',
      message: 'The transaction being refunded was not found.',
    }),

  invalidShape: (message: string, details?: Record<string, unknown>) =>
    new BadRequestException({
      errorCode: 'INVALID_TRANSACTION_SHAPE',
      message,
      details,
    }),
  accountArchived: () =>
    new BadRequestException({
      errorCode: 'ACCOUNT_ARCHIVED',
      message: 'Archived accounts cannot be used for new or changed entries.',
    }),
  categoryArchived: () =>
    new BadRequestException({
      errorCode: 'CATEGORY_ARCHIVED',
      message: 'Archived categories cannot be used for new or changed entries.',
    }),
  categoryTypeMismatch: (expected: string) =>
    new BadRequestException({
      errorCode: 'CATEGORY_TYPE_MISMATCH',
      message: `This transaction needs a category of type ${expected}.`,
    }),
  currencyMismatch: () =>
    new BadRequestException({
      errorCode: 'CURRENCY_MISMATCH',
      message: 'Both accounts must use the same currency.',
    }),
  invalidRelatedTransaction: (message: string) =>
    new BadRequestException({
      errorCode: 'INVALID_RELATED_TRANSACTION',
      message,
    }),
  invalidDateRange: (message: string) =>
    new BadRequestException({ errorCode: 'INVALID_DATE_RANGE', message }),
  invalidCursor: () =>
    new BadRequestException({
      errorCode: 'INVALID_CURSOR',
      message:
        'The pagination cursor is invalid or does not match the requested sort.',
    }),

  idempotencyKeyReused: () =>
    new ConflictException({
      errorCode: 'IDEMPOTENCY_KEY_REUSED',
      message:
        'This clientTransactionId was already used for a different transaction. Generate a new id for a new entry.',
    }),
  duplicateName: (what: 'account' | 'category') =>
    new ConflictException({
      errorCode:
        what === 'account' ? 'ACCOUNT_NAME_TAKEN' : 'CATEGORY_NAME_TAKEN',
      message: `You already have an active ${what} with this name.`,
    }),
  systemCategoryReadOnly: () =>
    new ConflictException({
      errorCode: 'SYSTEM_CATEGORY_READ_ONLY',
      message: 'System categories cannot be changed.',
    }),
  transactionHasRefunds: () =>
    new ConflictException({
      errorCode: 'TRANSACTION_HAS_REFUNDS',
      message: 'Delete the refunds linked to this expense first.',
    }),
  transactionDeleted: () =>
    new ConflictException({
      errorCode: 'TRANSACTION_DELETED',
      message: 'Restore this transaction before editing it.',
    }),

  refundExceedsOriginal: (remainingMinor: bigint) =>
    new UnprocessableEntityException({
      errorCode: 'REFUND_EXCEEDS_ORIGINAL',
      message: 'Total refunds cannot exceed the original expense amount.',
      details: { remainingRefundableMinor: remainingMinor.toString() },
    }),
  amountBelowRefunded: (refundedMinor: bigint) =>
    new UnprocessableEntityException({
      errorCode: 'AMOUNT_BELOW_REFUNDED',
      message:
        'An expense cannot be reduced below the amount already refunded against it.',
      details: { refundedMinor: refundedMinor.toString() },
    }),
};
