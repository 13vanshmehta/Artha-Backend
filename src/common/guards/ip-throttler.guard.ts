import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

export interface ClientRequestMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Extracts client IP safely.
 * In production, X-Forwarded-For is only trusted when TRUST_PROXY=true is explicitly set,
 * preventing unauthenticated attackers from spoofing X-Forwarded-For to bypass IP rate limits.
 */
export function extractClientIp(req: Record<string, unknown>): string | null {
  const trustForwardedHeader =
    process.env.TRUST_PROXY === 'true' ||
    process.env.NODE_ENV !== 'production';

  if (trustForwardedHeader) {
    const headers = req.headers as Record<string, unknown> | undefined;
    const forwarded = headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
      const candidate = forwarded.split(',')[0]?.trim();
      if (candidate) {
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

