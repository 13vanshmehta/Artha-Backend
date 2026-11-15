import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsSignedMinorAmount, toMinorUnits } from '../../common/money/money';
import {
  toStrictBoolean,
  trimOrNull,
} from '../../common/validation/query-transforms';

export class CreateAccountDto {
  @ApiProperty({ example: 'HDFC Savings', maxLength: 60 })
  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  type!: AccountType;

  @ApiPropertyOptional({
    example: 'INR',
    default: 'INR',
    description: 'ISO 4217; immutable after creation.',
  })
  @IsOptional()
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
    typeof obj[key] === 'string'
      ? (obj[key] as string).trim().toUpperCase()
      : obj[key],
  )
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter ISO 4217 code.',
  })
  currency?: string;

  @ApiPropertyOptional({
    type: String,
    example: '250000',
    description:
      'Minor units as an integer string; may be negative (e.g. card balance owed). Default "0".',
  })
  @IsOptional()
  @Transform(toMinorUnits)
  @IsSignedMinorAmount()
  openingBalanceMinor?: bigint;

  @ApiPropertyOptional({
    type: String,
    example: '250000',
    description: 'Alias for openingBalanceMinor.',
  })
  @IsOptional()
  @Transform(toMinorUnits)
  @IsSignedMinorAmount()
  initialBalanceMinor?: bigint;

  @ApiPropertyOptional({
    description: 'Alias for openingBalanceMinor.',
  })
  @IsOptional()
  @Transform(toMinorUnits)
  @IsSignedMinorAmount()
  initialBalance?: bigint;

  @ApiPropertyOptional({
    maxLength: 60,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  institution?: string | null;

  @ApiPropertyOptional({
    description: 'Make this the default account (unsets the previous default).',
  })
  @IsOptional()
  @Transform(toStrictBoolean)
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAccountDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ enum: AccountType })
  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @ApiPropertyOptional({ type: String, example: '250000' })
  @IsOptional()
  @Transform(toMinorUnits)
  @IsSignedMinorAmount()
  openingBalanceMinor?: bigint;

  @ApiPropertyOptional({
    description:
      'Only `true` is accepted; set another account as default to move it.',
  })
  @IsOptional()
  @Transform(toStrictBoolean)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({
    description: '`false` un-archives. Archive with DELETE /accounts/:id.',
  })
  @IsOptional()
  @Transform(toStrictBoolean)
  @IsBoolean()
  isArchived?: boolean;
}

export class ListAccountsQueryDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toStrictBoolean)
  @IsBoolean()
  includeArchived?: boolean;
}
