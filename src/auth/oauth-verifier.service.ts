import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ValidatedEnvConfig } from '../config/env.validation';

export interface VerifiedOAuthIdentity {
  provider: AuthProvider;
  providerSubject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl?: string | null;
}

const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');

@Injectable()
export class OAuthVerifierService {
  private readonly googleClient = new OAuth2Client();
  private readonly appleJwks = createRemoteJWKSet(APPLE_JWKS_URL);

  constructor(
    private readonly configService: ConfigService<ValidatedEnvConfig, true>,
  ) {}

  async verifyGoogleIdToken(idToken: string): Promise<VerifiedOAuthIdentity> {
    if (
      !idToken ||
      typeof idToken !== 'string' ||
      idToken.trim().split('.').length !== 3
    ) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_OAUTH_TOKEN',
        message: 'Invalid Google identity token.',
      });
    }

    const webClientId = this.configService.get('GOOGLE_WEB_CLIENT_ID', {
      infer: true,
    });
    const allowedClientIds = this.configService.get('GOOGLE_OAUTH_CLIENT_IDS', {
      infer: true,
    });

    const audiences = Array.from(
      new Set([webClientId, ...(allowedClientIds ?? [])].filter(Boolean)),
    );

    if (audiences.length === 0) {
      throw new UnauthorizedException({
        errorCode: 'OAUTH_PROVIDER_NOT_CONFIGURED',
        message:
          'Google Sign-In is not configured on the server (GOOGLE_WEB_CLIENT_ID / GOOGLE_OAUTH_CLIENT_IDS missing).',
      });
    }

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: idToken.trim(),
        audience: audiences,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.sub) {
        throw new Error('Missing Google subject claim');
      }

      const validIssuers = new Set([
        'accounts.google.com',
        'https://accounts.google.com',
      ]);
      if (!payload.iss || !validIssuers.has(payload.iss)) {
        throw new Error('Invalid Google token issuer');
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!payload.exp || payload.exp <= nowSeconds) {
        throw new Error('Google identity token has expired');
      }

      return {
        provider: AuthProvider.GOOGLE,
        providerSubject: payload.sub,
        email: payload.email ? payload.email.trim().toLowerCase() : null,
        emailVerified: payload.email_verified === true,
        displayName: payload.name?.trim() || null,
        avatarUrl: payload.picture?.trim() || null,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException({
        errorCode: 'INVALID_OAUTH_TOKEN',
        message: 'Google identity token verification failed.',
      });
    }
  }

  async verifyAppleIdentityToken(params: {
    identityToken: string;
    fullName?: string | null;
  }): Promise<VerifiedOAuthIdentity> {
    const { identityToken, fullName } = params;
    if (
      !identityToken ||
      typeof identityToken !== 'string' ||
      identityToken.trim().split('.').length !== 3
    ) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_OAUTH_TOKEN',
        message: 'Invalid Apple identity token.',
      });
    }

    const allowedClientIds = this.configService.get('APPLE_CLIENT_IDS', {
      infer: true,
    });

    if (!allowedClientIds || allowedClientIds.length === 0) {
      throw new UnauthorizedException({
        errorCode: 'OAUTH_PROVIDER_NOT_CONFIGURED',
        message:
          'Sign in with Apple is not configured on the server (APPLE_CLIENT_IDS missing).',
      });
    }

    try {
      const { payload } = await jwtVerify(identityToken.trim(), this.appleJwks, {
        issuer: 'https://appleid.apple.com',
        audience: allowedClientIds,
      });

      if (!payload.sub || typeof payload.sub !== 'string') {
        throw new Error('Missing Apple subject claim');
      }

      const email =
        typeof payload.email === 'string'
          ? payload.email.trim().toLowerCase()
          : null;
      const emailVerifiedClaim = payload.email_verified;
      const emailVerified =
        emailVerifiedClaim === true || emailVerifiedClaim === 'true';

      return {
        provider: AuthProvider.APPLE,
        providerSubject: payload.sub,
        email,
        emailVerified,
        displayName: fullName?.trim() || null,
        avatarUrl: null,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException({
        errorCode: 'INVALID_OAUTH_TOKEN',
        message: 'Apple identity token verification failed.',
      });
    }
  }
}
