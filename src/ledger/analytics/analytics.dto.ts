import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { DateRangeQueryDto } from '../shared/date-range';

export const GROUP_BY = ['DAY', 'WEEK', 'MONTH'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

const upper = ({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
  typeof obj[key] === 'string'
    ? (obj[key] as string).trim().toUpperCase()
    : obj[key];

export class CurrencyQueryDto {
  @ApiPropertyOptional({
    default: 'INR',
    description: 'Totals only include transactions in this currency.',
  })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter ISO 4217 code.',
  })
  currency?: string;
}

export class SummaryQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    enum: GROUP_BY,
    description: 'Default: DAY ≤ 31 days, WEEK ≤ 120 days, else MONTH.',
  })
  @IsOptional()
  @Transform(upper)
  @IsIn(GROUP_BY as unknown as string[])
  groupBy?: GroupBy;

  @ApiPropertyOptional({ default: 'INR' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter ISO 4217 code.',
  })
  currency?: string;
}
