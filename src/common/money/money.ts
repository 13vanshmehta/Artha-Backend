import { ValidateBy, ValidationOptions } from 'class-validator';

/**
 * Money is carried as `bigint` minor units (paise for INR) everywhere inside the
 * server and stored as Postgres BIGINT. On the wire it is a base-10 string
 * (`"50025"` = ₹500.25) so no client ever routes it through an IEEE-754 double.
 * See docs/API_CONTRACT.md §Money.
 */

/** ₹1,000 crore. Large enough for any personal transaction, small enough to sum safely. */
export const MAX_AMOUNT_MINOR = 100_000_000_000_00n;
/** Opening balances may be negative (credit card owed) but are bounded the same way. */
export const MAX_ABS_BALANCE_MINOR = MAX_AMOUNT_MINOR;

const INTEGER_STRING = /^-?\d{1,20}$/;

/**
 * Parses a request value into bigint minor units. Accepts a base-10 integer
 * string or a JSON integer that is a safe JS integer. Anything else (decimals,
 * exponents, unsafe integers, booleans) returns `undefined`, which the paired
 * validator reports as a validation error.
 */
export function parseMinorUnits(raw: unknown): bigint | undefined {
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) ? BigInt(raw) : undefined;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return INTEGER_STRING.test(trimmed) ? BigInt(trimmed) : undefined;
  }
  return undefined;
}

/**
 * class-transformer `@Transform` callback. Reads from the original plain object
 * so implicit type conversion can never coerce the value through a double first.
 * Unparseable input is passed through untouched so the validator can name it.
 */
export function toMinorUnits({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}): unknown {
  const raw = obj[key];
  if (raw === undefined || raw === null) return raw;
  return parseMinorUnits(raw) ?? raw;
}

function bigintInRange(
  name: string,
  min: bigint,
  max: bigint,
  describe: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'bigint' && value >= min && value <= max,
        defaultMessage: (args) =>
          `${args?.property} must be ${describe}, sent as an integer string of minor units (e.g. "50025" for 500.25).`,
      },
    },
    options,
  );
}

/** A transaction amount: 1 ≤ value ≤ MAX_AMOUNT_MINOR. */
export function IsPositiveMinorAmount(options?: ValidationOptions) {
  return bigintInRange(
    'isPositiveMinorAmount',
    1n,
    MAX_AMOUNT_MINOR,
    `a whole number of minor units between 1 and ${MAX_AMOUNT_MINOR}`,
    options,
  );
}

/** A filter bound: 0 ≤ value ≤ MAX_AMOUNT_MINOR. */
export function IsNonNegativeMinorAmount(options?: ValidationOptions) {
  return bigintInRange(
    'isNonNegativeMinorAmount',
    0n,
    MAX_AMOUNT_MINOR,
    `a whole number of minor units between 0 and ${MAX_AMOUNT_MINOR}`,
    options,
  );
}

/** A signed balance: |value| ≤ MAX_ABS_BALANCE_MINOR. */
export function IsSignedMinorAmount(options?: ValidationOptions) {
  return bigintInRange(
    'isSignedMinorAmount',
    -MAX_ABS_BALANCE_MINOR,
    MAX_ABS_BALANCE_MINOR,
    `a whole number of minor units with magnitude at most ${MAX_ABS_BALANCE_MINOR}`,
    options,
  );
}

/** Serialises minor units for JSON. `null`/`undefined` sums (no rows) become "0". */
export function minorToString(value: bigint | null | undefined): string {
  return (value ?? 0n).toString();
}

/**
 * Integer division rounded half away from zero. Used for averages so that the
 * result is still an exact number of minor units.
 */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError('divideRounded: denominator must be non-zero');
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n * 2n + d) / (d * 2n);
  return negative ? -quotient : quotient;
}

/**
 * Share of `part` in `whole` as a percentage with two decimals. This is a
 * display ratio, not money, so returning a JS number is fine.
 */
export function percentageOf(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  return Number(divideRounded(part * 10_000n, whole)) / 100;
}
