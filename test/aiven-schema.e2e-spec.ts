import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Aiven PostgreSQL Connectivity & Schema Verification (Read-Only)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('executes SELECT 1 connectivity check over TLS via PrismaService', async () => {
    const connected = await prisma.verifyConnectivity();
    expect(connected).toBe(true);
  });

  it('verifies public schema tables exist via read-only information_schema query', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;

    const tableNames = rows.map((r) => r.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        '_prisma_migrations',
        'AuthChallenge',
        'AuthIdentity',
        'AuthSession',
        'EmailVerificationChallenge',
        'ExpenseGroup',
        'ExpenseGroupMember',
        'ExpenseRecord',
        'PasswordResetChallenge',
        'RefreshToken',
        'SecurityEvent',
        'User',
        'UserSecurityPreference',
      ]),
    );
  });

  it('verifies foreign keys, unique constraints, and indexes on authentication models', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY indexname;
    `;
    const indexNames = indexes.map((i) => i.indexname);

    // Unique user email & unique provider identity
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'User_normalizedEmail_key',
        'AuthIdentity_provider_providerSubject_key',
        'AuthSession_userId_revokedAt_idx',
        'AuthSession_expiresAt_idx',
        'AuthChallenge_userId_type_consumedAt_idx',
        'AuthChallenge_expiresAt_idx',
        'SecurityEvent_userId_createdAt_idx',
        'SecurityEvent_eventType_createdAt_idx',
      ]),
    );

    const constraints = await prisma.$queryRaw<
      Array<{ constraint_name: string; constraint_type: string }>
    >`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
      ORDER BY constraint_name;
    `;
    const constraintNames = constraints.map((c) => c.constraint_name);

    // Session-to-user, Challenge-to-user, Identity-to-user, SecurityEvent-to-user relationships
    expect(constraintNames).toEqual(
      expect.arrayContaining([
        'AuthIdentity_userId_fkey',
        'AuthSession_userId_fkey',
        'AuthChallenge_userId_fkey',
        'EmailVerificationChallenge_userId_fkey',
        'PasswordResetChallenge_userId_fkey',
        'SecurityEvent_userId_fkey',
      ]),
    );
  });
});
