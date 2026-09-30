import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'passwordhash',
  'otp',
  'otphash',
  'code',
  'accesstoken',
  'refreshtoken',
  'resettoken',
  'token',
  'tokenhash',
  'idtoken',
  'identitytoken',
  'authorization',
  'pin',
  'pinhash',
  'secret',
  'clientsecret',
  'apppassword',
]);

export function redactMetadata(
  input: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      redacted[key] = '[REDACTED]';
    } else if (Array.isArray(value)) {
      redacted[key] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? redactMetadata(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactMetadata(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export interface SecurityEventInput {
  eventType: string;
  userId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class SecurityLoggerService {
  private readonly logger = new Logger(SecurityLoggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: SecurityEventInput): Promise<void> {
    const safeMetadata = redactMetadata(event.metadata);

    const logPayload = {
      eventType: event.eventType,
      userId: event.userId ?? null,
      sessionId: event.sessionId ?? null,
      ipAddress: event.ipAddress ?? null,
      metadata: safeMetadata,
      timestamp: new Date().toISOString(),
    };

    if (process.env.NODE_ENV !== 'test') {
      this.logger.log(JSON.stringify(logPayload));
    }

    try {
      await this.prisma.securityEvent.create({
        data: {
          eventType: event.eventType,
          userId: event.userId ?? null,
          sessionId: event.sessionId ?? null,
          ipAddress: event.ipAddress ? event.ipAddress.slice(0, 64) : null,
          userAgent: event.userAgent ? event.userAgent.slice(0, 256) : null,
          metadata: safeMetadata as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Never fail user requests if audit event persistence encounters transient error
    }
  }
}
