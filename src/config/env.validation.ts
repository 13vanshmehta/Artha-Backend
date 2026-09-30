export interface ValidatedEnvConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  CORS_ORIGINS: string[];
  DATABASE_URL: string;
  DATABASE_CONNECTION_LIMIT: number;
  DATABASE_POOL_TIMEOUT_SECONDS: number;
  DATABASE_CONNECT_TIMEOUT_SECONDS: number;
  DATABASE_SSL_CA_PATH: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  JWT_ACCESS_TTL_SECONDS: number;
  JWT_SIGNING_SECRET: string;
  REFRESH_TOKEN_TTL_DAYS: number;
  SESSION_ABSOLUTE_TTL_DAYS: number;
  REAUTH_WINDOW_SECONDS: number;
  OTP_EXPIRY_MINUTES: number;
  OTP_MAX_ATTEMPTS: number;
  OTP_RESEND_COOLDOWN_SECONDS: number;
  PASSWORD_MIN_LENGTH: number;
  PASSWORD_RESET_TTL_MINUTES: number;
  EMAIL_PROVIDER: 'smtp' | 'local-outbox';
  EMAIL_FROM: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER: string;
  SMTP_PASS: string;
  GOOGLE_WEB_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_IDS: string[];
  APPLE_CLIENT_IDS: string[];
}

const DEV_FALLBACK_JWT_SECRET =
  'artha-local-dev-only-jwt-signing-secret-key-2026-9f8e7d6c5b4a';

function readString(val: unknown, fallback = ''): string {
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return fallback;
}

