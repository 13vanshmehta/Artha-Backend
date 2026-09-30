import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { ValidatedEnvConfig } from '../config/env.validation';

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

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
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
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async verifyConnectivity(): Promise<boolean> {
    const rows = await this.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    return Array.isArray(rows) && rows[0]?.ok === 1;
  }
}
