import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import {
  compareLocalDates,
  daysBetween,
  LocalDate,
  LocalDateRange,
  localDateOf,
  parseLocalDate,
  PERIODS,
  resolvePeriod,
  toUtcRange,
  UtcRange,
} from '../../common/time/local-calendar';
import type { Period } from '../../common/time/local-calendar';
import { LedgerErrors } from './ledger-errors';

const LOCAL_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** `period` OR `from`/`to` (local calendar dates, inclusive, in the user's timezone). */
export class DateRangeQueryDto {
  @ApiPropertyOptional({
    enum: PERIODS,
    description: 'Named period in the user timezone.',
  })
  @IsOptional()
  @IsIn(PERIODS as unknown as string[])
  period?: Period;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Inclusive local date.',
  })
  @IsOptional()
  @Matches(LOCAL_DATE_REGEX, {
    message: 'from must be a date in YYYY-MM-DD format.',
  })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Inclusive local date.',
  })
  @IsOptional()
  @Matches(LOCAL_DATE_REGEX, {
    message: 'to must be a date in YYYY-MM-DD format.',
  })
  to?: string;
}

export interface ResolvedRange extends UtcRange {
  timezone: string;
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
}

export interface ResolvedOpenRange {
  startUtc?: Date;
  endUtc?: Date;
}

function parseOrThrow(value: string, field: string): LocalDate {
  const parsed = parseLocalDate(value);
  if (!parsed) {
    throw LedgerErrors.invalidDateRange(
      `${field} is not a real calendar date.`,
    );
  }
  return parsed;
}

function assertOrdered(from: LocalDate, to: LocalDate): void {
  if (compareLocalDates(from, to) > 0) {
    throw LedgerErrors.invalidDateRange('from must be on or before to.');
  }
}

/**
 * A closed range for analytics: a named period, or both `from` and `to`.
 * Falls back to `defaultPeriod` when nothing is given.
 */
export function resolveClosedRange(
  query: DateRangeQueryDto,
  timezone: string,
  options: {
    defaultPeriod: Exclude<Period, 'CUSTOM'>;
    maxDays: number;
    now?: Date;
  },
): ResolvedRange {
  const today = localDateOf(options.now ?? new Date(), timezone);
  let range: LocalDateRange;

  const hasExplicitDates = query.from !== undefined || query.to !== undefined;
  if (query.period && query.period !== 'CUSTOM') {
    if (hasExplicitDates) {
      throw LedgerErrors.invalidDateRange(
        'Send either period or from/to, not both.',
      );
    }
    range = resolvePeriod(query.period, today);
  } else if (hasExplicitDates || query.period === 'CUSTOM') {
    if (!query.from || !query.to) {
      throw LedgerErrors.invalidDateRange(
        'A custom range needs both from and to.',
      );
    }
    range = {
      from: parseOrThrow(query.from, 'from'),
      to: parseOrThrow(query.to, 'to'),
    };
    assertOrdered(range.from, range.to);
  } else {
    range = resolvePeriod(options.defaultPeriod, today);
  }

  if (daysBetween(range.from, range.to) + 1 > options.maxDays) {
    throw LedgerErrors.invalidDateRange(
      `The range may span at most ${options.maxDays} days.`,
    );
  }

  return { ...range, ...toUtcRange(range, timezone), timezone, today };
}

/**
 * An optionally open range for history filtering: no bounds, `from` only,
 * `to` only, both, or a named period.
 */
export function resolveOpenRange(
  query: DateRangeQueryDto,
  timezone: string,
  now: Date = new Date(),
): ResolvedOpenRange {
  if (query.period && query.period !== 'CUSTOM') {
    if (query.from !== undefined || query.to !== undefined) {
      throw LedgerErrors.invalidDateRange(
        'Send either period or from/to, not both.',
      );
    }
    return toUtcRange(
      resolvePeriod(query.period, localDateOf(now, timezone)),
      timezone,
    );
  }
  const from = query.from ? parseOrThrow(query.from, 'from') : undefined;
  const to = query.to ? parseOrThrow(query.to, 'to') : undefined;
  if (from && to) assertOrdered(from, to);
  return {
    startUtc: from
      ? toUtcRange({ from, to: from }, timezone).startUtc
      : undefined,
    endUtc: to ? toUtcRange({ from: to, to }, timezone).endUtc : undefined,
  };
}
