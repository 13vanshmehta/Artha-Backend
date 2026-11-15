import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { GroupRole, UserStatus } from '@prisma/client';
import { extractClientIp } from '../common/guards/ip-throttler.guard';
import { redactMetadata } from '../common/logging/security-logger.service';
import { validateEnvironment } from '../config/env.validation';
import { GroupAuthorizationService } from '../groups/group-authorization.service';
import { GroupsController } from '../groups/groups.controller';
import { buildPooledDatabaseUrl, PrismaService } from '../prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { MailService } from './mail.service';

describe('CryptoService, Redaction, Authorization & Environment Validation (Unit)', () => {
  const cryptoService = new CryptoService();

  it('hashes and verifies passwords using Argon2id and rejects wrong passwords', async () => {
    const hash = await cryptoService.hashPassword('StrongPass#2026');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await cryptoService.verifyPassword(hash, 'StrongPass#2026')).toBe(
      true,
    );
    expect(await cryptoService.verifyPassword(hash, 'WrongPass#2026')).toBe(
      false,
    );
  });

  it('generates 6-digit OTPs and verifies hashed secrets', async () => {
    const otp = cryptoService.generateSixDigitOtp();
    expect(otp).toMatch(/^\d{6}$/);
    const otpHash = await cryptoService.hashSecret(otp);
    expect(await cryptoService.verifySecret(otpHash, otp)).toBe(true);
    expect(await cryptoService.verifySecret(otpHash, '000000')).toBe(
      otp === '000000',
    );
  });

  it('normalizes email addresses consistently', () => {
    expect(cryptoService.normalizeEmail('  Vansh.Mehta@Artha.App ')).toBe(
      'vansh.mehta@artha.app',
    );
  });

  it('redacts sensitive fields recursively in security event metadata', () => {
    const raw = {
      email: 'user@artha.app',
      password: 'SuperSecretPassword!1',
      otp: '123456',
      refreshToken: 'opaque-token-value',
      nested: {
        accessToken: 'jwt-value',
        pin: '2580',
        deviceName: 'iPhone 16',
      },
    };
    const redacted = redactMetadata(raw);
    expect(redacted.email).toBe('user@artha.app');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.otp).toBe('[REDACTED]');
    expect(redacted.refreshToken).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).accessToken).toBe(
      '[REDACTED]',
    );
    expect((redacted.nested as Record<string, unknown>).pin).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).deviceName).toBe(
      'iPhone 16',
    );
  });

  function makeMockDatabaseUrl(opts?: {
    username?: string;
    password?: string;
    sslmode?: string;
  }): string {
    const u = new URL('postgres://db-service.invalid:5432/test_db');
    u.username = opts?.username ?? 'test_user';
    if (opts?.password) {
      u.password = opts.password;
    }
    if (opts?.sslmode) {
      u.searchParams.set('sslmode', opts.sslmode);
    }
    return u.toString();
  }

  it('never resolves the test database to DATABASE_URL (BE-23)', () => {
    const cfg = validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: makeMockDatabaseUrl(),
    });
    expect(cfg.DATABASE_URL).not.toBe(makeMockDatabaseUrl());
    expect(cfg.DATABASE_URL).toContain('artha_test');
  });

  it('bounds REFRESH_TOKEN_REUSE_GRACE_SECONDS to 0..120 with a default of 20', () => {
    expect(validateEnvironment({}).REFRESH_TOKEN_REUSE_GRACE_SECONDS).toBe(20);
    expect(
      validateEnvironment({ REFRESH_TOKEN_REUSE_GRACE_SECONDS: '0' })
        .REFRESH_TOKEN_REUSE_GRACE_SECONDS,
    ).toBe(0);
    expect(() =>
      validateEnvironment({ REFRESH_TOKEN_REUSE_GRACE_SECONDS: '121' }),
    ).toThrow(/between 0 and 120/);
    expect(() =>
      validateEnvironment({ REFRESH_TOKEN_REUSE_GRACE_SECONDS: '-1' }),
    ).toThrow(/between 0 and 120/);
  });

  it('rejects missing or placeholder secrets in production environment validation', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
      }),
    ).toThrow(/DATABASE_URL is required in production/);

    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: makeMockDatabaseUrl(),
        JWT_ISSUER: 'https://auth.artha.app',
        JWT_AUDIENCE: 'artha-mobile-client',
        JWT_SIGNING_SECRET: 'short',
      }),
    ).toThrow(/JWT_SIGNING_SECRET must be at least 32 characters/);

    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: makeMockDatabaseUrl(),
        JWT_ISSUER: 'https://auth.artha.app',
        JWT_AUDIENCE: 'artha-mobile-client',
        JWT_SIGNING_SECRET: 'unit-test-signing-secret-token-value-'.padEnd(48, '0'),
        EMAIL_PROVIDER: 'local-outbox',
      }),
    ).toThrow(/EMAIL_PROVIDER="local-outbox" is forbidden in production/);
  });

  it('preserves URL-encoded credentials, enforces TLS, and applies conservative connection pool parameters', () => {
    const rawEncoded = makeMockDatabaseUrl({
      username: 'test_user',
      password: 'p@ss:word',
      sslmode: 'require',
    });
    const pooled = buildPooledDatabaseUrl(rawEncoded, {
      connectionLimit: 5,
      poolTimeoutSeconds: 15,
      connectTimeoutSeconds: 10,
    });
    const parsed = new URL(pooled);
    expect(parsed.username).toBe('test_user');
    expect(parsed.password).toBe('p%40ss%3Aword');
    expect(parsed.searchParams.get('sslmode')).toBe('require');
    expect(parsed.searchParams.get('connection_limit')).toBe('5');
    expect(parsed.searchParams.get('pool_timeout')).toBe('15');
    expect(parsed.searchParams.get('connect_timeout')).toBe('10');

    const rawRequire = makeMockDatabaseUrl({
      username: 'test_user',
      password: 'test_pass',
      sslmode: 'require',
    });
    const withCa = buildPooledDatabaseUrl(rawRequire, {
      connectionLimit: 5,
      poolTimeoutSeconds: 15,
      connectTimeoutSeconds: 10,
      sslCaPath: '/etc/certs/ca.pem',
    });
    const parsedCa = new URL(withCa);
    expect(parsedCa.searchParams.get('sslmode')).toBe('verify-full');
    expect(parsedCa.searchParams.get('sslrootcert')).toBe('/etc/certs/ca.pem');

    const rawInsecureRemote = makeMockDatabaseUrl({
      username: 'test_user',
      password: 'test_pass',
      sslmode: 'disable',
    });
    expect(() =>
      buildPooledDatabaseUrl(rawInsecureRemote, {
        connectionLimit: 5,
        poolTimeoutSeconds: 15,
        connectTimeoutSeconds: 10,
      }),
    ).toThrow(/sslmode=disable is not permitted/);
  });

  it('merges GOOGLE_WEB_CLIENT_ID into GOOGLE_OAUTH_CLIENT_IDS and filters placeholder client IDs', () => {
    const validated = validateEnvironment({
      NODE_ENV: 'development',
      GOOGLE_WEB_CLIENT_ID: '999888777-web.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_IDS:
        'your-google-ios-client-id.apps.googleusercontent.com,999888777-extra.apps.googleusercontent.com',
    });

    expect(validated.GOOGLE_WEB_CLIENT_ID).toBe(
      '999888777-web.apps.googleusercontent.com',
    );
    expect(validated.GOOGLE_OAUTH_CLIENT_IDS).toEqual([
      '999888777-web.apps.googleusercontent.com',
      '999888777-extra.apps.googleusercontent.com',
    ]);
  });

  it('never lets the client choose its own IP via X-Forwarded-For (BE-03)', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevProxy = process.env.TRUST_PROXY;
    const restore = (key: 'NODE_ENV' | 'TRUST_PROXY', val?: string) => {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    };
    try {
      process.env.NODE_ENV = 'production';

      // No proxy configured: the header is ignored entirely.
      delete process.env.TRUST_PROXY;
      expect(
        extractClientIp({
          headers: { 'x-forwarded-for': '203.0.113.99' },
          ip: '198.51.100.42',
        }),
      ).toBe('198.51.100.42');

      // One trusted load balancer: it appended the real client (rightmost).
      // The forged leftmost value must be ignored.
      process.env.TRUST_PROXY = '1';
      expect(
        extractClientIp({
          headers: { 'x-forwarded-for': '203.0.113.99, 192.0.2.7' },
          ip: '10.0.0.1',
        }),
      ).toBe('192.0.2.7');

      // Legacy "true" means one hop, never "trust everything".
      process.env.TRUST_PROXY = 'true';
      expect(
        extractClientIp({
          headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 192.0.2.7' },
          ip: '10.0.0.1',
        }),
      ).toBe('192.0.2.7');

      // Two hops (CDN + load balancer): the second entry from the right.
      process.env.TRUST_PROXY = '2';
      expect(
        extractClientIp({
          headers: { 'x-forwarded-for': '1.1.1.1, 192.0.2.7, 172.16.0.5' },
          ip: '10.0.0.1',
        }),
      ).toBe('192.0.2.7');

      // Garbage or a too-short chain falls back to the socket address.
      process.env.TRUST_PROXY = '1';
      expect(
        extractClientIp({
          headers: { 'x-forwarded-for': 'not-an-ip' },
          ip: '10.0.0.1',
        }),
      ).toBe('10.0.0.1');
      process.env.TRUST_PROXY = '3';
      expect(
        extractClientIp({
          headers: { 'x-forwarded-for': '192.0.2.7' },
          ip: '10.0.0.1',
        }),
      ).toBe('10.0.0.1');
    } finally {
      restore('NODE_ENV', prevEnv);
      restore('TRUST_PROXY', prevProxy);
    }
  });

  it('blocks non-OWNER admins from granting OWNER/ADMIN roles or demoting the group OWNER', async () => {
    const mockPrisma = {
      user: {
        findUnique: async () => ({
          id: 'target-user-id',
          status: UserStatus.ACTIVE,
          deletedAt: null,
        }),
      },
      expenseGroupMember: {
        findUnique: async () => ({
          groupId: 'group-1',
          userId: 'owner-user-id',
          role: GroupRole.OWNER,
        }),
        upsert: async () => ({}),
      },
    } as unknown as PrismaService;

    const mockAuthz = {
      assertGroupMembership: async (userId: string) => ({
        id: 'group-1',
        name: 'Group 1',
        currency: 'INR',
        createdById: 'owner-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        membership: {
          id: 'mem-1',
          groupId: 'group-1',
          userId,
          role: userId === 'owner-user-id' ? GroupRole.OWNER : GroupRole.ADMIN,
          createdAt: new Date(),
        },
      }),
    } as unknown as GroupAuthorizationService;

    const mockMailService = {
      sendGroupInvitationEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as MailService;

    const controller = new GroupsController(
      mockPrisma,
      mockAuthz,
      mockMailService,
    );

    // 1. ADMIN attempting to escalate a user to OWNER must be rejected with ForbiddenException
    await expect(
      controller.addGroupMember(
        {
          userId: 'admin-user-id',
          sessionId: 'sess-1',
          email: 'admin@artha.app',
          displayName: 'Admin',
          timezone: 'Asia/Kolkata',
        },
        'group-1',
        { userId: 'target-user-id', role: GroupRole.OWNER },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // 2. Attempting to demote an existing OWNER to MEMBER must be rejected with BadRequestException
    await expect(
      controller.addGroupMember(
        {
          userId: 'owner-user-id',
          sessionId: 'sess-2',
          email: 'owner@artha.app',
          displayName: 'Owner',
          timezone: 'Asia/Kolkata',
        },
        'group-1',
        { userId: 'owner-user-id', role: GroupRole.MEMBER },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