export function validateEnvironment(
  rawEnv: Record<string, unknown>,
): ValidatedEnvConfig {
  const nodeEnvRaw = readString(rawEnv.NODE_ENV, 'development');
  const NODE_ENV: 'development' | 'test' | 'production' =
    nodeEnvRaw === 'production'
      ? 'production'
      : nodeEnvRaw === 'test'
        ? 'test'
        : 'development';

  const isProd = NODE_ENV === 'production';

  const databaseUrl =
    NODE_ENV === 'test'
      ? readString(
          rawEnv.TEST_DATABASE_URL,
          readString(
            rawEnv.DATABASE_URL,
            'postgresql://artha:artha@localhost:5432/artha_test?schema=public',
          ),
        )
      : readString(
          rawEnv.DATABASE_URL,
          'postgresql://artha:artha@localhost:5432/artha_dev?schema=public',
        );

  if (!databaseUrl || !databaseUrl.startsWith('postgres')) {
    throw new Error(
      'Invalid configuration: DATABASE_URL must be a valid PostgreSQL connection string.',
    );
  }

  if (isProd && !rawEnv.DATABASE_URL) {
    throw new Error(
      'Invalid production configuration: DATABASE_URL is required in production.',
    );
  }

  const jwtIssuer = readString(rawEnv.JWT_ISSUER, 'https://auth.artha.app');
  const jwtAudience = readString(rawEnv.JWT_AUDIENCE, 'artha-mobile-client');

  if (isProd && (!rawEnv.JWT_ISSUER || !rawEnv.JWT_AUDIENCE)) {
    throw new Error(
      'Invalid production configuration: JWT_ISSUER and JWT_AUDIENCE are required in production.',
    );
  }

  const jwtSigningSecret = readString(
    rawEnv.JWT_SIGNING_SECRET,
    isProd ? '' : DEV_FALLBACK_JWT_SECRET,
  );

  if (!jwtSigningSecret || jwtSigningSecret.length < 32) {
    throw new Error(
      'Invalid configuration: JWT_SIGNING_SECRET must be at least 32 characters long.',
    );
  }

  if (
    isProd &&
    (jwtSigningSecret === DEV_FALLBACK_JWT_SECRET ||
      jwtSigningSecret.includes('replace-with'))
  ) {
    throw new Error(
      'Invalid production configuration: JWT_SIGNING_SECRET must not use a development placeholder.',
    );
  }

  const smtpUser = readString(rawEnv.SMTP_USER ?? rawEnv.ARTHA_EMAIL_ID, '');
  const smtpPass = readString(
    rawEnv.SMTP_PASS ?? rawEnv.ARTHA_EMAIL_APP_PASSWORD,
    '',
  );

  const rawEmailProvider = readString(
    rawEnv.EMAIL_PROVIDER,
    NODE_ENV === 'test'
      ? 'local-outbox'
      : smtpUser && smtpPass
        ? 'smtp'
        : 'local-outbox',
  );

  if (rawEmailProvider !== 'smtp' && rawEmailProvider !== 'local-outbox') {
    throw new Error(
      'Invalid configuration: EMAIL_PROVIDER must be either "smtp" or "local-outbox".',
    );
  }

  if (isProd && rawEmailProvider === 'local-outbox') {
    throw new Error(
      'Invalid production configuration: EMAIL_PROVIDER="local-outbox" is forbidden in production.',
    );
  }

  if (isProd && (!smtpUser || !smtpPass)) {
    throw new Error(
      'Invalid production configuration: SMTP credentials (SMTP_USER/SMTP_PASS or ARTHA_EMAIL_ID/ARTHA_EMAIL_APP_PASSWORD) are required in production.',
    );
  }

  const parsePositiveInt = (
    val: unknown,
    fallback: number,
    name: string,
  ): number => {
    if (val === undefined || val === null || val === '') return fallback;
    const parsed = Number(val);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid configuration: ${name} must be a positive integer.`,
      );
    }
    return parsed;
  };

  const parseCsv = (val: unknown, fallback: string[] = []): string[] => {
    if (!val || typeof val !== 'string') return fallback;
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  return {
    NODE_ENV,
    PORT: parsePositiveInt(rawEnv.PORT, 3000, 'PORT'),
    CORS_ORIGINS: parseCsv(rawEnv.CORS_ORIGINS, [
      'http://localhost:3000',
      'http://localhost:8081',
      'http://10.0.2.2:3000',
    ]),
    DATABASE_URL: databaseUrl,
    DATABASE_CONNECTION_LIMIT: parsePositiveInt(
      rawEnv.DATABASE_CONNECTION_LIMIT,
      5,
      'DATABASE_CONNECTION_LIMIT',
    ),
    DATABASE_POOL_TIMEOUT_SECONDS: parsePositiveInt(
      rawEnv.DATABASE_POOL_TIMEOUT_SECONDS,
      15,
      'DATABASE_POOL_TIMEOUT_SECONDS',
    ),
    DATABASE_CONNECT_TIMEOUT_SECONDS: parsePositiveInt(
      rawEnv.DATABASE_CONNECT_TIMEOUT_SECONDS,
      10,
      'DATABASE_CONNECT_TIMEOUT_SECONDS',
    ),
    DATABASE_SSL_CA_PATH: readString(rawEnv.DATABASE_SSL_CA_PATH, ''),
    JWT_ISSUER: jwtIssuer,
    JWT_AUDIENCE: jwtAudience,
    JWT_ACCESS_TTL_SECONDS: parsePositiveInt(
      rawEnv.JWT_ACCESS_TTL_SECONDS ?? rawEnv.JWT_ACCESS_TTL,
      900,
      'JWT_ACCESS_TTL_SECONDS',
    ),
    JWT_SIGNING_SECRET: jwtSigningSecret,
    REFRESH_TOKEN_TTL_DAYS: parsePositiveInt(
      rawEnv.REFRESH_TOKEN_TTL_DAYS,
      30,
      'REFRESH_TOKEN_TTL_DAYS',
    ),
    SESSION_ABSOLUTE_TTL_DAYS: parsePositiveInt(
      rawEnv.SESSION_ABSOLUTE_TTL_DAYS,
      90,
      'SESSION_ABSOLUTE_TTL_DAYS',
    ),
    REAUTH_WINDOW_SECONDS: parsePositiveInt(
      rawEnv.REAUTH_WINDOW_SECONDS,
      300,
      'REAUTH_WINDOW_SECONDS',
    ),
    OTP_EXPIRY_MINUTES: parsePositiveInt(
      rawEnv.OTP_EXPIRY_MINUTES,
      10,
      'OTP_EXPIRY_MINUTES',
    ),
    OTP_MAX_ATTEMPTS: parsePositiveInt(
      rawEnv.OTP_MAX_ATTEMPTS,
      5,
      'OTP_MAX_ATTEMPTS',
    ),
    OTP_RESEND_COOLDOWN_SECONDS: parsePositiveInt(
      rawEnv.OTP_RESEND_COOLDOWN_SECONDS,
      60,
      'OTP_RESEND_COOLDOWN_SECONDS',
    ),
    PASSWORD_MIN_LENGTH: parsePositiveInt(
      rawEnv.PASSWORD_MIN_LENGTH,
      8,
      'PASSWORD_MIN_LENGTH',
    ),
    PASSWORD_RESET_TTL_MINUTES: parsePositiveInt(
      rawEnv.PASSWORD_RESET_TTL_MINUTES,
      30,
      'PASSWORD_RESET_TTL_MINUTES',
    ),
    EMAIL_PROVIDER: rawEmailProvider,
    EMAIL_FROM: readString(
      rawEnv.EMAIL_FROM,
      smtpUser
        ? `Artha Security <${smtpUser}>`
        : 'Artha Security <no-reply@artha.app>',
    ),
    SMTP_HOST: readString(rawEnv.SMTP_HOST, 'smtp.gmail.com'),
    SMTP_PORT: parsePositiveInt(rawEnv.SMTP_PORT, 465, 'SMTP_PORT'),
    SMTP_SECURE:
      readString(rawEnv.SMTP_SECURE, 'true').toLowerCase() !== 'false',
    SMTP_USER: smtpUser,
    SMTP_PASS: smtpPass,
    GOOGLE_WEB_CLIENT_ID: readString(rawEnv.GOOGLE_WEB_CLIENT_ID, ''),
    GOOGLE_OAUTH_CLIENT_IDS: Array.from(
      new Set(
        [
          readString(rawEnv.GOOGLE_WEB_CLIENT_ID, ''),
          ...parseCsv(rawEnv.GOOGLE_OAUTH_CLIENT_IDS, []),
        ].filter(
          (id) =>
            Boolean(id) &&
            !id.startsWith('your-') &&
            !id.includes('placeholder'),
        ),
      ),
    ),
    APPLE_CLIENT_IDS: parseCsv(rawEnv.APPLE_CLIENT_IDS, [
      'com.artha.app',
      'com.frontend',
    ]),
  };
}
