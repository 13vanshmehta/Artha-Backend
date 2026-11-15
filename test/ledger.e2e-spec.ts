import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureArthaApp } from '../src/app.setup';
import {
  addDays,
  formatLocalDate,
  localDateOf,
  startOfLocalDay,
} from '../src/common/time/local-calendar';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Personal Expense Tracker e2e suite: ownership, per-type rules, financial
 * correctness, idempotency, pagination, calendar-day windows and analytics,
 * all against the real database and the real HTTP pipeline.
 */

const EMAIL_DOMAIN = 'ledger.e2e.test';
const TZ = 'Asia/Kolkata';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function data(res: { body: any }): any {
  return res.body?.success === true ? res.body.data : res.body;
}

interface TestUser {
  id: string;
  token: string;
}

describe('Ledger (Personal Expense Tracker) E2E', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let ipSeq = 0;
  let ip = '10.200.0.1';

  const call = (user: TestUser) => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) =>
      r.set('Authorization', `Bearer ${user.token}`).set('X-Forwarded-For', ip);
    return {
      get: (url: string) => auth(request(server).get(`/api/v1${url}`)),
      post: (url: string, body?: object) =>
        auth(request(server).post(`/api/v1${url}`)).send(body ?? {}),
      patch: (url: string, body: object) =>
        auth(request(server).patch(`/api/v1${url}`)).send(body),
      delete: (url: string) => auth(request(server).delete(`/api/v1${url}`)),
    };
  };

  async function createUser(label: string, timezone = TZ): Promise<TestUser> {
    const email = `${label}-${randomUUID().slice(0, 8)}@${EMAIL_DOMAIN}`;
    const user = await prisma.user.create({
      data: {
        displayName: label,
        email,
        normalizedEmail: email,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        timezone,
      },
    });
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        deviceName: 'e2e',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const token = await jwt.signAsync(
      { sub: user.id, sid: session.id },
      {
        algorithm: 'HS256',
        secret: config.get('JWT_SIGNING_SECRET'),
        issuer: config.get('JWT_ISSUER'),
        audience: config.get('JWT_AUDIENCE'),
        expiresIn: 900,
      },
    );
    return { id: user.id, token };
  }

  async function defaultAccountId(user: TestUser): Promise<string> {
    const res = await call(user).get('/accounts').expect(200);
    return data(res).accounts.find((a: { isDefault: boolean }) => a.isDefault)
      .id;
  }

  async function createAccount(
    user: TestUser,
    name: string,
    extra: object = {},
  ): Promise<string> {
    const res = await call(user)
      .post('/accounts', { name, type: 'BANK', ...extra })
      .expect(201);
    return data(res).account.id;
  }

  async function systemCategory(user: TestUser, key: string): Promise<string> {
    const res = await call(user).get('/categories').expect(200);
    return data(res).categories.find(
      (c: { systemKey: string }) => c.systemKey === key,
    ).id;
  }

  async function txn(
    user: TestUser,
    body: Record<string, unknown>,
    status = 201,
  ) {
    const res = await call(user)
      .post('/transactions', {
        clientTransactionId: randomUUID(),
        occurredAt: new Date().toISOString(),
        ...body,
      })
      .expect(status);
    return data(res);
  }

  async function balanceOf(user: TestUser, accountId: string): Promise<string> {
    return data(await call(user).get(`/accounts/${accountId}`).expect(200))
      .account.currentBalanceMinor;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureArthaApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const [target] = await prisma.$queryRaw<
      Array<{ db: string; schema: string }>
    >`
      SELECT current_database() AS db, current_schema() AS schema`;
    if (
      !/test/i.test(target?.db ?? '') &&
      !/test/i.test(target?.schema ?? '')
    ) {
      throw new Error(
        `Refusing to run destructive ledger e2e tests against "${target?.db}".`,
      );
    }
  });

  beforeEach(async () => {
    ipSeq += 1;
    ip = `10.200.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
    await prisma.user.deleteMany({
      where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    });
    await app.close();
  });

  // ------------------------------------------------------------------ accounts & categories

  describe('accounts and categories', () => {
    it('provisions exactly one real Cash account with a zero balance, even under concurrent first loads', async () => {
      const u = await createUser('fresh');
      const results = await Promise.all([
        call(u).get('/accounts'),
        call(u).get('/accounts'),
        call(u).get('/home'),
      ]);
      results.forEach((r) => expect(r.status).toBe(200));
      const accounts = data(
        await call(u).get('/accounts').expect(200),
      ).accounts;
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({
        name: 'Cash',
        type: 'CASH',
        currency: 'INR',
        isDefault: true,
        openingBalanceMinor: '0',
        currentBalanceMinor: '0',
      });
    });

    it('enforces unique active account names and moves the default flag', async () => {
      const u = await createUser('acct');
      const cash = await defaultAccountId(u);
      const hdfc = await createAccount(u, 'HDFC Savings', { isDefault: true });
      const dup = await call(u)
        .post('/accounts', { name: 'hdfc savings', type: 'BANK' })
        .expect(409);
      expect(data(dup).errorCode).toBe('ACCOUNT_NAME_TAKEN');

      const list = data(await call(u).get('/accounts').expect(200)).accounts;
      expect(
        list
          .filter((a: { isDefault: boolean }) => a.isDefault)
          .map((a: { id: string }) => a.id),
      ).toEqual([hdfc]);

      // Archiving the default promotes the oldest active account.
      await call(u).delete(`/accounts/${hdfc}`).expect(200);
      const after = data(
        await call(u).get('/accounts?includeArchived=true').expect(200),
      ).accounts;
      expect(after.find((a: { id: string }) => a.id === cash).isDefault).toBe(
        true,
      );
      expect(after.find((a: { id: string }) => a.id === hdfc).isArchived).toBe(
        true,
      );

      // An archived name can be reused.
      await createAccount(u, 'HDFC Savings');
    });

    it('serves system categories to everyone, keeps custom ones private, and protects system ones', async () => {
      const a = await createUser('cat-a');
      const b = await createUser('cat-b');
      const expense = data(
        await call(a).get('/categories?type=EXPENSE').expect(200),
      ).categories;
      expect(expense.length).toBeGreaterThanOrEqual(14);
      expect(expense.every((c: { type: string }) => c.type === 'EXPENSE')).toBe(
        true,
      );

      const pet = data(
        await call(a)
          .post('/categories', {
            name: 'Pet Care',
            type: 'EXPENSE',
            color: '#F97316',
          })
          .expect(201),
      ).category;
      expect(pet.isSystem).toBe(false);

      const shadow = await call(a)
        .post('/categories', { name: 'groceries', type: 'EXPENSE' })
        .expect(409);
      expect(data(shadow).errorCode).toBe('CATEGORY_NAME_TAKEN');
      // Same name, other type is fine.
      await call(a)
        .post('/categories', { name: 'Pet Care', type: 'INCOME' })
        .expect(201);

      const bList = data(
        await call(b).get('/categories').expect(200),
      ).categories;
      expect(
        bList.find((c: { id: string }) => c.id === pet.id),
      ).toBeUndefined();
      await call(b)
        .patch(`/categories/${pet.id}`, { name: 'Mine now' })
        .expect(404);
      await call(b).delete(`/categories/${pet.id}`).expect(404);

      const food = await systemCategory(a, 'expense.food_dining');
      const sys = await call(a)
        .patch(`/categories/${food}`, { name: 'Food' })
        .expect(409);
      expect(data(sys).errorCode).toBe('SYSTEM_CATEGORY_READ_ONLY');
    });
  });

  // ------------------------------------------------------------------ ownership

  describe('ownership', () => {
    it('never lets one user read, change or reference another user’s data', async () => {
      const alice = await createUser('alice');
      const bob = await createUser('bob');
      const aliceCash = await defaultAccountId(alice);
      const bobCash = await defaultAccountId(bob);
      const food = await systemCategory(alice, 'expense.food_dining');
      const bobCustom = data(
        await call(bob)
          .post('/categories', { name: 'Bob Only', type: 'EXPENSE' })
          .expect(201),
      ).category.id;

      const aliceExpense = (
        await txn(alice, {
          type: 'EXPENSE',
          amountMinor: '10000',
          sourceAccountId: aliceCash,
          categoryId: food,
        })
      ).transaction;

      // Read / modify / delete / restore another user's transaction
      expect(
        data(
          await call(bob).get(`/transactions/${aliceExpense.id}`).expect(404),
        ).errorCode,
      ).toBe('TRANSACTION_NOT_FOUND');
      await call(bob)
        .patch(`/transactions/${aliceExpense.id}`, { amountMinor: '1' })
        .expect(404);
      await call(bob).delete(`/transactions/${aliceExpense.id}`).expect(404);
      await call(bob)
        .post(`/transactions/${aliceExpense.id}/restore`)
        .expect(404);

      // Another user's account
      await call(bob).get(`/accounts/${aliceCash}`).expect(404);
      expect(
        data(
          await call(bob)
            .patch(`/accounts/${aliceCash}`, { name: 'Pwned' })
            .expect(404),
        ).errorCode,
      ).toBe('ACCOUNT_NOT_FOUND');
      await call(bob).delete(`/accounts/${aliceCash}`).expect(404);

      // Attaching another user's account / category / transaction
      const viaAccount = await txn(
        bob,
        {
          type: 'EXPENSE',
          amountMinor: '100',
          sourceAccountId: aliceCash,
          categoryId: food,
        },
        404,
      );
      expect(viaAccount.errorCode).toBe('ACCOUNT_NOT_FOUND');
      await txn(
        bob,
        {
          type: 'TRANSFER',
          amountMinor: '100',
          sourceAccountId: bobCash,
          destinationAccountId: aliceCash,
        },
        404,
      );
      const viaCategory = await txn(
        alice,
        {
          type: 'EXPENSE',
          amountMinor: '100',
          sourceAccountId: aliceCash,
          categoryId: bobCustom,
        },
        404,
      );
      expect(viaCategory.errorCode).toBe('CATEGORY_NOT_FOUND');
      const viaRelated = await txn(
        bob,
        {
          type: 'REFUND',
          amountMinor: '100',
          destinationAccountId: bobCash,
          relatedTransactionId: aliceExpense.id,
        },
        404,
      );
      expect(viaRelated.errorCode).toBe('RELATED_TRANSACTION_NOT_FOUND');

      // userId in the body is rejected outright rather than trusted.
      await txn(
        bob,
        {
          type: 'EXPENSE',
          amountMinor: '100',
          sourceAccountId: bobCash,
          categoryId: food,
          userId: alice.id,
        },
        400,
      );

      // Lists, search and analytics never leak
      const bobList = data(
        await call(bob).get('/transactions?search=').expect(200),
      );
      expect(bobList.items).toHaveLength(0);
      const bobSummary = data(await call(bob).get('/summary').expect(200));
      expect(bobSummary.totals.expenseMinor).toBe('0');
      expect(await balanceOf(alice, aliceCash)).toBe('-10000');
    });
  });

  // ------------------------------------------------------------------ type rules

  describe('transaction type rules', () => {
    let u: TestUser;
    let cash: string;
    let bank: string;
    let food: string;
    let salary: string;

    beforeEach(async () => {
      u = await createUser('rules');
      cash = await defaultAccountId(u);
      bank = await createAccount(u, 'HDFC Savings');
      food = await systemCategory(u, 'expense.food_dining');
      salary = await systemCategory(u, 'income.salary');
    });

    const shapeError = (body: {
      errorCode: string;
      details?: { fieldErrors: Array<{ field: string }> };
    }) => {
      expect(body.errorCode).toBe('INVALID_TRANSACTION_SHAPE');
      return body.details!.fieldErrors.map((e) => e.field);
    };

    it('EXPENSE requires a source account and a category, and rejects a destination', async () => {
      expect(
        shapeError(await txn(u, { type: 'EXPENSE', amountMinor: '100' }, 400)),
      ).toEqual(expect.arrayContaining(['sourceAccountId', 'categoryId']));
      expect(
        shapeError(
          await txn(
            u,
            {
              type: 'EXPENSE',
              amountMinor: '100',
              sourceAccountId: cash,
              categoryId: food,
              destinationAccountId: bank,
            },
            400,
          ),
        ),
      ).toEqual(['destinationAccountId']);
      const mismatch = await txn(
        u,
        {
          type: 'EXPENSE',
          amountMinor: '100',
          sourceAccountId: cash,
          categoryId: salary,
        },
        400,
      );
      expect(mismatch.errorCode).toBe('CATEGORY_TYPE_MISMATCH');
    });

    it('INCOME requires the receiving account', async () => {
      expect(
        shapeError(
          await txn(
            u,
            { type: 'INCOME', amountMinor: '100', categoryId: salary },
            400,
          ),
        ),
      ).toEqual(['destinationAccountId']);
      const ok = (
        await txn(u, {
          type: 'INCOME',
          amountMinor: '100',
          categoryId: salary,
          destinationAccountId: bank,
          paymentMethod: 'BANK_TRANSFER',
        })
      ).transaction;
      expect(ok.destinationAccount).toMatchObject({
        id: bank,
        name: 'HDFC Savings',
      });
      expect(ok.sourceAccountId).toBeNull();
    });

    it('TRANSFER requires two different owned accounts and no category', async () => {
      expect(
        shapeError(
          await txn(
            u,
            {
              type: 'TRANSFER',
              amountMinor: '100',
              sourceAccountId: cash,
              destinationAccountId: cash,
            },
            400,
          ),
        ),
      ).toEqual(['destinationAccountId']);
      expect(
        shapeError(
          await txn(
            u,
            { type: 'TRANSFER', amountMinor: '100', sourceAccountId: cash },
            400,
          ),
        ),
      ).toEqual(['destinationAccountId']);
      expect(
        shapeError(
          await txn(
            u,
            {
              type: 'TRANSFER',
              amountMinor: '100',
              sourceAccountId: cash,
              destinationAccountId: bank,
              categoryId: food,
            },
            400,
          ),
        ),
      ).toEqual(['categoryId']);

      const usd = await createAccount(u, 'USD Wallet', {
        currency: 'USD',
        type: 'WALLET',
      });
      expect(
        (
          await txn(
            u,
            {
              type: 'TRANSFER',
              amountMinor: '100',
              sourceAccountId: cash,
              destinationAccountId: usd,
            },
            400,
          )
        ).errorCode,
      ).toBe('CURRENCY_MISMATCH');
    });

    it('REFUND requires a destination account and validates the refunded expense', async () => {
      expect(
        shapeError(await txn(u, { type: 'REFUND', amountMinor: '100' }, 400)),
      ).toEqual(['destinationAccountId']);
      expect(
        shapeError(
          await txn(
            u,
            {
              type: 'REFUND',
              amountMinor: '100',
              destinationAccountId: cash,
              sourceAccountId: bank,
            },
            400,
          ),
        ),
      ).toEqual(['sourceAccountId']);
      const income = (
        await txn(u, {
          type: 'INCOME',
          amountMinor: '100',
          categoryId: salary,
          destinationAccountId: bank,
        })
      ).transaction;
      expect(
        (
          await txn(
            u,
            {
              type: 'REFUND',
              amountMinor: '100',
              destinationAccountId: cash,
              relatedTransactionId: income.id,
            },
            400,
          )
        ).errorCode,
      ).toBe('INVALID_RELATED_TRANSACTION');
      // A standalone refund (no linked expense) is allowed.
      await txn(u, {
        type: 'REFUND',
        amountMinor: '100',
        destinationAccountId: cash,
      });
    });

    it('ADJUSTMENT requires an account, an explicit direction and a reason', async () => {
      expect(
        shapeError(
          await txn(
            u,
            { type: 'ADJUSTMENT', amountMinor: '100', accountId: cash },
            400,
          ),
        ),
      ).toEqual(expect.arrayContaining(['direction', 'note']));
      const badDirection = await txn(
        u,
        {
          type: 'ADJUSTMENT',
          amountMinor: '100',
          accountId: cash,
          direction: 'SIDEWAYS',
          note: 'x',
        },
        400,
      );
      expect(badDirection.errorCode).toBe('VALIDATION_ERROR');
      expect(
        shapeError(
          await txn(
            u,
            {
              type: 'ADJUSTMENT',
              amountMinor: '100',
              accountId: cash,
              direction: 'INCREASE',
              note: '   ',
            },
            400,
          ),
        ),
      ).toEqual(['note']);
      expect(
        shapeError(
          await txn(
            u,
            {
              type: 'ADJUSTMENT',
              amountMinor: '100',
              sourceAccountId: cash,
              direction: 'INCREASE',
              note: 'x',
            },
            400,
          ),
        ),
      ).toEqual(expect.arrayContaining(['accountId', 'sourceAccountId']));

      const inc = (
        await txn(u, {
          type: 'ADJUSTMENT',
          amountMinor: '700',
          accountId: cash,
          direction: 'INCREASE',
          note: 'Counted cash',
        })
      ).transaction;
      expect(inc).toMatchObject({
        accountId: cash,
        direction: 'INCREASE',
        destinationAccountId: cash,
        sourceAccountId: null,
      });
      await txn(u, {
        type: 'ADJUSTMENT',
        amountMinor: '200',
        accountId: cash,
        direction: 'DECREASE',
        note: 'Lost coin',
      });
      expect(await balanceOf(u, cash)).toBe('500');
    });

    it('validates money and dates strictly', async () => {
      const base = { type: 'EXPENSE', sourceAccountId: cash, categoryId: food };
      for (const amountMinor of [
        '500.25',
        500.25,
        '0',
        0,
        '-5',
        '1e3',
        'abc',
        true,
        '100000000000001',
      ]) {
        const res = await txn(u, { ...base, amountMinor }, 400);
        expect(res.errorCode).toBe('VALIDATION_ERROR');
      }
      // A safe JSON integer is accepted; the response is always a string.
      expect(
        (await txn(u, { ...base, amountMinor: 50025 })).transaction.amountMinor,
      ).toBe('50025');
      expect(
        (
          await txn(
            u,
            {
              ...base,
              amountMinor: '50025',
              occurredAt: '2026-11-15T10:00:00',
            },
            400,
          )
        ).errorCode,
      ).toBe('VALIDATION_ERROR');
      expect(
        (
          await txn(
            u,
            { ...base, amountMinor: '1', occurredAt: '1999-12-31T00:00:00Z' },
            400,
          )
        ).errorCode,
      ).toBe('INVALID_OCCURRED_AT');
      expect(
        (
          await txn(
            u,
            {
              ...base,
              amountMinor: '1',
              occurredAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
            },
            400,
          )
        ).errorCode,
      ).toBe('INVALID_OCCURRED_AT');
    });

    it('rejects archived accounts and categories for new entries but keeps history editable', async () => {
      const pet = data(
        await call(u)
          .post('/categories', { name: 'Pet', type: 'EXPENSE' })
          .expect(201),
      ).category.id;
      const t = (
        await txn(u, {
          type: 'EXPENSE',
          amountMinor: '100',
          sourceAccountId: bank,
          categoryId: pet,
        })
      ).transaction;
      await call(u).delete(`/accounts/${bank}`).expect(200);
      await call(u).delete(`/categories/${pet}`).expect(200);

      expect(
        (
          await txn(
            u,
            {
              type: 'EXPENSE',
              amountMinor: '100',
              sourceAccountId: bank,
              categoryId: food,
            },
            400,
          )
        ).errorCode,
      ).toBe('ACCOUNT_ARCHIVED');
      expect(
        (
          await txn(
            u,
            {
              type: 'EXPENSE',
              amountMinor: '100',
              sourceAccountId: cash,
              categoryId: pet,
            },
            400,
          )
        ).errorCode,
      ).toBe('CATEGORY_ARCHIVED');

      const edited = data(
        await call(u)
          .patch(`/transactions/${t.id}`, { note: 'still visible' })
          .expect(200),
      ).transaction;
      expect(edited).toMatchObject({
        note: 'still visible',
        category: { id: pet, isArchived: true },
        sourceAccount: { id: bank, isArchived: true },
      });
    });

    it('PATCH keeps type immutable, can clear optional fields, and re-validates the merged result', async () => {
      const t = (
        await txn(u, {
          type: 'EXPENSE',
          amountMinor: '100',
          sourceAccountId: cash,
          categoryId: food,
          payee: 'Cafe',
          paymentMethod: 'UPI',
        })
      ).transaction;
      await call(u)
        .patch(`/transactions/${t.id}`, { type: 'INCOME' })
        .expect(400);
      const cleared = data(
        await call(u)
          .patch(`/transactions/${t.id}`, {
            payee: null,
            paymentMethod: null,
            amountMinor: '250',
          })
          .expect(200),
      ).transaction;
      expect(cleared).toMatchObject({
        payee: null,
        paymentMethod: null,
        amountMinor: '250',
      });
      expect(
        (
          await call(u)
            .patch(`/transactions/${t.id}`, { destinationAccountId: bank })
            .expect(400)
        ).body.errorCode,
      ).toBe('INVALID_TRANSACTION_SHAPE');
      await call(u)
        .patch(`/transactions/${t.id}`, { categoryId: null })
        .expect(400);
      await call(u)
        .patch(`/transactions/${t.id}`, { amountMinor: null })
        .expect(400);
    });
  });

  // ------------------------------------------------------------------ financial correctness

  describe('financial correctness', () => {
    it('keeps transfers out of income/expense, nets refunds, and tracks balances exactly', async () => {
      const u = await createUser('money');
      const cash = await defaultAccountId(u);
      const bank = await createAccount(u, 'HDFC Savings', {
        openingBalanceMinor: '1000000',
      });
      const food = await systemCategory(u, 'expense.food_dining');
      const shopping = await systemCategory(u, 'expense.shopping');
      const salary = await systemCategory(u, 'income.salary');

      await txn(u, {
        type: 'INCOME',
        amountMinor: '5000000',
        destinationAccountId: bank,
        categoryId: salary,
      });
      await txn(u, {
        type: 'TRANSFER',
        amountMinor: '200000',
        sourceAccountId: bank,
        destinationAccountId: cash,
      });
      await txn(u, {
        type: 'EXPENSE',
        amountMinor: '45000',
        sourceAccountId: cash,
        categoryId: food,
        paymentMethod: 'CASH',
      });
      const order = (
        await txn(u, {
          type: 'EXPENSE',
          amountMinor: '249900',
          sourceAccountId: bank,
          categoryId: shopping,
          paymentMethod: 'UPI',
        })
      ).transaction;
      const refund = (
        await txn(u, {
          type: 'REFUND',
          amountMinor: '100000',
          destinationAccountId: bank,
          relatedTransactionId: order.id,
        })
      ).transaction;
      expect(refund.categoryId).toBe(shopping); // inherited from the refunded expense

      const s = data(
        await call(u).get('/summary?period=THIS_MONTH').expect(200),
      );
      expect(s.totals).toMatchObject({
        incomeMinor: '5000000',
        expenseMinor: '294900',
        refundsMinor: '100000',
        netSpendingMinor: '194900',
        netFlowMinor: '4805100',
        transferVolumeMinor: '200000',
        adjustments: { increaseMinor: '0', decreaseMinor: '0', netMinor: '0' },
      });
      const shoppingRow = s.byCategory.find(
        (c: { categoryId: string }) => c.categoryId === shopping,
      );
      expect(shoppingRow).toMatchObject({
        expenseMinor: '249900',
        refundsMinor: '100000',
        netSpendingMinor: '149900',
      });
      expect(s.byCategory[0].categoryId).toBe(shopping);
      const seriesSpend = s.series.reduce(
        (sum: bigint, p: { netSpendingMinor: string }) =>
          sum + BigInt(p.netSpendingMinor),
        0n,
      );
      expect(seriesSpend.toString()).toBe('194900');

      // bank: 10,000.00 + 50,000.00 − 2,000.00 − 2,499.00 + 1,000.00 = 56,501.00
      expect(await balanceOf(u, bank)).toBe('5650100');
      // cash: 2,000.00 − 450.00
      expect(await balanceOf(u, cash)).toBe('155000');

      const home = data(await call(u).get('/home').expect(200));
      expect(home.month).toMatchObject({
        incomeMinor: '5000000',
        netSpendingMinor: '194900',
      });
      expect(home.todaySpending.netSpendingMinor).toBe('194900');
      expect(home.totalBalanceMinor).toBe('5805100');
      expect(home.recentTransactions).toHaveLength(5);
    });

    it('caps refunds at the original expense, even when submitted concurrently', async () => {
      const u = await createUser('refund');
      const cash = await defaultAccountId(u);
      const food = await systemCategory(u, 'expense.food_dining');
      const exp = (
        await txn(u, {
          type: 'EXPENSE',
          amountMinor: '1000',
          sourceAccountId: cash,
          categoryId: food,
        })
      ).transaction;

      const attempts = await Promise.all(
        [1, 2, 3].map(() =>
          call(u).post('/transactions', {
            clientTransactionId: randomUUID(),
            type: 'REFUND',
            amountMinor: '400',
            occurredAt: new Date().toISOString(),
            destinationAccountId: cash,
            relatedTransactionId: exp.id,
          }),
        ),
      );
      expect(attempts.map((r) => r.status).sort((x, y) => x - y)).toEqual([
        201, 201, 422,
      ]);
      const rejected = attempts.find((r) => r.status === 422)!;
      expect(rejected.body.errorCode).toBe('REFUND_EXCEEDS_ORIGINAL');
      expect(rejected.body.details).toEqual({
        remainingRefundableMinor: '200',
      });

      // Cannot shrink the expense below what was refunded, nor delete it while refunds exist.
      expect(
        (
          await call(u)
            .patch(`/transactions/${exp.id}`, { amountMinor: '700' })
            .expect(422)
        ).body.errorCode,
      ).toBe('AMOUNT_BELOW_REFUNDED');
      expect(
        (await call(u).delete(`/transactions/${exp.id}`).expect(409)).body
          .errorCode,
      ).toBe('TRANSACTION_HAS_REFUNDS');
    });

    it('soft-deletes out of lists, balances and summaries, and restores back into them', async () => {
      const u = await createUser('undo');
      const cash = await defaultAccountId(u);
      const food = await systemCategory(u, 'expense.food_dining');
      const t = (
        await txn(u, {
          type: 'EXPENSE',
          amountMinor: '1234',
          sourceAccountId: cash,
          categoryId: food,
        })
      ).transaction;

      const deleted = data(
        await call(u).delete(`/transactions/${t.id}`).expect(200),
      ).transaction;
      expect(deleted.deletedAt).not.toBeNull();
      await call(u).delete(`/transactions/${t.id}`).expect(200); // idempotent
      expect(
        data(await call(u).get('/transactions').expect(200)).items,
      ).toHaveLength(0);
      expect(
        data(await call(u).get('/summary').expect(200)).totals.expenseMinor,
      ).toBe('0');
      expect(await balanceOf(u, cash)).toBe('0');
      expect(
        (
          await call(u)
            .patch(`/transactions/${t.id}`, { note: 'x' })
            .expect(409)
        ).body.errorCode,
      ).toBe('TRANSACTION_DELETED');
      // Still fetchable by id, for Undo UI
      expect(
        data(await call(u).get(`/transactions/${t.id}`).expect(200)).transaction
          .deletedAt,
      ).not.toBeNull();

      const restored = data(
        await call(u).post(`/transactions/${t.id}/restore`).expect(200),
      ).transaction;
      expect(restored.deletedAt).toBeNull();
      expect(
        data(await call(u).get('/transactions').expect(200)).items,
      ).toHaveLength(1);
      expect(
        data(await call(u).get('/summary').expect(200)).totals.expenseMinor,
      ).toBe('1234');
      expect(await balanceOf(u, cash)).toBe('-1234');
    });
  });

  // ------------------------------------------------------------------ idempotency

  describe('idempotency', () => {
    it('turns repeated and concurrent submissions of one clientTransactionId into exactly one record', async () => {
      const u = await createUser('idem');
      const cash = await defaultAccountId(u);
      const food = await systemCategory(u, 'expense.food_dining');
      const body = {
        clientTransactionId: randomUUID(),
        type: 'EXPENSE',
        amountMinor: '9900',
        occurredAt: '2026-11-10T09:30:00+05:30',
        sourceAccountId: cash,
        categoryId: food,
        payee: 'Chai Point',
      };

      const first = await call(u).post('/transactions', body).expect(201);
      expect(data(first).idempotentReplay).toBe(false);
      const retry = await call(u)
        .post('/transactions', { ...body, occurredAt: '2026-11-10T04:00:00Z' })
        .expect(200);
      expect(data(retry).idempotentReplay).toBe(true);
      expect(data(retry).transaction.id).toBe(data(first).transaction.id);

      const burstBody = { ...body, clientTransactionId: randomUUID() };
      const burst = await Promise.all(
        Array.from({ length: 6 }, () =>
          call(u).post('/transactions', burstBody),
        ),
      );
      expect(burst.map((r) => r.status).sort((x, y) => x - y)).toEqual([
        200, 200, 200, 200, 200, 201,
      ]);
      expect(new Set(burst.map((r) => data(r).transaction.id)).size).toBe(1);

      expect(await prisma.transaction.count({ where: { userId: u.id } })).toBe(
        2,
      );

      const reused = await call(u)
        .post('/transactions', { ...body, amountMinor: '9901' })
        .expect(409);
      expect(reused.body.errorCode).toBe('IDEMPOTENCY_KEY_REUSED');

      // Keys are per user: another user may use the same id.
      const other = await createUser('idem-other');
      const otherCash = await defaultAccountId(other);
      await call(other)
        .post('/transactions', { ...body, sourceAccountId: otherCash })
        .expect(201);
    });
  });

  // ------------------------------------------------------------------ retrieval

  describe('history, pagination, filters and recent', () => {
    it('pages through every row exactly once in a stable order for each sort', async () => {
      const u = await createUser('pages');
      const cash = await defaultAccountId(u);
      const food = await systemCategory(u, 'expense.food_dining');
      const sameInstant = '2026-11-01T12:00:00Z';
      const rows = Array.from({ length: 23 }, (_, i) => ({
        id: randomUUID(),
        userId: u.id,
        type: 'EXPENSE' as const,
        amountMinor: BigInt(100 * ((i % 7) + 1)),
        currency: 'INR',
        sourceAccountId: cash,
        categoryId: food,
        // Several rows share an instant and amounts repeat, to exercise tie-breaking.
        occurredAt: new Date(
          i % 3 === 0 ? sameInstant : Date.UTC(2026, 9, 1 + i, 8),
        ),
        clientTransactionId: `seed-${i}-${randomUUID().slice(0, 8)}`,
        requestFingerprint: '0'.repeat(64),
      }));
      await prisma.transaction.createMany({ data: rows });

      for (const sort of [
        'NEWEST',
        'OLDEST',
        'HIGHEST_AMOUNT',
        'LOWEST_AMOUNT',
      ]) {
        const full = data(
          await call(u).get(`/transactions?sort=${sort}&limit=100`).expect(200),
        );
        expect(full.items).toHaveLength(23);
        expect(full.hasMore).toBe(false);
        expect(full.nextCursor).toBeNull();

        const seen: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const qs: string = `sort=${sort}&limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
          const page = data(
            await call(u).get(`/transactions?${qs}`).expect(200),
          );
          seen.push(...page.items.map((t: { id: string }) => t.id));
          expect(page.hasMore).toBe(page.nextCursor !== null);
          cursor = page.nextCursor;
          pages += 1;
        } while (cursor);
        expect(pages).toBe(5);
        expect(seen).toEqual(full.items.map((t: { id: string }) => t.id));
        expect(new Set(seen).size).toBe(23);
      }

      const firstNewest = data(
        await call(u).get('/transactions?limit=5').expect(200),
      );
      expect(
        (
          await call(u)
            .get(`/transactions?sort=OLDEST&cursor=${firstNewest.nextCursor}`)
            .expect(400)
        ).body.errorCode,
      ).toBe('INVALID_CURSOR');
      expect(
        (await call(u).get('/transactions?cursor=not-a-cursor').expect(400))
          .body.errorCode,
      ).toBe('INVALID_CURSOR');
      await call(u).get('/transactions?limit=101').expect(400);
    });

    it('filters by type, account, category, payment method, amount, date and search', async () => {
      const u = await createUser('filters');
      const cash = await defaultAccountId(u);
      const bank = await createAccount(u, 'SBI');
      const food = await systemCategory(u, 'expense.food_dining');
      const fuel = await systemCategory(u, 'expense.fuel');
      const salary = await systemCategory(u, 'income.salary');

      await txn(u, {
        type: 'EXPENSE',
        amountMinor: '30000',
        sourceAccountId: cash,
        categoryId: food,
        paymentMethod: 'CASH',
        payee: 'Dosa Corner',
        occurredAt: '2026-11-03T13:00:00+05:30',
      });
      await txn(u, {
        type: 'EXPENSE',
        amountMinor: '250000',
        sourceAccountId: bank,
        categoryId: fuel,
        paymentMethod: 'UPI',
        note: 'Highway 50%_off pump',
        occurredAt: '2026-11-05T09:00:00+05:30',
      });
      await txn(u, {
        type: 'INCOME',
        amountMinor: '9000000',
        destinationAccountId: bank,
        categoryId: salary,
        occurredAt: '2026-11-01T10:00:00+05:30',
      });
      await txn(u, {
        type: 'TRANSFER',
        amountMinor: '50000',
        sourceAccountId: bank,
        destinationAccountId: cash,
        occurredAt: '2026-11-04T10:00:00+05:30',
      });

      const ids = async (qs: string) =>
        data(await call(u).get(`/transactions?${qs}`).expect(200)).items.map(
          (t: { type: string; amountMinor: string }) =>
            `${t.type}:${t.amountMinor}`,
        );

      expect(await ids('type=EXPENSE,TRANSFER&sort=LOWEST_AMOUNT')).toEqual([
        'EXPENSE:30000',
        'TRANSFER:50000',
        'EXPENSE:250000',
      ]);
      expect(await ids(`accountIds=${cash}&sort=OLDEST`)).toEqual([
        'EXPENSE:30000',
        'TRANSFER:50000',
      ]);
      expect(
        await ids(`categoryIds=${food}&categoryIds=${fuel}&sort=OLDEST`),
      ).toEqual(['EXPENSE:30000', 'EXPENSE:250000']);
      expect(await ids('paymentMethods=UPI')).toEqual(['EXPENSE:250000']);
      expect(
        await ids('minAmount=40000&maxAmount=300000&sort=LOWEST_AMOUNT'),
      ).toEqual(['TRANSFER:50000', 'EXPENSE:250000']);
      expect(await ids('from=2026-11-03&to=2026-11-04&sort=OLDEST')).toEqual([
        'EXPENSE:30000',
        'TRANSFER:50000',
      ]);
      expect(await ids('search=dosa')).toEqual(['EXPENSE:30000']);
      expect(await ids('search=salary')).toEqual(['INCOME:9000000']); // category name
      expect(await ids('search=50%25_')).toEqual(['EXPENSE:250000']);
      await call(u).get('/transactions?minAmount=10&maxAmount=5').expect(400);
      await call(u)
        .get('/transactions?from=2026-11-05&to=2026-11-01')
        .expect(400);
      await call(u).get('/transactions?from=2026-02-30').expect(400);
      await call(u).get('/transactions?type=LOAN').expect(400);
    });

    it('treats "recent" as three local calendar days, not 72 hours', async () => {
      for (const tz of ['Asia/Kolkata', 'America/Los_Angeles']) {
        const u = await createUser(
          `recent-${tz.split('/')[1].toLowerCase()}`,
          tz,
        );
        const cash = await defaultAccountId(u);
        const food = await systemCategory(u, 'expense.food_dining');
        const today = localDateOf(new Date(), tz);
        const twoDaysAgoStart = startOfLocalDay(addDays(today, -2), tz);

        const atStartOfWindow = new Date(twoDaysAgoStart.getTime() + 60_000);
        const justBeforeWindow = new Date(twoDaysAgoStart.getTime() - 60_000);
        await txn(u, {
          type: 'EXPENSE',
          amountMinor: '111',
          sourceAccountId: cash,
          categoryId: food,
          occurredAt: atStartOfWindow.toISOString(),
        });
        await txn(u, {
          type: 'EXPENSE',
          amountMinor: '222',
          sourceAccountId: cash,
          categoryId: food,
          occurredAt: justBeforeWindow.toISOString(),
        });
        await txn(u, {
          type: 'EXPENSE',
          amountMinor: '333',
          sourceAccountId: cash,
          categoryId: food,
        });

        const recent = data(
          await call(u).get('/transactions/recent').expect(200),
        );
        expect(recent.timezone).toBe(tz);
        expect(
          recent.days.map((d: { date: string; label: string }) => [
            d.label,
            d.date,
          ]),
        ).toEqual([
          ['TODAY', formatLocalDate(today)],
          ['YESTERDAY', formatLocalDate(addDays(today, -1))],
          ['TWO_DAYS_AGO', formatLocalDate(addDays(today, -2))],
        ]);
        expect(
          recent.days[0].items.map(
            (t: { amountMinor: string }) => t.amountMinor,
          ),
        ).toEqual(['333']);
        expect(
          recent.days[2].items.map(
            (t: { amountMinor: string }) => t.amountMinor,
          ),
        ).toEqual(['111']);
        const all = recent.days.flatMap(
          (d: { items: Array<{ amountMinor: string }> }) =>
            d.items.map((t) => t.amountMinor),
        );
        expect(all).not.toContain('222');
      }
    });
  });

  // ------------------------------------------------------------------ analytics & settings

  describe('summary and timezone', () => {
    it('buckets by the user’s local calendar and zero-fills the series', async () => {
      const u = await createUser('series');
      const cash = await defaultAccountId(u);
      const food = await systemCategory(u, 'expense.food_dining');
      // 23:30 IST on Nov 2 is still Nov 2 locally, although it is 18:00Z.
      await txn(u, {
        type: 'EXPENSE',
        amountMinor: '1000',
        sourceAccountId: cash,
        categoryId: food,
        occurredAt: '2026-11-02T23:30:00+05:30',
      });
      // 00:30 IST on Nov 3 is Nov 2 in UTC but Nov 3 locally.
      await txn(u, {
        type: 'EXPENSE',
        amountMinor: '2000',
        sourceAccountId: cash,
        categoryId: food,
        occurredAt: '2026-11-03T00:30:00+05:30',
      });

      const s = data(
        await call(u)
          .get('/summary?from=2026-11-01&to=2026-11-04&groupBy=DAY')
          .expect(200),
      );
      expect(
        s.series.map((p: { bucket: string; expenseMinor: string }) => [
          p.bucket,
          p.expenseMinor,
        ]),
      ).toEqual([
        ['2026-11-01', '0'],
        ['2026-11-02', '1000'],
        ['2026-11-03', '2000'],
        ['2026-11-04', '0'],
      ]);
      expect(s.range).toMatchObject({
        from: '2026-11-01',
        to: '2026-11-04',
        startUtc: '2026-10-31T18:30:00.000Z',
      });
      expect(s.elapsedDays).toBe(4);
      expect(s.averageDailySpendMinor).toBe('750');

      const weekly = data(
        await call(u)
          .get('/summary?from=2026-10-01&to=2026-11-30&groupBy=WEEK')
          .expect(200),
      );
      expect(weekly.series[0].bucket).toBe('2026-09-28'); // Oct 1 2026 is a Thursday; its ISO week starts Mon Sep 28
      expect(
        weekly.series.reduce(
          (n: bigint, p: { expenseMinor: string }) =>
            n + BigInt(p.expenseMinor),
          0n,
        ),
      ).toBe(3000n);

      await call(u)
        .get('/summary?period=THIS_MONTH&from=2026-11-01')
        .expect(400);
      await call(u).get('/summary?from=2020-01-01&to=2026-01-01').expect(400);
      await call(u)
        .get('/summary?from=2024-01-01&to=2026-01-01&groupBy=DAY')
        .expect(400);
    });

    it('lets the user change their timezone and validates it', async () => {
      const u = await createUser('tz');
      const bad = await call(u)
        .patch('/auth/me', { timezone: 'Mars/Olympus_Mons' })
        .expect(400);
      expect(bad.body.errorCode).toBe('INVALID_TIMEZONE');
      const ok = data(
        await call(u)
          .patch('/auth/me', { timezone: 'Europe/London' })
          .expect(200),
      );
      expect(ok.user.timezone).toBe('Europe/London');
      expect(
        data(await call(u).get('/transactions/recent').expect(200)).timezone,
      ).toBe('Europe/London');
    });
  });
});
