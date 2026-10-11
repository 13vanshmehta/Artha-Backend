import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider, GroupRole, User, UserStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SecurityLoggerService } from '../common/logging/security-logger.service';
import { ValidatedEnvConfig } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from './crypto.service';
import {
  AppleOAuthDto,
  ChangePasswordDto,
  ConfirmEmailVerificationDto,
  DeleteAccountDto,
  ForgotPasswordDto,
  GoogleOAuthDto,
  LoginDto,
  ReauthenticateDto,
  RegisterDto,
  ResetPasswordDto,
  SendEmailVerificationDto,
  UpdateProfileDto,
  UpdateSecurityPreferencesDto,
} from './dto/auth.dto';
import { MailService } from './mail.service';
import {
  OAuthVerifierService,
  VerifiedOAuthIdentity,
} from './oauth-verifier.service';

export interface RequestMetadata {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SanitizedUser {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  status: UserStatus;
  hasPassword: boolean;
  linkedProviders: AuthProvider[];
  securityPreferences: {
    biometricEnabled: boolean;
    pinEnabled: boolean;
    appLockTimeoutSeconds: number;
    requireReauthForSensitiveAction: boolean;
  };
  createdAt: string;
}

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  session: {
    id: string;
    deviceName: string;
    platform: string;
    expiresAt: string;
  };
  user: SanitizedUser;
}

