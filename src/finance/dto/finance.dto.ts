import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GroupRole, TransactionType } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
} from 'class-validator';

export const MAX_EXPENSE_AMOUNT = 100_000_000;

export class CreateExpenseDto {
  @ApiProperty({ example: 'Blue Tokai Coffee' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  merchant!: string;

  @ApiProperty({ example: 'Food' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  category!: string;

  @ApiProperty({ example: 380 })
  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false })
  @IsPositive()
  @Max(MAX_EXPENSE_AMOUNT)
  amount!: number;

  @ApiPropertyOptional({
    enum: TransactionType,
    default: TransactionType.EXPENSE,
  })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiProperty({ example: 'UPI' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  paymentMethod!: string;

  @ApiPropertyOptional({ example: 'Iced Latte' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;

  @ApiPropertyOptional({ description: 'Optional shared group UUID' })
  @IsOptional()
  @IsUUID()
  groupId?: string;
}

export class UpdateExpenseDto {
  @ApiPropertyOptional({ example: 'Blue Tokai Roasters' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  merchant?: string;

  @ApiPropertyOptional({ example: 'Food' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional({ example: 420 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false })
  @IsPositive()
  @Max(MAX_EXPENSE_AMOUNT)
  amount?: number;

  @ApiPropertyOptional({ example: 'Notes updated' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;
}

export class CreateGroupDto {
  @ApiProperty({ example: 'Roommates' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'currency must be a 3-letter ISO 4217 currency code.',
  })
  currency?: string;
}

export class AddGroupMemberDto {
  @ApiProperty({ description: 'UUID of the user to add to the group' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ enum: GroupRole, default: GroupRole.MEMBER })
  @IsOptional()
  @IsEnum(GroupRole)
  role?: GroupRole;
}

