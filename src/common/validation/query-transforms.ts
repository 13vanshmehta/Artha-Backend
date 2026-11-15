/**
 * class-transformer helpers for query strings. They read the raw value from the
 * source object because `enableImplicitConversion` would otherwise coerce first
 * (e.g. Boolean("false") === true).
 */

type TransformArgs = { obj: Record<string, unknown>; key: string };

/** `?ids=a,b&ids=c` → ['a','b','c']; empty entries dropped; undefined if absent. */
export function toStringList({ obj, key }: TransformArgs): unknown {
  const raw = obj[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  if (!values.every((v) => typeof v === 'string')) return raw;
  return (values as string[])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** 'true'/'false' (and real booleans) only; anything else is left for the validator. */
export function toStrictBoolean({ obj, key }: TransformArgs): unknown {
  const raw = obj[key];
  if (raw === 'true' || raw === true) return true;
  if (raw === 'false' || raw === false) return false;
  return raw;
}

/** Trims strings; leaves `null` (explicit clear) and non-strings untouched. */
export function trimOrNull({ obj, key }: TransformArgs): unknown {
  const raw = obj[key];
  return typeof raw === 'string' ? raw.trim() : raw;
}

/** Trims strings and turns empty strings into null (clears an optional field). */
export function trimToNull({ obj, key }: TransformArgs): unknown {
  const raw = obj[key];
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}
