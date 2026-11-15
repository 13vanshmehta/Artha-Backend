import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AdjustmentDirection,
  PaymentMethod,
  TransactionType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  IsNonNegativeMinorAmount,
  IsPositiveMinorAmount,
  toMinorUnits,
} from '../../common/money/money';
import {
  toStringList,
  trimToNull,
} from '../../common/validation/query-transforms';
import { DateRangeQueryDto } from '../shared/date-range';

/** ISO-8601 instant with an explicit offset, e.g. 2026-11-15T14:30:00+05:30 or …Z. */
const INSTANT_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const CLIENT_TXN_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Validation shared by create and update. Nullable = may be cleared on PATCH. */
class TransactionFieldsDto {
  @ApiPropertyOptional({
    type: String,
    example: '50025',
    description: 'Minor units (paise) as an integer string.',
  })
  @ValidateIf((_, v) => v !== undefined)
  @Transform(toMinorUnits)
  @IsPositiveMinorAmount()
  amountMinor?: bigint;

  @ApiPropertyOptional({
    example: '2026-11-15T14:30:00+05:30',
    description: 'Instant with explicit offset or Z.',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsISO8601(
    { strict: true },
    { message: 'occurredAt must be an ISO-8601 date-time.' },
  )
  @Matches(INSTANT_WITH_OFFSET, {
    message:
      'occurredAt must include a time and an explicit UTC offset (e.g. +05:30 or Z).',
  })
  occurredAt?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'EXPENSE / TRANSFER: account money leaves.',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  sourceAccountId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'INCOME / TRANSFER / REFUND: account money arrives in.',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  destinationAccountId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'ADJUSTMENT only: the account being corrected.',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({
    enum: AdjustmentDirection,
    description: 'ADJUSTMENT only.',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(AdjustmentDirection)
  direction?: AdjustmentDirection;

  @ApiPropertyOptional({ enum: PaymentMethod, nullable: true })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod | null;

  @ApiPropertyOptional({
    maxLength: 120,
    nullable: true,
    example: 'Blue Tokai',
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(120)
  payee?: string | null;

  @ApiPropertyOptional({
    maxLength: 500,
    nullable: true,
    description: 'Required for ADJUSTMENT (the reason).',
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({
    maxLength: 500,
    nullable: true,
    description: 'Alias for note (required reason for ADJUSTMENT).',
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @ApiPropertyOptional({ description: 'Legacy client alias for amountMinor.' })
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional({ description: 'Legacy client alias for occurredAt.' })
  @IsOptional()
  incurredAt?: string;

  @ApiPropertyOptional({ description: 'Category name display alias.' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Legacy client alias for payee.' })
  @IsOptional()
  @IsString()
  merchant?: string;

  @ApiPropertyOptional({ description: 'Legacy client alias for note.' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Legacy client alias for relatedTransactionId.' })
  @IsOptional()
  originalTransactionId?: string;

  @ApiPropertyOptional({ description: 'Legacy client alias for direction.' })
  @IsOptional()
  adjustmentDirection?: AdjustmentDirection;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'REFUND only: the EXPENSE being refunded.',
  })
  @IsOptional()
  @IsUUID()
  relatedTransactionId?: string | null;
}

export class CreateTransactionDto extends TransactionFieldsDto {
  @ApiProperty({
    example: '0f8e7c4e-4a9b-4c9e-9a77-3b1d2a5c6e10',
    description:
      'Client-generated idempotency key (UUID recommended), unique per user. 8–64 chars of A-Z a-z 0-9 _ -.',
  })
  @Matches(CLIENT_TXN_ID, {
    message:
      'clientTransactionId must be 8–64 characters of A-Z, a-z, 0-9, _ or -.',
  })
  clientTransactionId!: string;

  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  type!: TransactionType;
}

/** Type is immutable; delete and re-create to change it. */
export class UpdateTransactionDto extends TransactionFieldsDto {}

export const TRANSACTION_SORTS = [
  'NEWEST',
  'OLDEST',
  'HIGHEST_AMOUNT',
  'LOWEST_AMOUNT',
] as const;
export type TransactionSort = (typeof TRANSACTION_SORTS)[number];

export class ListTransactionsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    enum: TransactionType,
    isArray: true,
    description: 'Comma-separated or repeated.',
  })
  @IsOptional()
  @Transform(toStringList)
  @ArrayMaxSize(5)
  @IsEnum(TransactionType, { each: true })
  type?: TransactionType[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Comma-separated or repeated UUIDs.',
  })
  @IsOptional()
  @Transform(toStringList)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Matches source OR destination account.',
  })
  @IsOptional()
  @Transform(toStringList)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  accountIds?: string[];

  @ApiPropertyOptional({ enum: PaymentMethod, isArray: true })
  @IsOptional()
  @Transform(toStringList)
  @ArrayMaxSize(7)
  @IsEnum(PaymentMethod, { each: true })
  paymentMethods?: PaymentMethod[];

  @ApiPropertyOptional({ type: String, description: 'Inclusive, minor units.' })
  @IsOptional()
  @Transform(toMinorUnits)
  @IsNonNegativeMinorAmount()
  minAmount?: bigint;

  @ApiPropertyOptional({ type: String, description: 'Inclusive, minor units.' })
  @IsOptional()
  @Transform(toMinorUnits)
  @IsNonNegativeMinorAmount()
  maxAmount?: bigint;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Case-insensitive match on payee, note, category name.',
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  search?: string | null;

  @ApiPropertyOptional({ enum: TRANSACTION_SORTS, default: 'NEWEST' })
  @IsOptional()
  @IsIn(TRANSACTION_SORTS as unknown as string[])
  sort?: TransactionSort;

  @ApiPropertyOptional({
    description: 'Opaque; pass nextCursor from the previous page unchanged.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