const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXJhbmRvbXNhbHQxMjM0$K7G8W5vY2xN9pQ1rT4uV6wX8yZ0aB2cD4eF6gH8iJ0k';
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<ValidatedEnvConfig, true>,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,
    private readonly mailService: MailService,
    private readonly oauthVerifier: OAuthVerifierService,
    private readonly securityLogger: SecurityLoggerService,
  ) {}

  private enforcePasswordPolicy(password: string): void {
    const minLength = this.configService.get('PASSWORD_MIN_LENGTH', {
      infer: true,
    });
    if (!password || password.length < minLength) {
      throw new BadRequestException({
        errorCode: 'WEAK_PASSWORD',
        message: `Password must be at least ${minLength} characters long.`,
      });
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSymbol = /[^A-Za-z\d]/.test(password);

    if (!hasUpper || !hasLower || !hasDigit || !hasSymbol) {
      throw new BadRequestException({
        errorCode: 'WEAK_PASSWORD',
        message:
          'Password must include uppercase, lowercase, number, and special character.',
      });
    }
  }

  async register(
    dto: RegisterDto,
    reqMeta: RequestMetadata,
  ): Promise<{
    message: string;
    verificationRequired: true;
    email: string;
    otpExpiresInSeconds: number;
    resendCooldownSeconds: number;
    user: SanitizedUser;
  }> {
    const normalizedEmail = this.cryptoService.normalizeEmail(dto.email);
    const cleanEmail = dto.email.trim();
    const displayName = dto.displayName.trim();

    this.enforcePasswordPolicy(dto.password);

    const existing = await this.prisma.user.findUnique({
      where: { normalizedEmail },
    });

    if (existing) {
      await this.securityLogger.record({
        eventType: 'REGISTER_DUPLICATE_EMAIL',
        userId: existing.id,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: { normalizedEmail },
      });

      throw new ConflictException({
        errorCode: 'EMAIL_ALREADY_REGISTERED',
        message: 'An account with this email address already exists.',
        details: {
          requiresEmailVerification: existing.emailVerifiedAt === null,
        },
      });
    }

    const passwordHash = await this.cryptoService.hashPassword(dto.password);
    const otp = this.cryptoService.generateSixDigitOtp();
    const otpHash = await this.cryptoService.hashSecret(otp);

    const otpExpiryMinutes = this.configService.get('OTP_EXPIRY_MINUTES', {
      infer: true,
    });
    const maxAttempts = this.configService.get('OTP_MAX_ATTEMPTS', {
      infer: true,
    });
    const resendCooldownSeconds = this.configService.get(
      'OTP_RESEND_COOLDOWN_SECONDS',
      { infer: true },
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + otpExpiryMinutes * 60 * 1000);
    const resendAvailableAt = new Date(
      now.getTime() + resendCooldownSeconds * 1000,
    );

    const createdUser = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          displayName,
          email: cleanEmail,
          normalizedEmail,
          passwordHash,
          status: UserStatus.UNVERIFIED,
          securityPreference: {
            create: {
              biometricEnabled: false,
              pinEnabled: false,
              appLockTimeoutSeconds: 60,
              requireReauthForSensitiveAction: true,
            },
          },
        },
        include: {
          identities: true,
          securityPreference: true,
        },
      });

      await tx.emailVerificationChallenge.create({
        data: {
          userId: user.id,
          email: cleanEmail,
          otpHash,
          expiresAt,
          maxAttempts,
          resendAvailableAt,
        },
      });

      return user;
    });

    await this.mailService.sendVerificationOtpEmail({
      to: cleanEmail,
      displayName,
      otp,
      expiresInMinutes: otpExpiryMinutes,
    });

    await this.securityLogger.record({
      eventType: 'REGISTER_SUCCESS',
      userId: createdUser.id,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { email: cleanEmail },
    });

    return {
      message:
        'Registration successful. Please enter the 6-digit verification code sent to your email.',
      verificationRequired: true,
      email: cleanEmail,
      otpExpiresInSeconds: otpExpiryMinutes * 60,
      resendCooldownSeconds,
      user: this.sanitizeUser(createdUser),
    };
  }

  async sendEmailVerification(
    dto: SendEmailVerificationDto,
    reqMeta: RequestMetadata,
  ): Promise<{
    message: string;
    otpExpiresInSeconds: number;
    resendCooldownSeconds: number;
  }> {
    const normalizedEmail = this.cryptoService.normalizeEmail(dto.email);
    const otpExpiryMinutes = this.configService.get('OTP_EXPIRY_MINUTES', {
      infer: true,
    });
    const maxAttempts = this.configService.get('OTP_MAX_ATTEMPTS', {
      infer: true,
    });
    const resendCooldownSeconds = this.configService.get(
      'OTP_RESEND_COOLDOWN_SECONDS',
      { infer: true },
    );

    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail },
    });

    // Prevent account enumeration for unknown or already-verified emails
    if (!user || user.emailVerifiedAt !== null || user.deletedAt !== null) {
      return {
        message:
          'If an unverified account exists for this email, a verification code has been sent.',
        otpExpiresInSeconds: otpExpiryMinutes * 60,
        resendCooldownSeconds,
      };
    }

    const now = new Date();
    const latestChallenge =
      await this.prisma.emailVerificationChallenge.findFirst({
        where: {
          userId: user.id,
          consumedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });

    if (latestChallenge && latestChallenge.resendAvailableAt > now) {
      const retryAfterSeconds = Math.ceil(
        (latestChallenge.resendAvailableAt.getTime() - now.getTime()) / 1000,
      );
      throw new HttpException(
        {
          errorCode: 'OTP_RESEND_COOLDOWN',
          message: `Please wait ${retryAfterSeconds} seconds before requesting another verification code.`,
          details: { retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = this.cryptoService.generateSixDigitOtp();
    const otpHash = await this.cryptoService.hashSecret(otp);
    const expiresAt = new Date(now.getTime() + otpExpiryMinutes * 60 * 1000);
    const resendAvailableAt = new Date(
      now.getTime() + resendCooldownSeconds * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationChallenge.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });

      await tx.emailVerificationChallenge.create({
        data: {
          userId: user.id,
          email: user.email,
          otpHash,
          expiresAt,
          maxAttempts,
          resendAvailableAt,
        },
      });
    });

    await this.mailService.sendVerificationOtpEmail({
      to: user.email,
      displayName: user.displayName,
      otp,
      expiresInMinutes: otpExpiryMinutes,
    });

    await this.securityLogger.record({
      eventType: 'EMAIL_OTP_SENT',
      userId: user.id,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
    });

    return {
      message:
        'If an unverified account exists for this email, a verification code has been sent.',
      otpExpiresInSeconds: otpExpiryMinutes * 60,
      resendCooldownSeconds,
    };
  }

  async confirmEmailVerification(
    dto: ConfirmEmailVerificationDto,
    reqMeta: RequestMetadata,
  ): Promise<AuthSessionResponse> {
    const normalizedEmail = this.cryptoService.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail },
      include: {
        identities: true,
        securityPreference: true,
      },
    });

    if (!user || user.deletedAt !== null) {
      throw new BadRequestException({
        errorCode: 'INVALID_OTP',
        message: 'Invalid or expired verification code.',
      });
    }

    const latestChallenge =
      await this.prisma.emailVerificationChallenge.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      });

    if (!latestChallenge) {
      throw new BadRequestException({
        errorCode: 'INVALID_OTP',
        message: 'Invalid or expired verification code.',
      });
    }

    if (latestChallenge.consumedAt !== null) {
      throw new BadRequestException({
        errorCode: 'OTP_ALREADY_USED',
        message:
          'This verification code has already been used. Please request a new code if needed.',
      });
    }

    const now = new Date();
    if (latestChallenge.expiresAt <= now) {
      throw new BadRequestException({
        errorCode: 'OTP_EXPIRED',
        message:
          'Verification code has expired. Please request a new 6-digit code.',
      });
    }

    if (latestChallenge.failedAttempts >= latestChallenge.maxAttempts) {
      throw new HttpException(
        {
          errorCode: 'OTP_MAX_ATTEMPTS_EXCEEDED',
          message:
            'Maximum verification attempts exceeded. Please request a new code.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const isOtpValid = await this.cryptoService.verifySecret(
      latestChallenge.otpHash,
      dto.code,
    );

    if (!isOtpValid) {
      const updated = await this.prisma.emailVerificationChallenge.update({
        where: { id: latestChallenge.id },
        data: { failedAttempts: { increment: 1 } },
      });

      await this.securityLogger.record({
        eventType: 'EMAIL_OTP_FAILED',
        userId: user.id,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: {
          failedAttempts: updated.failedAttempts,
          maxAttempts: updated.maxAttempts,
        },
      });

      if (updated.failedAttempts >= updated.maxAttempts) {
        throw new HttpException(
          {
            errorCode: 'OTP_MAX_ATTEMPTS_EXCEEDED',
            message:
              'Maximum verification attempts exceeded. Please request a new code.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw new BadRequestException({
        errorCode: 'INVALID_OTP',
        message: 'Invalid verification code.',
        details: {
          remainingAttempts: Math.max(
            0,
            updated.maxAttempts - updated.failedAttempts,
          ),
        },
      });
    }

    const verifiedUser = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailVerificationChallenge.updateMany({
        where: {
          id: latestChallenge.id,
          consumedAt: null,
        },
        data: {
          consumedAt: now,
        },
      });

      if (consumed.count !== 1) {
        throw new BadRequestException({
          errorCode: 'OTP_ALREADY_USED',
          message: 'This verification code has already been used.',
        });
      }

      return tx.user.update({
        where: { id: user.id },
        data: {
          emailVerifiedAt: user.emailVerifiedAt ?? now,
          status:
            user.status === UserStatus.UNVERIFIED
              ? UserStatus.ACTIVE
              : user.status,
        },
        include: {
          identities: true,
          securityPreference: true,
        },
      });
    });

    if (verifiedUser.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        errorCode: 'ACCOUNT_SUSPENDED_OR_DISABLED',
        message: 'Account is not eligible to sign in.',
      });
    }

    await this.securityLogger.record({
      eventType: 'EMAIL_VERIFIED',
      userId: verifiedUser.id,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
    });

    // Send transactional verification confirmed & welcome emails on first verification
    if (user.status === UserStatus.UNVERIFIED) {
      this.mailService
        .sendEmailVerificationConfirmedEmail({
          to: verifiedUser.email,
          email: verifiedUser.email,
          displayName: verifiedUser.displayName,
        })
        .catch((err: Error) =>
          this.logger.warn(
            `Failed to deliver email verification confirmation: ${err.message}`,
          ),
        );

      this.mailService
        .sendWelcomeEmail({
          to: verifiedUser.email,
          email: verifiedUser.email,
          displayName: verifiedUser.displayName,
        })
        .catch((err: Error) =>
          this.logger.warn(`Failed to deliver welcome email: ${err.message}`),
        );
    }

    return this.createAuthenticatedSession({
      user: verifiedUser,
      deviceName: dto.deviceName ?? 'Artha Mobile Client',
      platform: dto.platform ?? 'mobile',
      reqMeta,
      loginEventType: 'LOGIN_AFTER_EMAIL_VERIFICATION',
    });
  }

  async login(
    dto: LoginDto,
    reqMeta: RequestMetadata,
  ): Promise<AuthSessionResponse> {
    const normalizedEmail = this.cryptoService.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail },
      include: {
        identities: true,
        securityPreference: true,
      },
    });

    if (!user || !user.passwordHash || user.deletedAt !== null) {
      await this.cryptoService.verifyPassword(DUMMY_ARGON2_HASH, dto.password);
      await this.securityLogger.record({
        eventType: 'LOGIN_FAILURE',
        userId: user?.id ?? null,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: { reason: 'USER_NOT_FOUND_OR_NO_PASSWORD' },
      });
      throw new UnauthorizedException({
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    const passwordValid = await this.cryptoService.verifyPassword(
      user.passwordHash,
      dto.password,
    );

    if (!passwordValid) {
      await this.securityLogger.record({
        eventType: 'LOGIN_FAILURE',
        userId: user.id,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: { reason: 'INVALID_PASSWORD' },
      });
      throw new UnauthorizedException({
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    if (
      user.status === UserStatus.SUSPENDED ||
      user.status === UserStatus.DISABLED
    ) {
      await this.securityLogger.record({
        eventType: 'LOGIN_FAILURE',
        userId: user.id,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: { reason: `ACCOUNT_${user.status}` },
      });
      throw new ForbiddenException({
        errorCode: 'ACCOUNT_SUSPENDED_OR_DISABLED',
        message: 'Your account has been suspended or disabled.',
      });
    }

    if (
      user.emailVerifiedAt === null ||
      user.status === UserStatus.UNVERIFIED
    ) {
      await this.securityLogger.record({
        eventType: 'LOGIN_FAILURE',
        userId: user.id,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: { reason: 'EMAIL_NOT_VERIFIED' },
      });
      throw new ForbiddenException({
        errorCode: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email address before signing in.',
        details: {
          email: user.email,
          verificationRequired: true,
        },
      });
    }

    return this.createAuthenticatedSession({
      user,
      deviceName: dto.deviceName ?? 'Artha Mobile Client',
      platform: dto.platform ?? 'mobile',
      reqMeta,
      loginEventType: 'LOGIN_SUCCESS',
    });
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    reqMeta: RequestMetadata,
  ): Promise<{ message: string }> {
    const normalizedEmail = this.cryptoService.normalizeEmail(dto.email);
    const genericMessage =
      'If an account with that email exists, password reset instructions have been sent.';

    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail },
    });

    if (
      !user ||
      user.deletedAt !== null ||
      user.status === UserStatus.DISABLED ||
      user.status === UserStatus.SUSPENDED
    ) {
      await this.securityLogger.record({
        eventType: 'PASSWORD_RESET_REQUESTED_UNKNOWN_OR_INACTIVE',
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
      });
      return { message: genericMessage };
    }

    const resetToken = this.cryptoService.generateOpaqueToken(32);
    const tokenHash = this.cryptoService.hashOpaqueToken(resetToken);
    const ttlMinutes = this.configService.get('PASSWORD_RESET_TTL_MINUTES', {
      infer: true,
    });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetChallenge.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });

      await tx.passwordResetChallenge.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });
    });

    await this.mailService.sendPasswordResetEmail({
      to: user.email,
      displayName: user.displayName,
      resetToken,
      expiresInMinutes: ttlMinutes,
    });

    await this.securityLogger.record({
      eventType: 'PASSWORD_RESET_REQUESTED',
      userId: user.id,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
    });

    return { message: genericMessage };
  }

  async resetPassword(
    dto: ResetPasswordDto,
    reqMeta: RequestMetadata,
  ): Promise<{ message: string }> {
    this.enforcePasswordPolicy(dto.newPassword);

    const normalizedEmail = this.cryptoService.normalizeEmail(dto.email);
    const tokenHash = this.cryptoService.hashOpaqueToken(dto.resetToken.trim());

    const challenge = await this.prisma.passwordResetChallenge.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!challenge || challenge.user.normalizedEmail !== normalizedEmail) {
      throw new BadRequestException({
        errorCode: 'INVALID_RESET_TOKEN',
        message: 'Invalid or expired password reset token.',
      });
    }

    if (challenge.consumedAt !== null) {
      throw new BadRequestException({
        errorCode: 'RESET_TOKEN_ALREADY_USED',
        message: 'This password reset token has already been used.',
      });
    }

    const now = new Date();
    if (challenge.expiresAt <= now) {
      throw new BadRequestException({
        errorCode: 'RESET_TOKEN_EXPIRED',
        message: 'Password reset token has expired.',
      });
    }

    const newPasswordHash = await this.cryptoService.hashPassword(
      dto.newPassword,
    );

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: now },
      });

      if (consumed.count !== 1) {
        throw new BadRequestException({
          errorCode: 'RESET_TOKEN_ALREADY_USED',
          message: 'This password reset token has already been used.',
        });
      }

      await tx.user.update({
        where: { id: challenge.userId },
        data: {
          passwordHash: newPasswordHash,
        },
      });

      await tx.authSession.updateMany({
        where: { userId: challenge.userId, revokedAt: null },
        data: {
          revokedAt: now,
          revokeReason: 'PASSWORD_RESET',
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          session: { userId: challenge.userId },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    });

    await this.mailService.sendPasswordResetCompletedEmail({
      to: challenge.user.email,
      displayName: challenge.user.displayName,
    });

    await this.securityLogger.record({
      eventType: 'PASSWORD_RESET_COMPLETED',
      userId: challenge.userId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
    });

    return {
      message:
        'Your password has been reset and all active sessions have been signed out. You may now sign in with your new password.',
    };
  }

  async changePassword(
    userId: string,
    sessionId: string,
    dto: ChangePasswordDto,
    reqMeta: RequestMetadata,
  ): Promise<{ message: string }> {
    this.enforcePasswordPolicy(dto.newPassword);

    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session || session.userId !== userId) {
      throw new UnauthorizedException({
        errorCode: 'SESSION_REVOKED',
        message: 'Invalid session.',
      });
    }

    const user = session.user;
    const reauthWindowSeconds = this.configService.get('REAUTH_WINDOW_SECONDS', {
      infer: true,
    });
    const now = new Date();
    const isRecentlyReauthenticated =
      session.lastReauthenticatedAt !== null &&
      now.getTime() - session.lastReauthenticatedAt.getTime() <=
        reauthWindowSeconds * 1000;

    if (user.passwordHash) {
      if (dto.currentPassword) {
        const validCurrent = await this.cryptoService.verifyPassword(
          user.passwordHash,
          dto.currentPassword,
        );
        if (!validCurrent) {
          await this.securityLogger.record({
            eventType: 'PASSWORD_CHANGE_FAILED',
            userId,
            sessionId,
            ipAddress: reqMeta.ipAddress,
            userAgent: reqMeta.userAgent,
          });
          throw new UnauthorizedException({
            errorCode: 'INVALID_CURRENT_PASSWORD',
            message: 'Current password is incorrect.',
          });
        }
      } else if (!isRecentlyReauthenticated) {
        throw new UnauthorizedException({
          errorCode: 'REAUTHENTICATION_REQUIRED',
          message:
            'Please provide your current password or re-authenticate to change your password.',
        });
      }

      const isSamePassword = await this.cryptoService.verifyPassword(
        user.passwordHash,
        dto.newPassword,
      );
      if (isSamePassword) {
        throw new BadRequestException({
          errorCode: 'PASSWORD_UNCHANGED',
          message: 'New password must be different from your current password.',
        });
      }
    } else if (!isRecentlyReauthenticated) {
      throw new UnauthorizedException({
        errorCode: 'REAUTHENTICATION_REQUIRED',
        message: 'Recent re-authentication is required to set a password.',
      });
    }

    const newPasswordHash = await this.cryptoService.hashPassword(
      dto.newPassword,
    );

    const revokeOthers = dto.revokeOtherSessions !== false;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      });

      await tx.authSession.update({
        where: { id: sessionId },
        data: { lastReauthenticatedAt: now },
      });

      if (revokeOthers) {
        await tx.authSession.updateMany({
          where: {
            userId,
            id: { not: sessionId },
            revokedAt: null,
          },
          data: {
            revokedAt: now,
            revokeReason: 'PASSWORD_CHANGED',
          },
        });

        await tx.refreshToken.updateMany({
          where: {
            session: {
              userId,
              id: { not: sessionId },
            },
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }
    });

    await this.securityLogger.record({
      eventType: 'PASSWORD_CHANGED',
      userId,
      sessionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { revokedOtherSessions: revokeOthers },
    });

    this.mailService
      .sendPasswordResetCompletedEmail({
        to: user.email,
        displayName: user.displayName,
        changedAt: now,
      })
      .catch((err: Error) =>
        this.logger.warn(
          `Failed to deliver password changed confirmation email: ${err.message}`,
        ),
      );

    return {
      message: 'Password updated successfully.',
    };
  }

  async loginWithGoogle(
    dto: GoogleOAuthDto,
    reqMeta: RequestMetadata,
  ): Promise<AuthSessionResponse> {
    const verified = await this.oauthVerifier.verifyGoogleIdToken(dto.idToken);
    return this.handleOAuthSignIn({
      verified,
      deviceName: dto.deviceName ?? 'Artha Mobile Client',
      platform: dto.platform ?? 'mobile',
      reqMeta,
    });
  }

  async loginWithApple(
    dto: AppleOAuthDto,
    reqMeta: RequestMetadata,
  ): Promise<AuthSessionResponse> {
    const verified = await this.oauthVerifier.verifyAppleIdentityToken({
      identityToken: dto.identityToken,
      fullName: dto.fullName,
    });
    return this.handleOAuthSignIn({
      verified,
      deviceName: dto.deviceName ?? 'Artha iOS Client',
      platform: dto.platform ?? 'ios',
      reqMeta,
    });
  }

  private async handleOAuthSignIn(params: {
    verified: VerifiedOAuthIdentity;
    deviceName: string;
    platform: string;
    reqMeta: RequestMetadata;
  }): Promise<AuthSessionResponse> {
    const { verified, deviceName, platform, reqMeta } = params;
    const now = new Date();

    const existingIdentity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: verified.provider,
          providerSubject: verified.providerSubject,
        },
      },
      include: {
        user: {
          include: {
            identities: true,
            securityPreference: true,
          },
        },
      },
    });

    if (existingIdentity) {
      const user = existingIdentity.user;
      if (
        !user.isActive ||
        user.deletedAt !== null ||
        user.status === UserStatus.SUSPENDED ||
        user.status === UserStatus.DISABLED
      ) {
        throw new ForbiddenException({
          errorCode: 'ACCOUNT_SUSPENDED_OR_DISABLED',
          message: 'Your account has been suspended or disabled.',
        });
      }

      const updatedUser = await this.prisma.$transaction(async (tx) => {
        await tx.authIdentity.update({
          where: { id: existingIdentity.id },
          data: {
            lastUsedAt: now,
            providerEmail: verified.email ?? existingIdentity.providerEmail,
          },
        });

        const shouldActivate =
          user.status === UserStatus.UNVERIFIED &&
          verified.emailVerified &&
          verified.email === user.normalizedEmail;
        const shouldUpdateAvatar = !user.avatarUrl && Boolean(verified.avatarUrl);

        if (shouldActivate || shouldUpdateAvatar) {
          return tx.user.update({
            where: { id: user.id },
            data: {
              ...(shouldActivate
                ? {
                    status: UserStatus.ACTIVE,
                    emailVerifiedAt: user.emailVerifiedAt ?? now,
                  }
                : {}),
              ...(shouldUpdateAvatar ? { avatarUrl: verified.avatarUrl } : {}),
            },
            include: {
              identities: true,
              securityPreference: true,
            },
          });
        }
        return user;
      });

      return this.createAuthenticatedSession({
        user: updatedUser,
        deviceName,
        platform,
        reqMeta,
        loginEventType: `OAUTH_${verified.provider}_LOGIN_SUCCESS`,
      });
    }

    // New OAuth identity — check email requirements and prevent unsafe auto-merge
    if (!verified.email) {
      throw new BadRequestException({
        errorCode: 'OAUTH_EMAIL_REQUIRED',
        message:
          'Unable to retrieve an email address from the identity provider. Please grant email permission or sign in with an already linked account.',
      });
    }

    if (!verified.emailVerified) {
      throw new ForbiddenException({
        errorCode: 'OAUTH_EMAIL_UNVERIFIED',
        message:
          'The email address on your social provider account is not verified.',
      });
    }

    const normalizedEmail = this.cryptoService.normalizeEmail(verified.email);
    const existingUserByEmail = await this.prisma.user.findUnique({
      where: { normalizedEmail },
    });

    if (existingUserByEmail) {
      await this.securityLogger.record({
        eventType: 'OAUTH_UNLINKED_EMAIL_COLLISION',
        userId: existingUserByEmail.id,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: {
          provider: verified.provider,
          normalizedEmail,
        },
      });

      throw new ConflictException({
        errorCode: 'ACCOUNT_LINKING_REQUIRED',
        message:
          'An Artha account with this email already exists. For your security, please sign in with your existing method and link this provider from Account Security.',
      });
    }

    const derivedName =
      verified.displayName?.trim() ||
      verified.email.split('@')[0].replace(/[._-]/g, ' ') ||
      'Artha Member';

    try {
      const newUser = await this.prisma.$transaction(async (tx) => {
        return tx.user.create({
          data: {
            displayName: derivedName,
            email: verified.email!,
            normalizedEmail,
            avatarUrl: verified.avatarUrl ?? null,
            isActive: true,
            emailVerifiedAt: now,
            status: UserStatus.ACTIVE,
            identities: {
              create: {
                provider: verified.provider,
                providerSubject: verified.providerSubject,
                providerEmail: verified.email,
                emailVerifiedByProvider: true,
              },
            },
            securityPreference: {
              create: {
                biometricEnabled: false,
                pinEnabled: false,
                appLockTimeoutSeconds: 60,
                requireReauthForSensitiveAction: true,
              },
            },
          },
          include: {
            identities: true,
            securityPreference: true,
          },
        });
      });

      this.mailService
        .sendWelcomeEmail({
          to: newUser.email,
          email: newUser.email,
          displayName: newUser.displayName,
        })
        .catch((err: Error) =>
          this.logger.warn(
            `Failed to deliver OAuth welcome email: ${err.message}`,
          ),
        );

      return this.createAuthenticatedSession({
        user: newUser,
        deviceName,
        platform,
        reqMeta,
        loginEventType: `OAUTH_${verified.provider}_REGISTER_AND_LOGIN`,
      });
    } catch (err: unknown) {
      const prismaCode = (err as { code?: string })?.code;
      if (prismaCode === 'P2002') {
        // Concurrent duplicate request created the identity or email simultaneously
        const racedIdentity = await this.prisma.authIdentity.findUnique({
          where: {
            provider_providerSubject: {
              provider: verified.provider,
              providerSubject: verified.providerSubject,
            },
          },
          include: {
            user: {
              include: {
                identities: true,
                securityPreference: true,
              },
            },
          },
        });
        if (racedIdentity) {
          return this.createAuthenticatedSession({
            user: racedIdentity.user,
            deviceName,
            platform,
            reqMeta,
            loginEventType: `OAUTH_${verified.provider}_LOGIN_SUCCESS`,
          });
        }
        throw new ConflictException({
          errorCode: 'ACCOUNT_LINKING_REQUIRED',
          message:
            'An Artha account with this email already exists. For your security, please sign in with your existing method and link this provider from Account Security.',
        });
      }
      throw err;
    }
  }

  async linkGoogleIdentity(
    userId: string,
    dto: GoogleOAuthDto,
    reqMeta: RequestMetadata,
  ): Promise<SanitizedUser> {
    const verified = await this.oauthVerifier.verifyGoogleIdToken(dto.idToken);
    return this.linkVerifiedIdentity(userId, verified, reqMeta);
  }

  async linkAppleIdentity(
    userId: string,
    dto: AppleOAuthDto,
    reqMeta: RequestMetadata,
  ): Promise<SanitizedUser> {
    const verified = await this.oauthVerifier.verifyAppleIdentityToken({
      identityToken: dto.identityToken,
      fullName: dto.fullName,
    });
    return this.linkVerifiedIdentity(userId, verified, reqMeta);
  }

  private async linkVerifiedIdentity(
    userId: string,
    verified: VerifiedOAuthIdentity,
    reqMeta: RequestMetadata,
  ): Promise<SanitizedUser> {
    const existingBySubject = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: verified.provider,
          providerSubject: verified.providerSubject,
        },
      },
    });

    if (existingBySubject && existingBySubject.userId !== userId) {
      await this.securityLogger.record({
        eventType: 'OAUTH_LINK_COLLISION',
        userId,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: { provider: verified.provider },
      });
      throw new ConflictException({
        errorCode: 'OAUTH_IDENTITY_ALREADY_LINKED',
        message:
          'This social account is already linked to another Artha account.',
      });
    }

    if (existingBySubject && existingBySubject.userId === userId) {
      return this.getMe(userId);
    }

    const existingSameProviderForUser =
      await this.prisma.authIdentity.findFirst({
        where: {
          userId,
          provider: verified.provider,
        },
      });

    if (existingSameProviderForUser) {
      throw new ConflictException({
        errorCode: 'PROVIDER_ALREADY_LINKED',
        message: `A ${verified.provider} account is already linked to your profile.`,
      });
    }

    await this.prisma.authIdentity.create({
      data: {
        userId,
        provider: verified.provider,
        providerSubject: verified.providerSubject,
        providerEmail: verified.email,
        emailVerifiedByProvider: verified.emailVerified,
      },
    });

    await this.securityLogger.record({
      eventType: 'OAUTH_LINKED',
      userId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: {
        provider: verified.provider,
        providerEmail: verified.email,
      },
    });

    return this.getMe(userId);
  }

  async unlinkOAuthIdentity(
    userId: string,
    providerParam: string,
    reqMeta: RequestMetadata,
  ): Promise<SanitizedUser> {
    const normalizedProvider = providerParam.trim().toUpperCase();
    if (
      normalizedProvider !== AuthProvider.GOOGLE &&
      normalizedProvider !== AuthProvider.APPLE
    ) {
      throw new BadRequestException({
        errorCode: 'UNSUPPORTED_OAUTH_PROVIDER',
        message: 'Provider must be either google or apple.',
      });
    }

    const provider = normalizedProvider as AuthProvider;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { identities: true },
    });

    if (!user) {
      throw new NotFoundException({
        errorCode: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    const targetIdentity = user.identities.find(
      (i) => i.provider === provider,
    );
    if (!targetIdentity) {
      throw new NotFoundException({
        errorCode: 'OAUTH_IDENTITY_NOT_LINKED',
        message: `No ${provider} account is linked to your profile.`,
      });
    }

    const remainingIdentities = user.identities.filter(
      (i) => i.provider !== provider,
    );
    const hasPassword = Boolean(user.passwordHash);

    if (!hasPassword && remainingIdentities.length === 0) {
      throw new BadRequestException({
        errorCode: 'CANNOT_UNLINK_LAST_AUTH_METHOD',
        message:
          'You cannot unlink your only sign-in method. Set an account password or link another provider first.',
      });
    }

    await this.prisma.authIdentity.delete({
      where: { id: targetIdentity.id },
    });

    await this.securityLogger.record({
      eventType: 'OAUTH_UNLINKED',
      userId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { provider },
    });

    return this.getMe(userId);
  }

  async refreshTokens(
    rawRefreshToken: string,
    reqMeta: RequestMetadata,
  ): Promise<AuthSessionResponse> {
    const tokenHash = this.cryptoService.hashOpaqueToken(
      rawRefreshToken.trim(),
    );
    const now = new Date();

    const existingToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        session: {
          include: {
            user: {
              include: {
                identities: true,
                securityPreference: true,
              },
            },
          },
        },
      },
    });

    if (!existingToken) {
      await this.securityLogger.record({
        eventType: 'REFRESH_TOKEN_INVALID',
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
      });
      throw new UnauthorizedException({
        errorCode: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired session token.',
      });
    }

    // Replay / reuse detection: if a consumed token is presented again, revoke the entire token family & session!
    if (existingToken.consumedAt !== null) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({
          where: { familyId: existingToken.familyId, revokedAt: null },
          data: { revokedAt: now },
        }),
        this.prisma.authSession.update({
          where: { id: existingToken.sessionId },
          data: {
            revokedAt: now,
            revokeReason: 'REFRESH_TOKEN_REUSE_DETECTED',
          },
        }),
      ]);

      await this.securityLogger.record({
        eventType: 'REFRESH_TOKEN_REUSE_DETECTED',
        userId: existingToken.session.userId,
        sessionId: existingToken.sessionId,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: {
          familyId: existingToken.familyId,
          tokenId: existingToken.id,
        },
      });

      throw new UnauthorizedException({
        errorCode: 'REFRESH_TOKEN_REUSED',
        message:
          'Session security alert: token reuse detected. This session has been revoked.',
      });
    }

    const session = existingToken.session;
    const user = session.user;

    if (
      existingToken.revokedAt !== null ||
      existingToken.expiresAt <= now ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      user.deletedAt !== null ||
      user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException({
        errorCode: 'SESSION_EXPIRED_OR_REVOKED',
        message: 'Invalid or expired session token.',
      });
    }

    const refreshTtlDays = this.configService.get('REFRESH_TOKEN_TTL_DAYS', {
      infer: true,
    });
    const candidateExpiry = new Date(
      now.getTime() + refreshTtlDays * 24 * 60 * 60 * 1000,
    );
    const nextRefreshExpiresAt =
      candidateExpiry < session.expiresAt ? candidateExpiry : session.expiresAt;

    const newRawRefreshToken = this.cryptoService.generateOpaqueToken(48);
    const newTokenHash =
      this.cryptoService.hashOpaqueToken(newRawRefreshToken);

    await this.prisma.$transaction(async (tx) => {
      // Atomic conditional consumption so concurrent refresh calls with the same token cannot both rotate
      const consumedResult = await tx.refreshToken.updateMany({
        where: {
          id: existingToken.id,
          consumedAt: null,
          revokedAt: null,
        },
        data: {
          consumedAt: now,
        },
      });

      if (consumedResult.count !== 1) {
        // Concurrent reuse occurred during transaction window — revoke family and session
        await tx.refreshToken.updateMany({
          where: { familyId: existingToken.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.authSession.update({
          where: { id: existingToken.sessionId },
          data: {
            revokedAt: now,
            revokeReason: 'CONCURRENT_REFRESH_REUSE',
          },
        });
        throw new UnauthorizedException({
          errorCode: 'REFRESH_TOKEN_REUSED',
          message: 'Concurrent refresh token reuse detected. Session revoked.',
        });
      }

      const replacement = await tx.refreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: newTokenHash,
          familyId: existingToken.familyId,
          expiresAt: nextRefreshExpiresAt,
        },
      });

      await tx.refreshToken.update({
        where: { id: existingToken.id },
        data: { replacedByTokenId: replacement.id },
      });

      await tx.authSession.update({
        where: { id: session.id },
        data: {
          lastUsedAt: now,
          refreshTokenHash: newTokenHash,
          ipAddress: reqMeta.ipAddress
            ? reqMeta.ipAddress.slice(0, 64)
            : session.ipAddress,
        },
      });
    });

    const accessTtlSeconds = this.configService.get('JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });
    const accessToken = await this.signAccessToken(user.id, session.id);

    await this.securityLogger.record({
      eventType: 'REFRESH_TOKEN_ROTATED',
      userId: user.id,
      sessionId: session.id,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
    });

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
      tokenType: 'Bearer',
      expiresIn: accessTtlSeconds,
      session: {
        id: session.id,
        deviceName: session.deviceName,
        platform: session.platform,
        expiresAt: session.expiresAt.toISOString(),
      },
      user: this.sanitizeUser(user),
    };
  }

  async logout(
    userId: string,
    sessionId: string,
    refreshToken: string | undefined,
    reqMeta: RequestMetadata,
  ): Promise<{ message: string }> {
    const now = new Date();
    const tokenHash = refreshToken
      ? this.cryptoService.hashOpaqueToken(refreshToken.trim())
      : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.authSession.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: {
          revokedAt: now,
          revokeReason: 'USER_LOGOUT',
        },
      });

      await tx.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: now },
      });

      if (tokenHash) {
        await tx.refreshToken.updateMany({
          where: {
            tokenHash,
            session: { userId },
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }
    });

    await this.securityLogger.record({
      eventType: 'SESSION_LOGOUT',
      userId,
      sessionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
    });

    return { message: 'Signed out successfully.' };
  }

  async logoutAll(
    userId: string,
    currentSessionId: string,
    reqMeta: RequestMetadata,
  ): Promise<{ message: string; revokedCount: number }> {
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const sessionsUpdated = await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: {
          revokedAt: now,
          revokeReason: 'USER_LOGOUT_ALL',
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          session: { userId },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      return sessionsUpdated.count;
    });

    await this.securityLogger.record({
      eventType: 'LOGOUT_ALL_SESSIONS',
      userId,
      sessionId: currentSessionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { revokedCount: result },
    });

    return {
      message: 'All active sessions have been signed out.',
      revokedCount: result,
    };
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<
    Array<{
      id: string;
      deviceName: string;
      platform: string;
      ipAddress: string | null;
      createdAt: string;
      lastUsedAt: string;
      expiresAt: string;
      isCurrent: boolean;
    }>
  > {
    const now = new Date();
    const sessions = await this.prisma.authSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { lastUsedAt: 'desc' },
    });

    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      platform: s.platform,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      isCurrent: s.id === currentSessionId,
    }));
  }

  async revokeSession(
    userId: string,
    currentSessionId: string,
    targetSessionId: string,
    reqMeta: RequestMetadata,
  ): Promise<{ message: string; revokedSessionId: string }> {
    const targetSession = await this.prisma.authSession.findFirst({
      where: {
        id: targetSessionId,
        userId,
      },
    });

    if (!targetSession) {
      throw new NotFoundException({
        errorCode: 'SESSION_NOT_FOUND',
        message: 'Session not found.',
      });
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.authSession.update({
        where: { id: targetSessionId },
        data: {
          revokedAt: targetSession.revokedAt ?? now,
          revokeReason:
            targetSession.revokeReason ?? 'USER_REVOKED_SPECIFIC_SESSION',
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId: targetSessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    await this.securityLogger.record({
      eventType: 'SESSION_REVOKED',
      userId,
      sessionId: currentSessionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { targetSessionId },
    });

    return {
      message: 'Session revoked successfully.',
      revokedSessionId: targetSessionId,
    };
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    reqMeta: RequestMetadata,
  ): Promise<{ message: string; revokedCount: number }> {
    const now = new Date();
    const revokedCount = await this.prisma.$transaction(async (tx) => {
      const otherSessions = await tx.authSession.findMany({
        where: {
          userId,
          id: { not: currentSessionId },
          revokedAt: null,
        },
        select: { id: true },
      });

      const otherIds = otherSessions.map((s) => s.id);
      if (otherIds.length === 0) {
        return 0;
      }

      await tx.authSession.updateMany({
        where: { id: { in: otherIds } },
        data: {
          revokedAt: now,
          revokeReason: 'USER_REVOKED_OTHER_SESSIONS',
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          sessionId: { in: otherIds },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      return otherIds.length;
    });

    await this.securityLogger.record({
      eventType: 'OTHER_SESSIONS_REVOKED',
      userId,
      sessionId: currentSessionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { revokedCount },
    });

    return {
      message:
        revokedCount === 0
          ? 'No other active sessions found.'
          : `Revoked ${revokedCount} other active session${revokedCount === 1 ? '' : 's'}.`,
      revokedCount,
    };
  }

  async getMe(userId: string): Promise<SanitizedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        identities: true,
        securityPreference: true,
      },
    });

    if (!user || user.deletedAt !== null) {
      throw new NotFoundException({
        errorCode: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    return this.sanitizeUser(user);
  }

  async updateProfile(
    userId: string,
    sessionId: string,
    dto: UpdateProfileDto,
    reqMeta: RequestMetadata,
  ): Promise<SanitizedUser> {
    const cleanName = dto.displayName.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      throw new BadRequestException({
        errorCode: 'INVALID_DISPLAY_NAME',
        message: 'Full name must be between 2 and 80 characters.',
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName: cleanName },
      include: {
        identities: true,
        securityPreference: true,
      },
    });

    await this.securityLogger.record({
      eventType: 'PROFILE_UPDATED',
      userId,
      sessionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { displayNameUpdated: true },
    });

    return this.sanitizeUser(updated);
  }

  async deleteAccount(
    userId: string,
    sessionId: string,
    dto: DeleteAccountDto,
    reqMeta: RequestMetadata,
  ): Promise<{ message: string; deletedAt: string }> {
    if (dto.confirmationText.trim().toUpperCase() !== 'DELETE') {
      throw new BadRequestException({
        errorCode: 'CONFIRMATION_REQUIRED',
        message: 'Please type DELETE to confirm permanent account deletion.',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        securityPreference: true,
        identities: true,
      },
    });

    if (!user || user.deletedAt !== null) {
      throw new NotFoundException({
        errorCode: 'USER_NOT_FOUND',
        message: 'User account not found.',
      });
    }

    // Require re-authentication if password or PIN is configured
    if (user.passwordHash) {
      if (!dto.password) {
        throw new UnauthorizedException({
          errorCode: 'PASSWORD_REQUIRED_FOR_DELETE',
          message:
            'Please enter your current password to confirm account deletion.',
        });
      }
      const validPassword = await this.cryptoService.verifyPassword(
        user.passwordHash,
        dto.password,
      );
      if (!validPassword) {
        await this.securityLogger.record({
          eventType: 'ACCOUNT_DELETE_REAUTH_FAILED',
          userId,
          sessionId,
          ipAddress: reqMeta.ipAddress,
          userAgent: reqMeta.userAgent,
        });
        throw new UnauthorizedException({
          errorCode: 'INVALID_CREDENTIALS',
          message: 'Incorrect password. Account deletion was cancelled.',
        });
      }
    } else if (
      user.securityPreference?.pinEnabled &&
      user.securityPreference?.pinHash
    ) {
      if (!dto.pin) {
        throw new UnauthorizedException({
          errorCode: 'PIN_REQUIRED_FOR_DELETE',
          message: 'Please enter your App PIN to confirm account deletion.',
        });
      }
      await this.verifyPinInternal(userId, dto.pin, reqMeta);
    }

    const now = new Date();
    const anonymizedEmail = `deleted+${user.id}@deleted.artha.local`;

    await this.prisma.$transaction(async (tx) => {
      // Preserve collaborative groups with other members by transferring ownership
      const ownedGroups = await tx.expenseGroup.findMany({
        where: { createdById: userId },
        include: {
          members: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      for (const group of ownedGroups) {
        const otherMembers = group.members.filter((m) => m.userId !== userId);
        if (otherMembers.length > 0) {
          const successor =
            otherMembers.find((m) => m.role === GroupRole.ADMIN) ??
            otherMembers[0];
          await tx.expenseGroup.update({
            where: { id: group.id },
            data: { createdById: successor.userId },
          });
          await tx.expenseGroupMember.update({
            where: { id: successor.id },
            data: { role: GroupRole.OWNER },
          });
        } else {
          await tx.expenseGroup.delete({ where: { id: group.id } });
        }
      }

      // Remove user's group memberships and personal non-group expenses
      await tx.expenseGroupMember.deleteMany({ where: { userId } });
      await tx.expenseRecord.deleteMany({
        where: { ownerId: userId, groupId: null },
      });

      // Remove linked OAuth identities and local security preferences
      await tx.authIdentity.deleteMany({ where: { userId } });
      await tx.userSecurityPreference.deleteMany({ where: { userId } });

      // Revoke all sessions and refresh tokens
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'ACCOUNT_DELETED' },
      });
      await tx.refreshToken.updateMany({
        where: { session: { userId }, revokedAt: null },
        data: { revokedAt: now },
      });

      // Soft-delete and anonymize user record while preserving referential integrity for shared group expenses
      await tx.user.update({
        where: { id: userId },
        data: {
          displayName: 'Deleted Artha User',
          email: anonymizedEmail,
          normalizedEmail: anonymizedEmail,
          passwordHash: null,
          avatarUrl: null,
          isActive: false,
          status: UserStatus.DELETED,
          deletedAt: now,
        },
      });
    });

    await this.securityLogger.record({
      eventType: 'ACCOUNT_DELETED',
      userId,
      sessionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
    });

    this.mailService
      .sendAccountDeletedEmail({
        to: user.email,
        displayName: user.displayName,
        effectiveDate: now,
      })
      .catch((err: Error) =>
        this.logger.warn(
          `Failed to deliver account deleted confirmation email: ${err.message}`,
        ),
      );

    return {
      message: 'Your Artha account has been permanently deleted.',
      deletedAt: now.toISOString(),
    };
  }

  async getSecurityPreferences(userId: string): Promise<{
    biometricEnabled: boolean;
    pinEnabled: boolean;
    appLockTimeoutSeconds: number;
    requireReauthForSensitiveAction: boolean;
    hasPassword: boolean;
    linkedIdentities: Array<{
      provider: AuthProvider;
      providerEmail: string | null;
      linkedAt: string;
      lastUsedAt: string;
    }>;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        identities: true,
        securityPreference: true,
      },
    });

    if (!user) {
      throw new NotFoundException({
        errorCode: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    const pref = user.securityPreference;
    return {
      biometricEnabled: pref?.biometricEnabled ?? false,
      pinEnabled: pref?.pinEnabled ?? false,
      appLockTimeoutSeconds: pref?.appLockTimeoutSeconds ?? 60,
      requireReauthForSensitiveAction:
        pref?.requireReauthForSensitiveAction ?? true,
      hasPassword: Boolean(user.passwordHash),
      linkedIdentities: user.identities.map((id) => ({
        provider: id.provider,
        providerEmail: id.providerEmail,
        linkedAt: id.createdAt.toISOString(),
        lastUsedAt: id.lastUsedAt.toISOString(),
      })),
    };
  }

  async updateSecurityPreferences(
    userId: string,
    sessionId: string,
    dto: UpdateSecurityPreferencesDto,
    reqMeta: RequestMetadata,
  ) {
    const existingPref = await this.prisma.userSecurityPreference.findUnique({
      where: { userId },
    });

    let nextPinHash = existingPref?.pinHash ?? null;
    let nextPinEnabled =
      dto.pinEnabled ?? existingPref?.pinEnabled ?? false;

    // If changing or disabling an existing PIN, verify currentPin if one is already set
    if (existingPref?.pinEnabled && existingPref.pinHash) {
      const isChangingOrDisablingPin =
        dto.pinEnabled === false || dto.pin !== undefined;
      if (isChangingOrDisablingPin) {
        if (!dto.currentPin) {
          throw new UnauthorizedException({
            errorCode: 'CURRENT_PIN_REQUIRED',
            message:
              'Please provide your current PIN to change or disable PIN protection.',
          });
        }
        await this.verifyPinInternal(userId, dto.currentPin, reqMeta);
      }
    }

    if (dto.pinEnabled === true) {
      if (!dto.pin && !existingPref?.pinHash) {
        throw new BadRequestException({
          errorCode: 'PIN_REQUIRED',
          message: 'A 4 to 6 digit numeric PIN is required when enabling PIN lock.',
        });
      }
      if (dto.pin) {
        nextPinHash = await this.cryptoService.hashSecret(dto.pin);
      }
    } else if (dto.pinEnabled === false) {
      nextPinHash = null;
      nextPinEnabled = false;
    } else if (dto.pin) {
      nextPinHash = await this.cryptoService.hashSecret(dto.pin);
      nextPinEnabled = true;
    }

    await this.prisma.userSecurityPreference.upsert({
      where: { userId },
      create: {
        userId,
        biometricEnabled: dto.biometricEnabled ?? false,
        biometricKeyId: dto.biometricKeyId ?? null,
        pinEnabled: nextPinEnabled,
        pinHash: nextPinHash,
        appLockTimeoutSeconds: dto.appLockTimeoutSeconds ?? 60,
        requireReauthForSensitiveAction:
          dto.requireReauthForSensitiveAction ?? true,
      },
      update: {
        ...(dto.biometricEnabled !== undefined
          ? { biometricEnabled: dto.biometricEnabled }
          : {}),
        ...(dto.biometricKeyId !== undefined
          ? { biometricKeyId: dto.biometricKeyId }
          : {}),
        pinEnabled: nextPinEnabled,
        pinHash: nextPinHash,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        ...(dto.appLockTimeoutSeconds !== undefined
          ? { appLockTimeoutSeconds: dto.appLockTimeoutSeconds }
          : {}),
        ...(dto.requireReauthForSensitiveAction !== undefined
          ? {
              requireReauthForSensitiveAction:
                dto.requireReauthForSensitiveAction,
            }
          : {}),
      },
    });

    await this.securityLogger.record({
      eventType: 'SECURITY_PREFERENCES_UPDATED',
      userId,
      sessionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: {
        biometricEnabled: dto.biometricEnabled,
        pinEnabled: nextPinEnabled,
        appLockTimeoutSeconds: dto.appLockTimeoutSeconds,
      },
    });

    return this.getSecurityPreferences(userId);
  }

  async reauthenticate(
    userId: string,
    sessionId: string,
    dto: ReauthenticateDto,
    reqMeta: RequestMetadata,
  ): Promise<{
    verified: true;
    reauthenticatedAt: string;
    expiresInSeconds: number;
  }> {
    if (!dto.password && !dto.pin) {
      throw new BadRequestException({
        errorCode: 'CREDENTIALS_REQUIRED',
        message: 'Provide either your password or your app PIN to re-authenticate.',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { securityPreference: true },
    });

    if (!user) {
      throw new NotFoundException({
        errorCode: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    if (dto.password) {
      if (!user.passwordHash) {
        throw new BadRequestException({
          errorCode: 'NO_PASSWORD_SET',
          message: 'This account does not have a password configured.',
        });
      }
      const valid = await this.cryptoService.verifyPassword(
        user.passwordHash,
        dto.password,
      );
      if (!valid) {
        await this.securityLogger.record({
          eventType: 'REAUTH_FAILED',
          userId,
          sessionId,
          ipAddress: reqMeta.ipAddress,
          userAgent: reqMeta.userAgent,
          metadata: { method: 'password' },
        });
        throw new UnauthorizedException({
          errorCode: 'INVALID_CREDENTIALS',
          message: 'Invalid password.',
        });
      }
    } else if (dto.pin) {
      await this.verifyPinInternal(userId, dto.pin, reqMeta);
    }

    const now = new Date();
    await this.prisma.authSession.update({
      where: { id: sessionId },
      data: { lastReauthenticatedAt: now },
    });

    const reauthWindowSeconds = this.configService.get('REAUTH_WINDOW_SECONDS', {
      infer: true,
    });

    await this.securityLogger.record({
      eventType: 'REAUTHENTICATED',
      userId,
      sessionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: { method: dto.password ? 'password' : 'pin' },
    });

    return {
      verified: true,
      reauthenticatedAt: now.toISOString(),
      expiresInSeconds: reauthWindowSeconds,
    };
  }

  private async verifyPinInternal(
    userId: string,
    pin: string,
    reqMeta: RequestMetadata,
  ): Promise<void> {
    const pref = await this.prisma.userSecurityPreference.findUnique({
      where: { userId },
    });

    if (!pref || !pref.pinEnabled || !pref.pinHash) {
      throw new BadRequestException({
        errorCode: 'PIN_NOT_ENABLED',
        message: 'App PIN is not configured for this account.',
      });
    }

    const now = new Date();
    if (pref.pinLockedUntil && pref.pinLockedUntil > now) {
      const retryAfterSeconds = Math.ceil(
        (pref.pinLockedUntil.getTime() - now.getTime()) / 1000,
      );
      throw new HttpException(
        {
          errorCode: 'PIN_LOCKED_OUT',
          message: `Too many failed PIN attempts. Try again in ${retryAfterSeconds} seconds.`,
          details: { retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const valid = await this.cryptoService.verifySecret(pref.pinHash, pin);
    if (!valid) {
      const nextAttempts = pref.pinFailedAttempts + 1;
      const lockedUntil =
        nextAttempts >= MAX_PIN_ATTEMPTS
          ? new Date(now.getTime() + PIN_LOCKOUT_MINUTES * 60 * 1000)
          : null;

      await this.prisma.userSecurityPreference.update({
        where: { userId },
        data: {
          pinFailedAttempts: nextAttempts,
          pinLockedUntil: lockedUntil,
        },
      });

      await this.securityLogger.record({
        eventType: lockedUntil ? 'PIN_LOCKOUT' : 'PIN_VERIFY_FAILED',
        userId,
        ipAddress: reqMeta.ipAddress,
        userAgent: reqMeta.userAgent,
        metadata: { failedAttempts: nextAttempts },
      });

      if (lockedUntil) {
        throw new HttpException(
          {
            errorCode: 'PIN_LOCKED_OUT',
            message: `Maximum PIN attempts exceeded. PIN unlock is locked for ${PIN_LOCKOUT_MINUTES} minutes.`,
            details: { retryAfterSeconds: PIN_LOCKOUT_MINUTES * 60 },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw new UnauthorizedException({
        errorCode: 'INVALID_PIN',
        message: 'Incorrect PIN.',
        details: {
          remainingAttempts: Math.max(0, MAX_PIN_ATTEMPTS - nextAttempts),
        },
      });
    }

    if (pref.pinFailedAttempts > 0 || pref.pinLockedUntil !== null) {
      await this.prisma.userSecurityPreference.update({
        where: { userId },
        data: {
          pinFailedAttempts: 0,
          pinLockedUntil: null,
        },
      });
    }
  }

  private async createAuthenticatedSession(params: {
    user: User & {
      identities?: Array<{ provider: AuthProvider }>;
      securityPreference?: {
        biometricEnabled: boolean;
        pinEnabled: boolean;
        appLockTimeoutSeconds: number;
        requireReauthForSensitiveAction: boolean;
      } | null;
    };
    deviceName: string;
    platform: string;
    reqMeta: RequestMetadata;
    loginEventType: string;
  }): Promise<AuthSessionResponse> {
    const { user, deviceName, platform, reqMeta, loginEventType } = params;
    const now = new Date();

    const sessionAbsoluteTtlDays = this.configService.get(
      'SESSION_ABSOLUTE_TTL_DAYS',
      { infer: true },
    );
    const refreshTtlDays = this.configService.get('REFRESH_TOKEN_TTL_DAYS', {
      infer: true,
    });
    const accessTtlSeconds = this.configService.get('JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });

    const sessionExpiresAt = new Date(
      now.getTime() + sessionAbsoluteTtlDays * 24 * 60 * 60 * 1000,
    );
    const refreshExpiresAt = new Date(
      now.getTime() + refreshTtlDays * 24 * 60 * 60 * 1000,
    );

    const rawRefreshToken = this.cryptoService.generateOpaqueToken(48);
    const refreshTokenHash =
      this.cryptoService.hashOpaqueToken(rawRefreshToken);
    const familyId = randomUUID();

    const session = await this.prisma.$transaction(async (tx) => {
      const createdSession = await tx.authSession.create({
        data: {
          userId: user.id,
          deviceName: deviceName.trim().slice(0, 120) || 'Artha Mobile Client',
          platform: platform.trim().slice(0, 32) || 'mobile',
          refreshTokenHash,
          ipAddress: reqMeta.ipAddress ? reqMeta.ipAddress.slice(0, 64) : null,
          userAgent: reqMeta.userAgent ? reqMeta.userAgent.slice(0, 256) : null,
          lastReauthenticatedAt: now,
          expiresAt: sessionExpiresAt,
        },
      });

      await tx.refreshToken.create({
        data: {
          sessionId: createdSession.id,
          tokenHash: refreshTokenHash,
          familyId,
          expiresAt: refreshExpiresAt,
        },
      });

      return createdSession;
    });

    const accessToken = await this.signAccessToken(user.id, session.id);

    await this.securityLogger.record({
      eventType: loginEventType,
      userId: user.id,
      sessionId: session.id,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: {
        deviceName: session.deviceName,
        platform: session.platform,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      tokenType: 'Bearer',
      expiresIn: accessTtlSeconds,
      session: {
        id: session.id,
        deviceName: session.deviceName,
        platform: session.platform,
        expiresAt: session.expiresAt.toISOString(),
      },
      user: this.sanitizeUser(user),
    };
  }

  private async signAccessToken(
    userId: string,
    sessionId: string,
  ): Promise<string> {
    const secret = this.configService.get('JWT_SIGNING_SECRET', {
      infer: true,
    });
    const issuer = this.configService.get('JWT_ISSUER', { infer: true });
    const audience = this.configService.get('JWT_AUDIENCE', { infer: true });
    const expiresIn = this.configService.get('JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });

    return this.jwtService.signAsync(
      {
        sub: userId,
        sid: sessionId,
      },
      {
        algorithm: 'HS256',
        secret,
        issuer,
        audience,
        expiresIn,
      },
    );
  }

  sanitizeUser(
    user: User & {
      identities?: Array<{ provider: AuthProvider }>;
      securityPreference?: {
        biometricEnabled: boolean;
        pinEnabled: boolean;
        appLockTimeoutSeconds: number;
        requireReauthForSensitiveAction: boolean;
      } | null;
    },
  ): SanitizedUser {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl ?? null,
      emailVerified: user.emailVerifiedAt !== null,
      emailVerifiedAt: user.emailVerifiedAt
        ? user.emailVerifiedAt.toISOString()
        : null,
      status: user.status,
      hasPassword: Boolean(user.passwordHash),
      linkedProviders: (user.identities ?? []).map((i) => i.provider),
      securityPreferences: {
        biometricEnabled: user.securityPreference?.biometricEnabled ?? false,
        pinEnabled: user.securityPreference?.pinEnabled ?? false,
        appLockTimeoutSeconds:
          user.securityPreference?.appLockTimeoutSeconds ?? 60,
        requireReauthForSensitiveAction:
          user.securityPreference?.requireReauthForSensitiveAction ?? true,
      },
      createdAt: user.createdAt.toISOString(),
    };
  }
}
