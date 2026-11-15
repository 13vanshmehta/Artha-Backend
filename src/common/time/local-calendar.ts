/**
 * Calendar arithmetic in a user's IANA time zone, built on Intl only.
 *
 * Every user-facing period ("today", "this month", "last 3 days") is a run of
 * whole local calendar days, converted to a half-open UTC interval
 * [startUtc, endUtc) for querying timestamptz columns. "Last 3 days" therefore
 * means today + the two previous local dates, not the previous 72 hours.
 */

export interface LocalDate {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

export interface UtcRange {
  /** Inclusive. */
  startUtc: Date;
  /** Exclusive. */
  endUtc: Date;
}

export interface LocalDateRange {
  /** Inclusive first local day. */
  from: LocalDate;
  /** Inclusive last local day. */
  to: LocalDate;
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMEZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** True for IANA names the runtime knows (e.g. "Asia/Kolkata", "UTC"). */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (
    typeof timeZone !== 'string' ||
    timeZone.length > 64 ||
    !TIMEZONE_PATTERN.test(timeZone)
  ) {
    return false;
  }
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallClock extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (IST → +19 800 000). */
function offsetMsAt(instant: Date, timeZone: string): number {
  const wall = wallClockAt(instant, timeZone);
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return wallAsUtc - wholeSeconds;
}

/** The local calendar date of `instant` in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const { year, month, day } = wallClockAt(instant, timeZone);
  return { year, month, day };
}

/** UTC instant of local midnight at the start of `date` in `timeZone`. */
export function startOfLocalDay(date: LocalDate, timeZone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day);
  const firstOffset = offsetMsAt(new Date(guess), timeZone);
  let candidate = guess - firstOffset;
  // Re-check across a DST boundary between the guess and the real instant.
  const secondOffset = offsetMsAt(new Date(candidate), timeZone);
  if (secondOffset !== firstOffset) {
    candidate = guess - secondOffset;
  }
  return new Date(candidate);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
  };
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const t = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: 1 };
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return (
    Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)
  );
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round(compareLocalDates(b, a) / 86_400_000);
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(date: LocalDate): number {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function startOfIsoWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function startOfMonth(date: LocalDate): LocalDate {
  return { year: date.year, month: date.month, day: 1 };
}

export function endOfMonth(date: LocalDate): LocalDate {
  return addDays(addMonths(date, 1), -1);
}

export function formatLocalDate(date: LocalDate): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

/** Parses a strict `YYYY-MM-DD` calendar date; returns undefined if not a real date. */
export function parseLocalDate(value: string): LocalDate | undefined {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return undefined;
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const roundTrip = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (
    roundTrip.getUTCFullYear() !== date.year ||
    roundTrip.getUTCMonth() + 1 !== date.month ||
    roundTrip.getUTCDate() !== date.day
  ) {
    return undefined;
  }
  return date;
}

/** Converts whole local days [from, to] into the UTC interval [start, end). */
export function toUtcRange(range: LocalDateRange, timeZone: string): UtcRange {
  return {
    startUtc: startOfLocalDay(range.from, timeZone),
    endUtc: startOfLocalDay(addDays(range.to, 1), timeZone),
  };
}

export const PERIODS = [
  'TODAY',
  'YESTERDAY',
  'LAST_3_DAYS',
  'THIS_WEEK',
  'LAST_7_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
  'LAST_30_DAYS',
  'THIS_QUARTER',
  'THIS_HALF_YEAR',
  'THIS_YEAR',
  'THIS_FINANCIAL_YEAR',
  'CUSTOM',
] as const;
export type Period = (typeof PERIODS)[number];

/**
 * Resolves a named period to whole local days around `today`.
 * Weeks start Monday. The financial year is the Indian one (1 Apr – 31 Mar).
 * Calendar periods (week/month/quarter/half/year/FY) cover the full period,
 * including days after today, so a client sees a stable bucket layout.
 */
export function resolvePeriod(
  period: Exclude<Period, 'CUSTOM'>,
  today: LocalDate,
): LocalDateRange {
  switch (period) {
    case 'TODAY':
      return { from: today, to: today };
    case 'YESTERDAY': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'LAST_3_DAYS':
      return { from: addDays(today, -2), to: today };
    case 'LAST_7_DAYS':
      return { from: addDays(today, -6), to: today };
    case 'LAST_30_DAYS':
      return { from: addDays(today, -29), to: today };
    case 'THIS_WEEK': {
      const from = startOfIsoWeek(today);
      return { from, to: addDays(from, 6) };
    }
    case 'THIS_MONTH':
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case 'LAST_MONTH': {
      const prev = addMonths(today, -1);
      return { from: prev, to: endOfMonth(prev) };
    }
    case 'THIS_QUARTER': {
      const firstMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
      const from = { year: today.year, month: firstMonth, day: 1 };
      return { from, to: addDays(addMonths(from, 3), -1) };
    }
    case 'THIS_HALF_YEAR': {
      const from = {
        year: today.year,
        month: today.month <= 6 ? 1 : 7,
        day: 1,
      };
      return { from, to: addDays(addMonths(from, 6), -1) };
    }
    case 'THIS_YEAR':
      return {
        from: { year: today.year, month: 1, day: 1 },
        to: { year: today.year, month: 12, day: 31 },
      };
    case 'THIS_FINANCIAL_YEAR': {
      const startYear = today.month >= 4 ? today.year : today.year - 1;
      return {
        from: { year: startYear, month: 4, day: 1 },
        to: { year: startYear + 1, month: 3, day: 31 },
      };
    }
  }
}
