import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthProvider, UserStatus } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureArthaApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import {
  OAuthVerifierService,
  VerifiedOAuthIdentity,
} from '../src/auth/oauth-verifier.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Artha Authentication & Authorization E2E Suite', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailService: MailService;
  let oauthVerifier: OAuthVerifierService;
  let testSeq = 1;
  let currentTestIp = '10.0.0.1';

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
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_PROVIDER = 'local-outbox';
    process.env.GOOGLE_OAUTH_CLIENT_IDS = 'test-google-client-id';
    process.env.APPLE_CLIENT_IDS = 'com.artha.app';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureArthaApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    mailService = app.get(MailService);
    oauthVerifier = app.get(OAuthVerifierService);
  });

  beforeEach(async () => {
    testSeq += 1;
    currentTestIp = `10.99.${Math.floor(testSeq / 250)}.${(testSeq % 250) + 1}`;
    mailService.clearTestOutbox();
    await prisma.securityEvent.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.authChallenge.deleteMany();
    await prisma.emailVerificationChallenge.deleteMany();
    await prisma.passwordResetChallenge.deleteMany();
    await prisma.authIdentity.deleteMany();
    await prisma.userSecurityPreference.deleteMany();
    await prisma.expenseRecord.deleteMany();
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

      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
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

      expect(regRes.body.verificationRequired).toBe(true);
      expect(regRes.body.user.emailVerified).toBe(false);
      expect(regRes.body.user.passwordHash).toBeUndefined();

      // Duplicate registration rejected
      const dupRes = await http()
        .post('/api/v1/auth/register')
        .send({
          displayName: 'Vansh Duplicate',
          email,
          password,
        })
        .expect(409);
      expect(dupRes.body.errorCode).toBe('EMAIL_ALREADY_REGISTERED');

      // Login before email verification must be blocked
      const unverifiedLogin = await http()
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(403);
      expect(unverifiedLogin.body.errorCode).toBe('EMAIL_NOT_VERIFIED');

      // Resend immediately hits cooldown
      const resendCooldownRes = await http()
        .post('/api/v1/auth/email/verification/send')
        .send({ email })
        .expect(429);
      expect(resendCooldownRes.body.errorCode).toBe('OTP_RESEND_COOLDOWN');

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
          deviceName: 'iPhone 16 Pro',
          platform: 'ios',
        })
        .expect(200);

      expect(confirmRes.body.accessToken).toBeDefined();
      expect(confirmRes.body.refreshToken).toBeDefined();
      expect(confirmRes.body.user.emailVerified).toBe(true);
      expect(confirmRes.body.user.status).toBe(UserStatus.ACTIVE);

      // Reusing the same OTP must fail
      const reuseOtpRes = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: otp })
        .expect(400);
      expect(reuseOtpRes.body.errorCode).toBe('OTP_ALREADY_USED');
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
          .send({ email, code: wrongOtp })
          .expect(400);
        expect(failRes.body.errorCode).toBe('INVALID_OTP');
        expect(failRes.body.details.remainingAttempts).toBe(5 - attempt);
      }

      const lockRes = await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: wrongOtp })
        .expect(429);
      expect(lockRes.body.errorCode).toBe('OTP_MAX_ATTEMPTS_EXCEEDED');

      // Even presenting the real OTP after lockout must fail until a new OTP is issued
      await http()
        .post('/api/v1/auth/email/verification/confirm')
        .send({ email, code: realOtp })
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
        .send({ email, code: realOtp })
        .expect(400);
      expect(expiredRes.body.errorCode).toBe('OTP_EXPIRED');
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
        .send({ email, code: otp })
        .expect(200);

      return sessionRes.body as {
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
      expect(badPass.body.errorCode).toBe('INVALID_CREDENTIALS');

      // Correct password succeeds
      const goodLogin = await http()
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      expect(goodLogin.body.accessToken).toBeDefined();

      // Suspend user and verify login is rejected with 403
      await prisma.user.update({
        where: { normalizedEmail: email },
        data: { status: UserStatus.SUSPENDED },
      });

      const suspendedRes = await http()
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(403);
      expect(suspendedRes.body.errorCode).toBe('ACCOUNT_SUSPENDED_OR_DISABLED');
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

      expect(unknownForgot.body.message).toBe(knownForgot.body.message);

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
      expect(reuseReset.body.errorCode).toBe('RESET_TOKEN_ALREADY_USED');

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
        .send({ email, code: otp })
        .expect(200);

      const token1 = initial.body.refreshToken as string;

      // Rotate token1 -> token2
      const rotated = await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token1 })
        .expect(200);

      const token2 = rotated.body.refreshToken as string;
      const access2 = rotated.body.accessToken as string;
      expect(token2).not.toBe(token1);

      // Verify raw refresh token is NEVER stored in database (only hash)
      const storedTokens = await prisma.refreshToken.findMany();
      for (const st of storedTokens) {
        expect(st.tokenHash).not.toBe(token1);
        expect(st.tokenHash).not.toBe(token2);
      }

      // Replay already-consumed token1 -> must trigger REFRESH_TOKEN_REUSED and revoke session & token2!
      const replayRes = await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token1 })
        .expect(401);

      expect(replayRes.body.errorCode).toBe('REFRESH_TOKEN_REUSED');

      // Now token2 and access2 must also be rejected because the family & session were revoked
      await http()
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: token2 })
        .expect(401);

      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${access2}`)
        .expect(401);
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
        .send({ email, code: otp })
        .expect(200);

      const refreshToken = initial.body.refreshToken as string;

      const [resA, resB] = await Promise.all([
        http().post('/api/v1/auth/token/refresh').send({ refreshToken }),
        http().post('/api/v1/auth/token/refresh').send({ refreshToken }),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      // Exactly one succeeds (200) and the concurrent duplicate is rejected (401)
      expect(statuses).toEqual([200, 401]);
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
        .send({ email, code: otp })
        .expect(200);

      const accessToken = sessionRes.body.accessToken as string;

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

      expect(collisionRes.body.errorCode).toBe('ACCOUNT_LINKING_REQUIRED');

      // 3. Authenticated linking succeeds
      const linkRes = await http()
        .post('/api/v1/auth/oauth/link/google')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ idToken: 'header.payload.sig' })
        .expect(200);

      expect(linkRes.body.user.linkedProviders).toContain(AuthProvider.GOOGLE);

      // 4. Subsequent Google login now succeeds for the linked identity
      const googleLoginRes = await http()
        .post('/api/v1/auth/oauth/google')
        .send({ idToken: 'header.payload.sig' })
        .expect(200);
      expect(googleLoginRes.body.user.id).toBe(sessionRes.body.user.id);

      // 5. Unlinking Google succeeds because password auth still exists
      const unlinkRes = await http()
        .delete('/api/v1/auth/oauth/google')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(unlinkRes.body.user.linkedProviders).not.toContain(
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
      expect(unverifiedRes.body.errorCode).toBe('OAUTH_EMAIL_UNVERIFIED');

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

      const createdUserId = firstLoginRes.body.user.id as string;
      expect(createdUserId).toBeTruthy();
      expect(firstLoginRes.body.user.email).toBe('new.google.user@artha.app');
      expect(firstLoginRes.body.user.displayName).toBe('New Google User');
      expect(firstLoginRes.body.user.avatarUrl).toBe(
        'https://lh3.googleusercontent.com/a/new-google-avatar',
      );
      expect(firstLoginRes.body.user.emailVerified).toBe(true);
      expect(firstLoginRes.body.user.hasPassword).toBe(false);
      expect(firstLoginRes.body.user.linkedProviders).toEqual([
        AuthProvider.GOOGLE,
      ]);
      expect(firstLoginRes.body.accessToken).toBeTruthy();
      expect(firstLoginRes.body.refreshToken).toBeTruthy();

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

      expect(secondLoginRes.body.user.id).toBe(createdUserId);

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
        .send({ email, code: otp, deviceName: `${displayName} Phone` })
        .expect(200);

      return res.body as {
        accessToken: string;
        refreshToken: string;
        user: { id: string };
        session: { id: string };
      };
    }

    it('rejects unauthorized requests and blocks cross-user reads, updates, deletes, and group access', async () => {
      // Unauthenticated request rejected
      await http().get('/api/v1/expenses').expect(401);

      const alice = await registerAndVerify('alice@artha.app', 'Alice');
      const bob = await registerAndVerify('bob@artha.app', 'Bob');

      // Alice creates a personal expense
      const createExpRes = await http()
        .post('/api/v1/expenses')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({
          merchant: 'Swiggy',
          category: 'Food',
          amount: 540,
          paymentMethod: 'UPI',
        })
        .expect(201);

      const aliceExpenseId = createExpRes.body.expense.id as string;

      // Bob cannot read, update, or delete Alice's personal expense
      const bobRead = await http()
        .get(`/api/v1/expenses/${aliceExpenseId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(403);
      expect(bobRead.body.errorCode).toBe('CROSS_USER_ACCESS_DENIED');

      await http()
        .patch(`/api/v1/expenses/${aliceExpenseId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ amount: 10 })
        .expect(403);

      await http()
        .delete(`/api/v1/expenses/${aliceExpenseId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(403);

      // Alice creates a collaborative group
      const groupRes = await http()
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: 'Goa Trip' })
        .expect(201);

      const groupId = groupRes.body.group.id as string;

      // Bob is not a member yet -> rejected with 403 NOT_GROUP_MEMBER
      const bobGroupRead = await http()
        .get(`/api/v1/groups/${groupId}`)
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .expect(403);
      expect(bobGroupRead.body.errorCode).toBe('NOT_GROUP_MEMBER');

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
      expect(bobAddMember.body.errorCode).toBe('INSUFFICIENT_GROUP_ROLE');

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

      expect(patchRes.body.biometricEnabled).toBe(true);
      expect(patchRes.body.pinEnabled).toBe(true);
      expect(patchRes.body.pinHash).toBeUndefined();

      // Re-authenticate using PIN
      const reauthRes = await http()
        .post('/api/v1/auth/re-authenticate')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ pin: '2580' })
        .expect(200);
      expect(reauthRes.body.verified).toBe(true);

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
      expect(throttled.body.errorCode).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});
