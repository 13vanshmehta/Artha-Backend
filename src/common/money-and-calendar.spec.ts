import {
  divideRounded,
  MAX_AMOUNT_MINOR,
  parseMinorUnits,
  percentageOf,
} from './money/money';
import {
  addDays,
  isValidTimeZone,
  localDateOf,
  parseLocalDate,
  resolvePeriod,
  startOfLocalDay,
  toUtcRange,
} from './time/local-calendar';

describe('money', () => {
  it('parses only exact integers', () => {
    expect(parseMinorUnits('50025')).toBe(50025n);
    expect(parseMinorUnits(' 42 ')).toBe(42n);
    expect(parseMinorUnits(50025)).toBe(50025n);
    expect(parseMinorUnits('-7')).toBe(-7n);
    for (const bad of [
      '500.25',
      500.25,
      '1e3',
      '',
      'abc',
      '0x10',
      true,
      null,
      {},
      2 ** 60,
    ]) {
      expect(parseMinorUnits(bad)).toBeUndefined();
    }
  });

  it('keeps precision far beyond Number.MAX_SAFE_INTEGER', () => {
    const big = parseMinorUnits('90071992547409931')!;
    expect((big + 1n).toString()).toBe('90071992547409932');
    expect(MAX_AMOUNT_MINOR * 10_000n > BigInt(Number.MAX_SAFE_INTEGER)).toBe(
      true,
    );
  });

  it('rounds averages half away from zero', () => {
    expect(divideRounded(10n, 4n)).toBe(3n); // 2.5
    expect(divideRounded(9n, 4n)).toBe(2n); // 2.25
    expect(divideRounded(-10n, 4n)).toBe(-3n);
    expect(divideRounded(0n, 7n)).toBe(0n);
    expect(() => divideRounded(1n, 0n)).toThrow(RangeError);
  });

  it('computes display percentages', () => {
    expect(percentageOf(1n, 3n)).toBe(33.33);
    expect(percentageOf(2n, 3n)).toBe(66.67);
    expect(percentageOf(-5n, 10n)).toBe(0);
    expect(percentageOf(5n, 0n)).toBe(0);
  });
});

describe('local calendar', () => {
  it('validates IANA zones', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    for (const bad of [
      'Mars/Base',
      '',
      'Asia/Kolkata; DROP TABLE',
      '../etc',
      42,
    ]) {
      expect(isValidTimeZone(bad)).toBe(false);
    }
  });

  it('finds local midnight in IST', () => {
    expect(
      startOfLocalDay(
        { year: 2026, month: 11, day: 15 },
        'Asia/Kolkata',
      ).toISOString(),
    ).toBe('2026-11-14T18:30:00.000Z');
    expect(
      localDateOf(new Date('2026-11-14T18:29:59Z'), 'Asia/Kolkata'),
    ).toEqual({ year: 2026, month: 11, day: 14 });
    expect(
      localDateOf(new Date('2026-11-14T18:30:00Z'), 'Asia/Kolkata'),
    ).toEqual({ year: 2026, month: 11, day: 15 });
  });

  it('handles DST days that are 23 and 25 hours long', () => {
    const springForward = toUtcRange(
      {
        from: { year: 2026, month: 3, day: 8 },
        to: { year: 2026, month: 3, day: 8 },
      },
      'America/New_York',
    );
    expect(springForward.startUtc.toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(
      (springForward.endUtc.getTime() - springForward.startUtc.getTime()) /
        3_600_000,
    ).toBe(23);

    const fallBack = toUtcRange(
      {
        from: { year: 2026, month: 11, day: 1 },
        to: { year: 2026, month: 11, day: 1 },
      },
      'America/New_York',
    );
    expect(
      (fallBack.endUtc.getTime() - fallBack.startUtc.getTime()) / 3_600_000,
    ).toBe(25);
  });

  it('rejects impossible dates', () => {
    expect(parseLocalDate('2026-02-29')).toBeUndefined();
    expect(parseLocalDate('2028-02-29')).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(parseLocalDate('2026-13-01')).toBeUndefined();
    expect(parseLocalDate('2026-1-01')).toBeUndefined();
  });

  it('resolves named periods around a given day', () => {
    const today = { year: 2026, month: 2, day: 1 }; // a Sunday
    expect(resolvePeriod('LAST_3_DAYS', today)).toEqual({
      from: { year: 2026, month: 1, day: 30 },
      to: today,
    });
    expect(resolvePeriod('THIS_WEEK', today)).toEqual({
      from: { year: 2026, month: 1, day: 26 },
      to: today,
    });
    expect(resolvePeriod('LAST_MONTH', today)).toEqual({
      from: { year: 2026, month: 1, day: 1 },
      to: { year: 2026, month: 1, day: 31 },
    });
    expect(resolvePeriod('THIS_QUARTER', today).to).toEqual({
      year: 2026,
      month: 3,
      day: 31,
    });
    expect(
      resolvePeriod('THIS_HALF_YEAR', { year: 2026, month: 8, day: 9 }).from,
    ).toEqual({ year: 2026, month: 7, day: 1 });
    expect(resolvePeriod('THIS_FINANCIAL_YEAR', today)).toEqual({
      from: { year: 2025, month: 4, day: 1 },
      to: { year: 2026, month: 3, day: 31 },
    });
    expect(
      resolvePeriod('THIS_FINANCIAL_YEAR', { year: 2026, month: 4, day: 1 })
        .from,
    ).toEqual({ year: 2026, month: 4, day: 1 });
    expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });
});
