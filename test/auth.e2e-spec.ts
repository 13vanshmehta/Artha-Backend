import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthProvider, UserStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureArthaApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { CacheService } from '../src/common/cache/cache.service';
import {
  OAuthVerifierService,
  VerifiedOAuthIdentity,
} from '../src/auth/oauth-verifier.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Reads a response body the way the mobile app does (X-01). Successful responses
 * are wrapped by TransformInterceptor as `{ success: true, data, meta }`; error
 * responses from AllExceptionsFilter keep `errorCode`/`message` at the top level.
 * Asserting on the unwrapped payload keeps this suite honest about the real
 * wire contract instead of an imagined flat one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payload(res: { body: any }): any {
  const body = res.body;
  if (body && typeof body === 'object' && body.success === true && 'data' in body) {
    return body.data;
  }
  return body;
}

describe('Artha Authentication & Authorization E2E Suite', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailService: MailService;
  let oauthVerifier: OAuthVerifierService;
  let testSeq = 1;
  let currentTestIp = '10.0.0.1';
  let destructiveResetAllowed = false;

  const http = () => {
    const server = app.getHttpServer();
    return {
      get: (url: string) =>
        request(server).get(url).set('X-Forwarded-For', currentTestIp),
      post: (url: string) =>
        request(server).post(url).set('X-Forwarded-For', currentTestIp),
      patch: (url: string) =>
        request(server).patch(url).set('X-Forwarded-For', currentTestIp),
      delete: (url: string) =>
        request(server).delete(url).set('X-Forwarded-For', currentTestIp),
    };
  };

  beforeAll(async () => {
    // NODE_ENV, EMAIL_PROVIDER and OAuth client ids are set in setup-e2e-env.ts,
    // which runs before AppModule is imported.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureArthaApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    mailService = app.get(MailService);
    oauthVerifier = app.get(OAuthVerifierService);

    // Safety guard (BE-23): every test below wipes all tables. Refuse to run
    // unless we are connected to a database or schema that is clearly a test one,
    // so a mis-resolved DATABASE_URL can never erase dev or production data.
    const [target] = await prisma.$queryRaw<
      Array<{ db: string; schema: string }>
    >`SELECT current_database() AS db, current_schema() AS schema`;
    const looksLikeTestTarget =
      /test/i.test(target?.db ?? '') || /test/i.test(target?.schema ?? '');
    if (!looksLikeTestTarget) {
      throw new Error(
        `Refusing to run destructive e2e tests against database "${target?.db}" (schema "${target?.schema}"). ` +
          'Point TEST_DATABASE_URL at a database or schema whose name contains "test".',
      );
    }
    destructiveResetAllowed = true;
  });

  beforeEach(async () => {
    if (!destructiveResetAllowed) {
      throw new Error('Destructive reset blocked: test database was not verified.');
    }
    testSeq += 1;
    currentTestIp = `10.99.${Math.floor(testSeq / 250)}.${(testSeq % 250) + 1}`;
    mailService.clearTestOutbox();
    await app.get(CacheService).clear();
    await prisma.securityEvent.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.emailVerificationChallenge.deleteMany();
    await prisma.passwordResetChallenge.deleteMany();
    await prisma.authIdentity.deleteMany();
    await prisma.userSecurityPreference.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.account.deleteMany();
    await prisma.category.deleteMany({ where: { isSystem: false } });
    await prisma.expenseGroupMember.deleteMany();
    await prisma.expenseGroup.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Registration, Input Validation, Duplicate Email & OTP Verification', () => {
    it('rejects invalid registration input and weak passwords', async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({
          displayName: 'V',
          email: 'not-an-email',
          password: 'weak',
        })
        .expect(400);

      expect(payload(res).errorCode).toBe('VALIDATION_ERROR');
    });

    it('registers an unverified user, blocks unverified login, enforces OTP cooldown, verifies OTP, and issues tokens', async () => {
      const email = 'vansh.test@artha.app';
      const password = 'StrongPass#2026';

      const regRes = await http()
        .post('/api/v1/auth/register')
        .send({
          displayName: 'Vansh Mehta',
          email: '  Vansh.Test@Artha.App ',
          password,
        })
        .expect(201);

      expect(payload(regRes).verificationRequired).toBe(true);
      expect(payload(regRes).user.emailVerified).toBe(false);
      expect(payload(regRes).user.passwordHash).toBeUndefined();

      // Re-registering a still-unverified address right away hits the OTP cooldown
      // (it is reclaimable, not a conflict — see BE-02 tests below).
      const dupRes = await http()
        .post('/api/v1/auth/register')
        .send({
          displayName: 'Vansh Duplicate',
          email,
          password,
        })
        .expect(429);
      expect(payload(dupRes).errorCode).toBe('OTP_RESEND_COOLDOWN');

      // Login before email verification must be blocked
      const unverifiedLogin = await http()
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(403);
      expect(payload(unverifiedLogin).errorCode).toBe('EMAIL_NOT_VERIFIED');

      // Resend immediately hits cooldown
      const resendCooldownRes = await http()
        .post('/api/v1/auth/email/verification/send')
        .send({ email })
        .expect(429);
      expect(payload(resendCooldownRes).errorCode).toBe('OTP_RESEND_COOLDOWN');

      // Retrieve OTP from isolated test outbox
      const outboxMsg = mailService.getLatestTestOutboxMessage(
        email,
        'OTP_VERIFICATION',
      );
      expect(outboxMsg?.testOnlySecret).toMatch(/^\d{6}$/);
      const otp = outboxMsg!.testOnlySecret!;

      // Confirm OTP
      const confirmRes = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({
          email,
          code: otp,
          password,
          deviceName: 'iPhone 16 Pro',
          platform: 'ios',
        })
        .expect(200);

      expect(payload(confirmRes).accessToken).toBeDefined();
      expect(payload(confirmRes).refreshToken).toBeDefined();
      expect(payload(confirmRes).user.emailVerified).toBe(true);
      expect(payload(confirmRes).user.status).toBe(UserStatus.ACTIVE);

      // Reusing the same OTP must fail
      const reuseOtpRes = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: otp, password })
        .expect(400);
      expect(payload(reuseOtpRes).errorCode).toBe('OTP_ALREADY_USED');
    });

    it('enforces OTP expiry and max failed attempts limits', async () => {
      const email = 'otp.limits@artha.app';
      const password = 'StrongPass#2026';

      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'OTP Tester', email, password })
        .expect(201);

      const outboxMsg = mailService.getLatestTestOutboxMessage(
        email,
        'OTP_VERIFICATION',
      );
      const realOtp = outboxMsg!.testOnlySecret!;
      const wrongOtp = realOtp === '999999' ? '888888' : '999999';

      // Max attempts is 5: first 4 wrong attempts return 400 INVALID_OTP, 5th locks out with 429
      for (let attempt = 1; attempt <= 4; attempt++) {
        const failRes = await http()
          .post('/api/v1/auth/email/verification/confirm')
          .send({ email, code: wrongOtp, password })
          .expect(400);
        expect(payload(failRes).errorCode).toBe('INVALID_OTP');
        expect(payload(failRes).details.remainingAttempts).toBe(5 - attempt);
      }

      const lockRes = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: wrongOtp, password })
        .expect(429);
      expect(payload(lockRes).errorCode).toBe('OTP_MAX_ATTEMPTS_EXCEEDED');

      // Even presenting the real OTP after lockout must fail until a new OTP is issued
      await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: realOtp, password })
        .expect(429);

      // Expire the challenge in DB and reset attempts to test expired OTP error code
      const user = await prisma.user.findUniqueOrThrow({
        where: { normalizedEmail: email },
      });
      await prisma.emailVerificationChallenge.updateMany({
        where: { userId: user.id },
        data: {
          failedAttempts: 0,
          expiresAt: new Date(Date.now() - 60_000),
        },
      });

      const expiredRes = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: realOtp, password })
        .expect(400);
      expect(payload(expiredRes).errorCode).toBe('OTP_EXPIRED');
    });
  });

  describe('1b. Account pre-hijacking protection (BE-02)', () => {
    const victimEmail = 'victim@artha.app';
    const attackerPassword = 'Attacker#Pass2026';
    const victimPassword = 'Victim#Pass2026';

    const expireResendCooldown = () =>
      prisma.emailVerificationChallenge.updateMany({
        data: { resendAvailableAt: new Date(Date.now() - 1000) },
      });
    const latestOtp = () =>
      mailService.getLatestTestOutboxMessage(victimEmail, 'OTP_VERIFICATION')!
        .testOnlySecret!;
    const loginStatus = async (password: string) =>
      (
        await http()
          .post('/api/v1/auth/login')
          .send({ email: victimEmail, password })
      ).status;

    it('an attacker-planted password never survives the owner verifying the code', async () => {
      // Attacker registers the victim's address with their own password.
      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Attacker', email: victimEmail, password: attackerPassword })
        .expect(201);

      // The code lands in the victim's inbox; the victim completes sign-up with
      // their own password.
      await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email: victimEmail, code: latestOtp(), password: victimPassword })
        .expect(200);

      expect(await loginStatus(attackerPassword)).toBe(401);
      expect(await loginStatus(victimPassword)).toBe(200);
    });

    it('lets the owner reclaim an unverified address, even if the attacker re-registers last', async () => {
      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Attacker', email: victimEmail, password: attackerPassword })
        .expect(201);

      // Victim signs up: no "already registered" dead end.
      await expireResendCooldown();
      const victimReg = await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Real Owner', email: victimEmail, password: victimPassword })
        .expect(201);
      expect(payload(victimReg).user.displayName).toBe('Real Owner');

      // Attacker races in again afterwards, overwriting the pending password.
      await expireResendCooldown();
      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Attacker', email: victimEmail, password: attackerPassword })
        .expect(201);

      // Only the newest code is valid, and only the inbox owner sees it. The
      // owner's password is applied at verification, so the attacker still loses.
      await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email: victimEmail, code: latestOtp(), password: victimPassword })
        .expect(200);

      expect(await loginStatus(attackerPassword)).toBe(401);
      expect(await loginStatus(victimPassword)).toBe(200);
    });

    it('does not reopen a verified account and requires its real password on confirm', async () => {
      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Owner', email: victimEmail, password: victimPassword })
        .expect(201);
      const otp = latestOtp();
      await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email: victimEmail, code: otp, password: victimPassword })
        .expect(200);

      const dup = await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Attacker', email: victimEmail, password: attackerPassword })
        .expect(409);
      expect(payload(dup).errorCode).toBe('EMAIL_ALREADY_REGISTERED');
      expect(await loginStatus(victimPassword)).toBe(200);
    });

    it('rejects a weak password at verification without spending an OTP attempt', async () => {
      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Owner', email: victimEmail, password: victimPassword })
        .expect(201);

      const weak = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email: victimEmail, code: latestOtp(), password: 'weak' })
        .expect(400);
      expect(payload(weak).errorCode).toBe('WEAK_PASSWORD');

      const challenge = await prisma.emailVerificationChallenge.findFirst({
        where: { consumedAt: null },
      });
      expect(challenge?.failedAttempts).toBe(0);
    });
  });

  describe('1d. Atomic attempt limits and code purposes (BE-07, BE-08)', () => {
    const password = 'StrongPass#2026';
    let ipSeq = 0;
    const freshIp = () => {
      ipSeq += 1;
      return `198.18.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
    };

    async function registerVerified(email: string) {
      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Race User', email, password })
        .expect(201);
      const otp = mailService.getLatestTestOutboxMessage(email, 'OTP_VERIFICATION')!
        .testOnlySecret!;
      const res = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: otp, password })
        .expect(200);
      return payload(res).accessToken as string;
    }

    it('never lets parallel guesses exceed 5 attempts on one verification code', async () => {
      const email = 'otp.race@artha.app';
      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Race User', email, password })
        .expect(201);
      const realOtp = mailService.getLatestTestOutboxMessage(email, 'OTP_VERIFICATION')!
        .testOnlySecret!;
      const wrong = realOtp === '000000' ? '111111' : '000000';

      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          request(app.getHttpServer())
            .post('/api/v1/auth/email/verification/confirm')
            .set('X-Forwarded-For', freshIp())
            .send({ email, code: wrong, password }),
        ),
      );

      const invalid = results.filter((r) => payload(r).errorCode === 'INVALID_OTP');
      expect(invalid.length).toBeLessThanOrEqual(4);
      const challenge = await prisma.emailVerificationChallenge.findFirst({
        where: { user: { normalizedEmail: email } },
        orderBy: { createdAt: 'desc' },
      });
      expect(challenge?.failedAttempts).toBe(5);

      // The budget is gone: even the real code is refused now.
      const late = await request(app.getHttpServer())
        .post('/api/v1/auth/email/verification/confirm')
        .set('X-Forwarded-For', freshIp())
        .send({ email, code: realOtp, password })
        .expect(429);
      expect(payload(late).errorCode).toBe('OTP_MAX_ATTEMPTS_EXCEEDED');
    });

    it('never lets parallel PIN guesses exceed 5 attempts', async () => {
      const accessToken = await registerVerified('pin.race@artha.app');
      await http()
        .patch('/api/v1/users/me/security')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ pinEnabled: true, pin: '2580' })
        .expect(200);

      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          request(app.getHttpServer())
            .post('/api/v1/auth/re-authenticate')
            .set('X-Forwarded-For', freshIp())
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ pin: '0000' }),
        ),
      );

      const invalid = results.filter((r) => payload(r).errorCode === 'INVALID_PIN');
      expect(invalid.length).toBeLessThanOrEqual(4);
      const pref = await prisma.userSecurityPreference.findFirst({
        where: { user: { normalizedEmail: 'pin.race@artha.app' } },
      });
      expect(pref?.pinFailedAttempts).toBe(5);
      expect(pref?.pinLockedUntil).not.toBeNull();
    });

    it('refuses an email-change code at the sign-up confirm endpoint', async () => {
      const email = 'purpose@artha.app';
      const newEmail = 'purpose.new@artha.app';
      const accessToken = await registerVerified(email);

      await http()
        .post('/api/v1/auth/email/change/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ newEmail, currentPassword: password })
        .expect(200);
      const changeCode = mailService.getLatestTestOutboxMessage(
        newEmail,
        'OTP_VERIFICATION',
      )!.testOnlySecret!;

      // Redeeming it as a sign-up code — at either address — must not open a session.
      for (const target of [email, newEmail]) {
        const res = await http()
          .post('/api/v1/auth/email/verification/confirm')
          .send({ email: target, code: changeCode, password });
        expect(res.status).not.toBe(200);
        expect(payload(res).accessToken).toBeUndefined();
      }

      // The code is untouched and still works for its real purpose.
      const confirm = await http()
        .post('/api/v1/auth/email/change/confirm')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: changeCode })
        .expect(200);
      expect(payload(confirm).user.email).toBe(newEmail);
    });
  });

  describe('1c. Per-account login throttling (BE-03)', () => {
    it('locks an account after 10 failures even when every attempt comes from a new IP', async () => {
      const email = 'throttle@artha.app';
      const password = 'StrongPass#2026';
      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Throttle User', email, password })
        .expect(201);
      const otp = mailService.getLatestTestOutboxMessage(email, 'OTP_VERIFICATION')!
        .testOnlySecret!;
      await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: otp, password })
        .expect(200);

      const loginFrom = (ip: string, pwd: string) =>
        request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email, password: pwd });

      // A success before the limit clears the counter.
      for (let i = 0; i < 9; i++) {
        await loginFrom(`198.51.100.${i + 1}`, 'Wrong#Pass2026').expect(401);
      }
      await loginFrom('198.51.100.50', password).expect(200);

      // 10 fresh failures, each from a different address.
      for (let i = 0; i < 10; i++) {
        await loginFrom(`203.0.113.${i + 1}`, 'Wrong#Pass2026').expect(401);
      }

      // The account is now locked for everyone — even with the right password
      // from a brand-new IP.
      const locked = await loginFrom('192.0.2.200', password).expect(429);
      expect(payload(locked).errorCode).toBe('TOO_MANY_LOGIN_ATTEMPTS');
      expect(payload(locked).details.retryAfterSeconds).toBeGreaterThan(0);

      // Unknown accounts are throttled identically (no enumeration signal).
      for (let i = 0; i < 10; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', `192.0.2.${i + 1}`)
          .send({ email: 'nobody@artha.app', password: 'Wrong#Pass2026' })
          .expect(401);
      }
      const ghost = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', '192.0.2.99')
        .send({ email: 'nobody@artha.app', password: 'Wrong#Pass2026' })
        .expect(429);
      expect(payload(ghost).errorCode).toBe('TOO_MANY_LOGIN_ATTEMPTS');
    });
  });

  describe('2. Password Login, Recovery, Reset-Token Reuse & Session Revocation', () => {
    const email = 'recovery.user@artha.app';
    const password = 'InitialPass#2026';

    async function createVerifiedUserAndLogin() {
      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Recovery User', email, password })
        .expect(201);

      const otp = mailService.getLatestTestOutboxMessage(
        email,
        'OTP_VERIFICATION',
      )!.testOnlySecret!;

      const sessionRes = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: otp, password })
        .expect(200);

      return payload(sessionRes) as {
        accessToken: string;
        refreshToken: string;
        session: { id: string };
      };
    }

    it('validates correct/incorrect passwords and rejects suspended accounts', async () => {
      await createVerifiedUserAndLogin();

      // Wrong password rejected with 401
      const badPass = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPassword#123' })
        .expect(401);
      expect(payload(badPass).errorCode).toBe('INVALID_CREDENTIALS');

      // Correct password succeeds
      const goodLogin = await http()
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      expect(payload(goodLogin).accessToken).toBeDefined();

      // Suspend user and verify login is rejected with 403
      await prisma.user.update({
        where: { normalizedEmail: email },
        data: { status: UserStatus.SUSPENDED },
      });

      const suspendedRes = await http()
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(403);
      expect(payload(suspendedRes).errorCode).toBe('ACCOUNT_SUSPENDED_OR_DISABLED');
    });

    it('returns generic password recovery responses, resets password, prevents token reuse, and revokes existing sessions', async () => {
      const initialSession = await createVerifiedUserAndLogin();

      // Unknown email returns the exact same generic message
      const unknownForgot = await http()
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'nonexistent@artha.app' })
        .expect(200);

      const knownForgot = await http()
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(200);

      expect(payload(unknownForgot).message).toBe(payload(knownForgot).message);

      const resetMsg = mailService.getLatestTestOutboxMessage(
        email,
        'PASSWORD_RESET',
      );
      expect(resetMsg?.testOnlySecret).toBeDefined();
      const resetToken = resetMsg!.testOnlySecret!;

      const newPassword = 'NewStrongPass#2027';
      await http()
        .post('/api/v1/auth/password/reset')
        .send({
          email,
          resetToken,
          newPassword,
        })
        .expect(200);

      // Reusing the reset token must fail
      const reuseReset = await http()
        .post('/api/v1/auth/password/reset')
        .send({
          email,
          resetToken,
          newPassword: 'AnotherPass#2028',
        })
        .expect(400);
      expect(payload(reuseReset).errorCode).toBe('RESET_TOKEN_ALREADY_USED');

      // Existing access token and refresh token must now be revoked!
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${initialSession.accessToken}`)
        .expect(401);

      await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: initialSession.refreshToken })
        .expect(401);

      // Login with new password succeeds
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: newPassword })
        .expect(200);
    });

    it('uses a typeable 6-digit reset code with a 5-attempt limit (BE-10)', async () => {
      await createVerifiedUserAndLogin();

      await http().post('/api/v1/auth/password/forgot').send({ email }).expect(200);
      const code = mailService.getLatestTestOutboxMessage(email, 'PASSWORD_RESET')!
        .testOnlySecret!;
      expect(code).toMatch(/^\d{6}$/);

      // Long opaque tokens are no longer accepted at all.
      await http()
        .post('/api/v1/auth/password/reset')
        .send({ email, resetToken: 'x'.repeat(43), newPassword: 'NewStrongPass#2027' })
        .expect(400);

      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/password/reset')
          .set('X-Forwarded-For', `198.19.0.${i + 1}`)
          .send({ email, resetToken: wrong, newPassword: 'NewStrongPass#2027' })
          .expect(400);
        expect(payload(res).details.remainingAttempts).toBe(4 - i);
      }
      const fifth = await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .set('X-Forwarded-For', '198.19.0.9')
        .send({ email, resetToken: wrong, newPassword: 'NewStrongPass#2027' })
        .expect(429);
      expect(payload(fifth).errorCode).toBe('RESET_MAX_ATTEMPTS_EXCEEDED');

      // Even the real code is dead now; the old password still works.
      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .set('X-Forwarded-For', '198.19.0.10')
        .send({ email, resetToken: code, newPassword: 'NewStrongPass#2027' })
        .expect(429);
      await http().post('/api/v1/auth/login').send({ email, password }).expect(200);

      // A fresh request issues a fresh code with a fresh budget.
      await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .set('X-Forwarded-For', '198.19.0.11')
        .send({ email })
        .expect(200);
      const fresh = mailService.getLatestTestOutboxMessage(email, 'PASSWORD_RESET')!
        .testOnlySecret!;
      await request(app.getHttpServer())
        .post('/api/v1/auth/password/reset')
        .set('X-Forwarded-For', '198.19.0.12')
        .send({ email, resetToken: fresh, newPassword: 'NewStrongPass#2027' })
        .expect(200);
    });
  });

  describe('3. Refresh Token Rotation, Concurrent Refresh & Reuse Detection', () => {
    it('rotates refresh tokens atomically and revokes the entire session family when a consumed token is replayed', async () => {
      const email = 'rotation.user@artha.app';
      const password = 'StrongPass#2026';

      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Rotation User', email, password })
        .expect(201);

      const otp = mailService.getLatestTestOutboxMessage(
        email,
        'OTP_VERIFICATION',
      )!.testOnlySecret!;

      const initial = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: otp, password })
        .expect(200);

      const token1 = payload(initial).refreshToken as string;

      // Rotate token1 -> token2
      const rotated = await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token1 })
        .expect(200);

      const token2 = payload(rotated).refreshToken as string;
      const access2 = payload(rotated).accessToken as string;
      expect(token2).not.toBe(token1);

      // Verify raw refresh token is NEVER stored in database (only hash)
      const storedTokens = await prisma.refreshToken.findMany();
      for (const st of storedTokens) {
        expect(st.tokenHash).not.toBe(token1);
        expect(st.tokenHash).not.toBe(token2);
      }

      // Lost-response retry (BE-06): the client never received token2 and retries
      // with token1 inside the grace window. token2 was never used, so this is
      // answered with a fresh pair instead of revoking the session.
      const graceRetry = await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token1 })
        .expect(200);
      const token3 = payload(graceRetry).refreshToken as string;
      expect(token3).not.toBe(token2);

      // The normal chain continues from the token the client actually holds.
      const rotatedAgain = await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token3 })
        .expect(200);
      const token4 = payload(rotatedAgain).refreshToken as string;
      const access4 = payload(rotatedAgain).accessToken as string;

      // Replaying token1 now is theft: its replacement (token2) has been consumed.
      // Must trigger REFRESH_TOKEN_REUSED and revoke the session & whole family.
      const replayRes = await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token1 })
        .expect(401);

      expect(payload(replayRes).errorCode).toBe('REFRESH_TOKEN_REUSED');

      await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token4 })
        .expect(401);

      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${access4}`)
        .expect(401);

      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${access2}`)
        .expect(401);
    });

    it('revokes the session when a consumed token is replayed after the grace window', async () => {
      const email = 'grace-expired@artha.app';
      const password = 'StrongPass#2026';

      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Grace Expired', email, password })
        .expect(201);

      const otp = mailService.getLatestTestOutboxMessage(
        email,
        'OTP_VERIFICATION',
      )!.testOnlySecret!;

      const initial = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: otp, password })
        .expect(200);
      const token1 = payload(initial).refreshToken as string;

      const rotated = await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token1 })
        .expect(200);
      const token2 = payload(rotated).refreshToken as string;

      // Age token1's consumption beyond the grace window.
      await prisma.refreshToken.updateMany({
        where: { consumedAt: { not: null } },
        data: { consumedAt: new Date(Date.now() - 10 * 60 * 1000) },
      });

      const replayRes = await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token1 })
        .expect(401);
      expect(payload(replayRes).errorCode).toBe('REFRESH_TOKEN_REUSED');

      await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token2 })
        .expect(401);

      const sessions = await prisma.authSession.findMany({
        where: { user: { normalizedEmail: email } },
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].revokeReason).toBe('REFRESH_TOKEN_REUSE_DETECTED');
    });

    it('handles concurrent refresh attempts safely so at most one succeeds', async () => {
      const email = 'concurrent@artha.app';
      const password = 'StrongPass#2026';

      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Concurrent User', email, password })
        .expect(201);

      const otp = mailService.getLatestTestOutboxMessage(
        email,
        'OTP_VERIFICATION',
      )!.testOnlySecret!;

      const initial = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: otp, password })
        .expect(200);

      const refreshToken = payload(initial).refreshToken as string;

      const [resA, resB] = await Promise.all([
        http().post('/api/v1/auth/token/refresh').send({ refreshToken }),
        http().post('/api/v1/auth/token/refresh').send({ refreshToken }),
      ]);

      // Exactly one rotation wins. The loser either lost the in-transaction race
      // (409 conflict, nothing revoked — BE-05) or arrived after the winner
      // committed and was served as a grace retry (200). It must never revoke
      // the session the winner just rotated.
      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect([
        [200, 200],
        [200, 409],
      ]).toContainEqual(statuses);

      // The session is still alive: the most recently issued token keeps working.
      const issued = await prisma.refreshToken.findMany({
        where: { consumedAt: null, revokedAt: null },
      });
      expect(issued).toHaveLength(1);
      const winners = [resA, resB].filter((r) => r.status === 200);
      const liveRaw = winners
        .map((r) => payload(r).refreshToken as string)
        .find(
          (raw) =>
            createHash('sha256').update(raw, 'utf8').digest('hex') ===
            issued[0].tokenHash,
        );
      expect(liveRaw).toBeDefined();
      await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: liveRaw })
        .expect(200);

      const session = await prisma.authSession.findFirst({
        where: { user: { normalizedEmail: email } },
      });
      expect(session?.revokedAt).toBeNull();
    });
  });

  describe('4. Google and Apple OAuth Verification, Collisions & Account Linking', () => {
    it('rejects malformed or invalid Google and Apple identity tokens', async () => {
      await http()
        .post('/api/v1/auth/oauth/google')
        .send({ idToken: 'invalid-token' })
        .expect(401);

      await http()
        .post('/api/v1/auth/oauth/apple')
        .send({ identityToken: 'invalid-apple-token' })
        .expect(401);
    });

    it('prevents unsafe auto-merging on email collision and supports authenticated linking and safe unlinking', async () => {
      const email = 'social.user@artha.app';
      const password = 'StrongPass#2026';

      // 1. Register & verify password account
      await http()
        .post('/api/v1/auth/register')
        .send({ displayName: 'Social User', email, password })
        .expect(201);

      const otp = mailService.getLatestTestOutboxMessage(
        email,
        'OTP_VERIFICATION',
      )!.testOnlySecret!;

      const sessionRes = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: otp, password })
        .expect(200);

      const accessToken = payload(sessionRes).accessToken as string;

      // Mock OAuthVerifierService to return a verified Google identity with the same email
      const googleVerifySpy = jest
        .spyOn(oauthVerifier, 'verifyGoogleIdToken')
        .mockResolvedValue({
          provider: AuthProvider.GOOGLE,
          providerSubject: 'google-sub-12345',
          email,
          emailVerified: true,
          displayName: 'Social User',
        } satisfies VerifiedOAuthIdentity);

      // 2. Unauthenticated Google login with colliding email MUST NOT auto-merge!
      const collisionRes = await http()
        .post('/api/v1/auth/oauth/google')
        .send({ idToken: 'header.payload.sig' })
        .expect(409);

      expect(payload(collisionRes).errorCode).toBe('ACCOUNT_LINKING_REQUIRED');

      // 3. Authenticated linking succeeds
      const linkRes = await http()
        .post('/api/v1/auth/oauth/link/google')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ idToken: 'header.payload.sig' })
        .expect(200);

      expect(payload(linkRes).user.linkedProviders).toContain(AuthProvider.GOOGLE);

      // 4. Subsequent Google login now succeeds for the linked identity
      const googleLoginRes = await http()
        .post('/api/v1/auth/oauth/google')
        .send({ idToken: 'header.payload.sig' })
        .expect(200);
      expect(payload(googleLoginRes).user.id).toBe(payload(sessionRes).user.id);

      // 5. Unlinking Google succeeds because password auth still exists
      const unlinkRes = await http()
        .delete('/api/v1/auth/oauth/google')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(payload(unlinkRes).user.linkedProviders).not.toContain(
        AuthProvider.GOOGLE,
      );

      googleVerifySpy.mockRestore();
    });

    it('atomically creates User + AuthIdentity for new Google users, reuses identity on subsequent logins, and rejects unverified Google emails', async () => {
      const googleVerifySpy = jest.spyOn(oauthVerifier, 'verifyGoogleIdToken');

      // 1. Reject unverified Google email claim
      googleVerifySpy.mockResolvedValueOnce({
        provider: AuthProvider.GOOGLE,
        providerSubject: 'google-sub-unverified-999',
        email: 'unverified.google@artha.app',
        emailVerified: false,
        displayName: 'Unverified Google User',
      });

      const unverifiedRes = await http()
        .post('/api/v1/auth/oauth/google')
        .send({ idToken: 'header.payload.sig' })
        .expect(403);
      expect(payload(unverifiedRes).errorCode).toBe('OAUTH_EMAIL_UNVERIFIED');

      // 2. First-time verified Google user -> atomically creates User, AuthIdentity, and UserSecurityPreference
      googleVerifySpy.mockResolvedValue({
        provider: AuthProvider.GOOGLE,
        providerSubject: 'google-sub-brandnew-777',
        email: 'new.google.user@artha.app',
        emailVerified: true,
        displayName: 'New Google User',
        avatarUrl: 'https://lh3.googleusercontent.com/a/new-google-avatar',
      });

      const firstLoginRes = await http()
        .post('/api/v1/auth/oauth/google')
        .send({
          idToken: 'header.payload.sig',
          deviceName: 'Pixel 9 Pro',
          platform: 'android',
        })
        .expect(200);

      const createdUserId = payload(firstLoginRes).user.id as string;
      expect(createdUserId).toBeTruthy();
      expect(payload(firstLoginRes).user.email).toBe('new.google.user@artha.app');
      expect(payload(firstLoginRes).user.displayName).toBe('New Google User');
      expect(payload(firstLoginRes).user.avatarUrl).toBe(
        'https://lh3.googleusercontent.com/a/new-google-avatar',
      );
      expect(payload(firstLoginRes).user.emailVerified).toBe(true);
      expect(payload(firstLoginRes).user.hasPassword).toBe(false);
      expect(payload(firstLoginRes).user.linkedProviders).toEqual([
        AuthProvider.GOOGLE,
      ]);
      expect(payload(firstLoginRes).accessToken).toBeTruthy();
      expect(payload(firstLoginRes).refreshToken).toBeTruthy();

      // Verify AuthIdentity record in PostgreSQL
      const identityInDb = await prisma.authIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: AuthProvider.GOOGLE,
            providerSubject: 'google-sub-brandnew-777',
          },
        },
      });
      expect(identityInDb).not.toBeNull();
      expect(identityInDb?.userId).toBe(createdUserId);

      // 3. Subsequent Google Sign-In with same providerSubject resolves the same User without duplicating
      const secondLoginRes = await http()
        .post('/api/v1/auth/oauth/google')
        .send({
          idToken: 'header.payload.sig',
          deviceName: 'iPhone 16 Pro',
          platform: 'ios',
        })
        .expect(200);

      expect(payload(secondLoginRes).user.id).toBe(createdUserId);

      googleVerifySpy.mockRestore();
    });
  });

  describe('5. Cross-User Resource Access Rejection (IDOR Protection), Security Preferences & Rate Limiting', () => {
    let ipCounter = 10;

    async function registerAndVerify(email: string, displayName: string) {
      ipCounter += 1;
      const clientIp = `10.10.0.${ipCounter}`;

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', clientIp)
        .send({
          displayName,
          email,
          password: 'StrongPass#2026',
        })
        .expect(201);

      const otp = mailService.getLatestTestOutboxMessage(
        email,
        'OTP_VERIFICATION',
      )!.testOnlySecret!;

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/verification/confirm')
        .set('X-Forwarded-For', clientIp)
        .send({
          email,
          code: otp,
          password: 'StrongPass#2026',
          deviceName: `${displayName} Phone`,
        })
        .expect(200);

      return payload(res) as {
        accessToken: string;
        refreshToken: string;
        user: { id: string };
        session: { id: string };
      };
    }

    it('rejects unauthorized requests and blocks cross-user reads, updates, deletes, and group access', async () => {
      // Unauthenticated request rejected
      await http().get('/api/v1/transactions').expect(401);

      const alice = await registerAndVerify('alice@artha.app', 'Alice');
      const bob = await registerAndVerify('bob@artha.app', 'Bob');

      // Alice records a personal expense from her default Cash account
      const accountsRes = await http()
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);
      const categoriesRes = await http()
        .get('/api/v1/categories?type=EXPENSE')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);
      const createExpRes = await http()
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({
          clientTransactionId: 'auth-suite-expense-1',
          type: 'EXPENSE',
          amountMinor: '54000',
          occurredAt: new Date().toISOString(),
          sourceAccountId: payload(accountsRes).accounts[0].id,
          categoryId: payload(categoriesRes).categories[0].id,
          paymentMethod: 'UPI',
          payee: 'Swiggy',
        })
        .expect(201);

      const aliceExpenseId = payload(createExpRes).transaction.id as string;

      // Bob cannot read, update, or delete Alice's transaction; it looks absent
      const bobRead = await http()
        .get(`/api/v1/transactions/${aliceExpenseId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(404);
      expect(payload(bobRead).errorCode).toBe('TRANSACTION_NOT_FOUND');

      await http()
        .patch(`/api/v1/transactions/${aliceExpenseId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ amountMinor: '1000' })
        .expect(404);

      await http()
        .delete(`/api/v1/transactions/${aliceExpenseId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(404);

      // Alice creates a collaborative group
      const groupRes = await http()
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: 'Goa Trip' })
        .expect(201);

      const groupId = payload(groupRes).group.id as string;

      // Bob is not a member yet -> rejected with 403 NOT_GROUP_MEMBER
      const bobGroupRead = await http()
        .get(`/api/v1/groups/${groupId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(403);
      expect(payload(bobGroupRead).errorCode).toBe('NOT_GROUP_MEMBER');

      // Alice adds Bob as a MEMBER
      await http()
        .post(`/api/v1/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ userId: bob.user.id })
        .expect(201);

      // Now Bob can view the shared group, but cannot add other members because he is MEMBER not ADMIN/OWNER
      await http()
        .get(`/api/v1/groups/${groupId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(200);

      const bobAddMember = await http()
        .post(`/api/v1/groups/${groupId}/members`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ userId: alice.user.id })
        .expect(403);
      expect(payload(bobAddMember).errorCode).toBe('INSUFFICIENT_GROUP_ROLE');

      // Bob cannot revoke Alice's session
      await http()
        .delete(`/api/v1/auth/sessions/${alice.session.id}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(404);

      // Alice logs out of her session -> subsequent calls with her access token fail
      await http()
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ refreshToken: alice.refreshToken })
        .expect(200);

      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(401);
    });

    it('manages biometric and hashed PIN security preferences and enforces rate limiting on abuse', async () => {
      const user = await registerAndVerify('sec.prefs@artha.app', 'Sec User');

      // Enable PIN and biometrics
      const patchRes = await http()
        .patch('/api/v1/users/me/security')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          biometricEnabled: true,
          pinEnabled: true,
          pin: '2580',
          appLockTimeoutSeconds: 120,
        })
        .expect(200);

      expect(payload(patchRes).biometricEnabled).toBe(true);
      expect(payload(patchRes).pinEnabled).toBe(true);
      expect(payload(patchRes).pinHash).toBeUndefined();

      // Re-authenticate using PIN
      const reauthRes = await http()
        .post('/api/v1/auth/re-authenticate')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ pin: '2580' })
        .expect(200);
      expect(payload(reauthRes).verified).toBe(true);

      // Rate limit check on forgot-password from a single IP (limit is 5 per minute)
      const rateLimitIp = '203.0.113.99';
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/password/forgot')
          .set('X-Forwarded-For', rateLimitIp)
          .send({ email: 'sec.prefs@artha.app' })
          .expect(200);
      }

      const throttled = await request(app.getHttpServer())
        .post('/api/v1/auth/password/forgot')
        .set('X-Forwarded-For', rateLimitIp)
        .send({ email: 'sec.prefs@artha.app' })
        .expect(429);
      expect(payload(throttled).errorCode).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('keeps PIN failure counts and lockout across unrelated preference updates (BE-01)', async () => {
      const user = await registerAndVerify('pin.lockout@artha.app', 'Pin User');
      const auth = `Bearer ${user.accessToken}`;

      await http()
        .patch('/api/v1/users/me/security')
        .set('Authorization', auth)
        .send({ pinEnabled: true, pin: '2580' })
        .expect(200);

      const wrongPin = () =>
        http()
          .post('/api/v1/auth/re-authenticate')
          .set('Authorization', auth)
          .send({ pin: '0000' });

      // 4 of 5 allowed failures...
      for (let i = 0; i < 4; i++) {
        await wrongPin().expect(401);
      }

      // ...an unrelated settings change must NOT grant a fresh attempt budget.
      await http()
        .patch('/api/v1/users/me/security')
        .set('Authorization', auth)
        .send({ appLockTimeoutSeconds: 300, biometricEnabled: false })
        .expect(200);

      const fifth = await wrongPin().expect(429);
      expect(payload(fifth).errorCode).toBe('PIN_LOCKED_OUT');

      // While locked out, even the correct PIN is refused, and toggling settings
      // again does not lift the lock.
      await http()
        .patch('/api/v1/users/me/security')
        .set('Authorization', auth)
        .send({ appLockTimeoutSeconds: 60 })
        .expect(200);

      const correctWhileLocked = await http()
        .post('/api/v1/auth/re-authenticate')
        .set('Authorization', auth)
        .send({ pin: '2580' })
        .expect(429);
      expect(payload(correctWhileLocked).errorCode).toBe('PIN_LOCKED_OUT');

      const pref = await prisma.userSecurityPreference.findFirst({
        where: { user: { normalizedEmail: 'pin.lockout@artha.app' } },
      });
      expect(pref?.pinFailedAttempts).toBe(5);
      expect(pref?.pinLockedUntil).not.toBeNull();
    });
  });
});
