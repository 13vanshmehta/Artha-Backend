import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

export interface ClientRequestMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

const MAX_TRUSTED_PROXY_HOPS = 10;

/**
 * Number of reverse proxies (load balancer, CDN, ingress) in front of the API
 * that append to X-Forwarded-For, taken from TRUST_PROXY:
 * - unset: 0 in production (trust nothing), 1 elsewhere (local tooling / tests)
 * - "false"/"0": trust nothing; "true": exactly one hop (never "trust all")
 * - "N": trust N hops
 */
export function resolveTrustedProxyHops(): number {
  const raw = (process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (raw === '') {
    return process.env.NODE_ENV === 'production' ? 0 : 1;
  }
  if (raw === 'false') return 0;
  if (raw === 'true') return 1;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 && hops <= MAX_TRUSTED_PROXY_HOPS
    ? hops
    : 0;
}

/**
 * Extracts the client IP without trusting anything the client controls.
 *
 * Each trusted proxy appends the address it received the connection from to
 * X-Forwarded-For, so with N trusted hops the real client is the N-th entry
 * counted from the right. Everything to the left of it was supplied by the
 * client and can be forged — reading the leftmost entry (as this function once
 * did) let any caller pick a fresh IP per request and bypass every rate limit (BE-03).
 */
export function extractClientIp(req: Record<string, unknown>): string | null {
  const hops = resolveTrustedProxyHops();

  if (hops > 0) {
    const headers = req.headers as Record<string, unknown> | undefined;
    const forwarded = headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
      const chain = forwarded
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      const candidate = chain.length >= hops ? chain[chain.length - hops] : undefined;
      if (candidate && isIP(candidate)) {
        return candidate.slice(0, 64);
      }
    }
  }

  if (typeof req.ip === 'string' && req.ip.trim().length > 0) {
    return req.ip.trim().slice(0, 64);
  }

  return null;
}

export function extractRequestMetadata(req: Request): ClientRequestMetadata {
  const rawUserAgent = req.headers?.['user-agent'];
  return {
    ipAddress: extractClientIp(req as unknown as Record<string, unknown>),
    userAgent:
      typeof rawUserAgent === 'string' && rawUserAgent.trim().length > 0
        ? rawUserAgent.trim().slice(0, 256)
        : null,
  };
}

@Injectable()
export class IpAwareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return extractClientIp(req) ?? 'unknown-client';
  }
}

