import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { ValidatedEnvConfig } from '../config/env.validation';

/**
 * Human-readable description of a connection target with the password removed,
 * safe to write to logs. Never log the raw DATABASE_URL.
 */
export function describeDatabaseTarget(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const user = decodeURIComponent(parsed.username) || '(no user)';
    const database = parsed.pathname.replace(/^\//, '') || '(no database)';
    const port = parsed.port || '5432';
    return `${user}@${parsed.hostname}:${port}/${database}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

export function buildPooledDatabaseUrl(
  rawUrl: string,
  options: {
    connectionLimit: number;
    poolTimeoutSeconds: number;
    connectTimeoutSeconds: number;
    sslCaPath?: string;
  },
): string {
  const parsed = new URL(rawUrl);
  const isLocalHost =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  // Enforce encrypted TLS on non-local hosts (such as Aiven PostgreSQL)
  const currentSslMode = parsed.searchParams.get('sslmode');
  if (currentSslMode === 'disable' && !isLocalHost) {
    throw new Error(
      'Insecure database configuration: sslmode=disable is not permitted for remote PostgreSQL hosts.',
    );
  }

  if (options.sslCaPath) {
    parsed.searchParams.set('sslmode', 'verify-full');
    parsed.searchParams.set('sslrootcert', options.sslCaPath);
  } else if (!currentSslMode && !isLocalHost) {
    parsed.searchParams.set('sslmode', 'require');
  }

  // Conservative connection pool sizing for Aiven free-tier limits
  if (!parsed.searchParams.has('connection_limit')) {
    parsed.searchParams.set(
      'connection_limit',
      String(options.connectionLimit),
    );
  }
  if (!parsed.searchParams.has('pool_timeout')) {
    parsed.searchParams.set(
      'pool_timeout',
      String(options.poolTimeoutSeconds),
    );
  }
  if (!parsed.searchParams.has('connect_timeout')) {
    parsed.searchParams.set(
      'connect_timeout',
      String(options.connectTimeoutSeconds),
    );
  }

  return parsed.toString();
}

/**
 * Translates Prisma's connection errors into the actual operational cause.
 * Prisma reports authentication failures as `User was denied access on the
 * database `(not available)`` — the database name is unavailable precisely
 * because the handshake never completed, which reads like a privilege problem
 * when it is almost always a wrong username/password.
 */
export function summarizeConnectionFailure(message: string): string {
  if (message.includes('denied access on the database')) {
    return 'Authentication was rejected by PostgreSQL — the username or password in DATABASE_URL is wrong, or that role has no CONNECT privilege on the database.';
  }
  if (
    message.includes("Can't reach database server") ||
    message.includes('ECONNREFUSED')
  ) {
    return 'No PostgreSQL server accepted the connection — it is not running, or the host/port in DATABASE_URL is wrong.';
  }
  if (message.includes('does not exist')) {
    return 'PostgreSQL accepted the credentials but the database named in DATABASE_URL does not exist.';
  }
  if (message.includes('timed out') || message.includes('ETIMEDOUT')) {
    return 'The connection timed out — check network reachability, firewall rules, and DATABASE_CONNECT_TIMEOUT_SECONDS.';
  }
  return message.split('\n').filter(Boolean).pop() ?? message;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly target: string;

  constructor(configService: ConfigService<ValidatedEnvConfig, true>) {
    const rawDatabaseUrl = configService.get('DATABASE_URL', { infer: true });
    const connectionLimit = configService.get('DATABASE_CONNECTION_LIMIT', {
      infer: true,
    });
    const poolTimeoutSeconds = configService.get(
      'DATABASE_POOL_TIMEOUT_SECONDS',
      { infer: true },
    );
    const connectTimeoutSeconds = configService.get(
      'DATABASE_CONNECT_TIMEOUT_SECONDS',
      { infer: true },
    );
    const sslCaPath = configService.get('DATABASE_SSL_CA_PATH', {
      infer: true,
    });

    const pooledUrl = buildPooledDatabaseUrl(rawDatabaseUrl, {
      connectionLimit,
      poolTimeoutSeconds,
      connectTimeoutSeconds,
      sslCaPath: sslCaPath || undefined,
    });

    super({
      datasources: {
        db: {
          url: pooledUrl,
        },
      },
      log: ['error', 'warn'],
    });

    this.target = describeDatabaseTarget(rawDatabaseUrl);
  }

  /**
   * Verifies the database is reachable before the app accepts traffic, and aborts
   * startup if it is not. Booting "successfully" onto an unreachable database is
   * worse than crashing: every auth request then fails with an opaque 500 and the
   * real cause (bad credentials, wrong host, Postgres not running) is buried in a
   * Prisma stack trace instead of being stated once at startup.
   */
  async onModuleInit(): Promise<void> {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.$connect();
        await this.verifyConnectivity();
        this.logger.log(`Database connected — ${this.target}`);
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isLastAttempt = attempt === maxAttempts;

        this.logger.warn(
          `Database connection attempt ${attempt}/${maxAttempts} to ${this.target} failed: ${summarizeConnectionFailure(message)}`,
        );

        if (isLastAttempt) {
          throw new Error(
            [
              `Unable to connect to PostgreSQL at ${this.target}.`,
              summarizeConnectionFailure(message),
              '',
              'Checklist:',
              '  1. Is PostgreSQL running?            pg_isready -h <host> -p <port>',
              '  2. Do the credentials work directly? psql "$DATABASE_URL" -c "select 1"',
              '  3. Is DATABASE_URL the one you think it is? A stale `export DATABASE_URL=...`',
              '     in your shell no longer overrides .env.local, but a stale running process does —',
              '     restart the dev server after editing any .env file.',
              '  4. Have migrations been applied?     pnpm prisma:migrate:dev',
            ].join('\n'),
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async verifyConnectivity(): Promise<boolean> {
    const rows = await this.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    return Array.isArray(rows) && rows[0]?.ok === 1;
  }
}
