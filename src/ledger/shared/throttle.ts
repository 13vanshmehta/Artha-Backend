/**
 * Per-client limit for ledger writes, on top of the global 60/min default.
 * Generous enough for rapid manual entry; tight enough to blunt scripted abuse.
 */
export const WRITE_THROTTLE = { default: { limit: 30, ttl: 60_000 } };
