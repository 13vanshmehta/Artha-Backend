import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { Request } from 'express';
import { ValidatedEnvConfig } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedPrincipal } from '../decorators/current-user.decorator';

interface AccessTokenPayload {
  sub: string;
  sid: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<ValidatedEnvConfig, true>,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedPrincipal }>();

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        errorCode: 'MISSING_ACCESS_TOKEN',
        message: 'Authentication token is required.',
      });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException({
        errorCode: 'MISSING_ACCESS_TOKEN',
        message: 'Authentication token is required.',
      });
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        algorithms: ['HS256'],
        secret: this.configService.get('JWT_SIGNING_SECRET', { infer: true }),
        issuer: this.configService.get('JWT_ISSUER', { infer: true }),
        audience: this.configService.get('JWT_AUDIENCE', { infer: true }),
      });
    } catch (err) {
      const isExpired =
        err instanceof Error && err.name === 'TokenExpiredError';
      throw new UnauthorizedException({
        errorCode: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_ACCESS_TOKEN',
        message: isExpired
          ? 'Access token has expired.'
          : 'Invalid access token.',
      });
    }

    if (!payload.sub || !payload.sid) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_ACCESS_TOKEN',
        message: 'Malformed access token claims.',
      });
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    const now = new Date();
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt !== null ||
      session.expiresAt <= now
    ) {
      throw new UnauthorizedException({
        errorCode: 'SESSION_REVOKED',
        message: 'Session is no longer active. Please sign in again.',
      });
    }

    if (
      session.user.deletedAt !== null ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException({
        errorCode: 'ACCOUNT_INACTIVE',
        message: 'Account is not active.',
      });
    }

    request.user = {
      userId: session.user.id,
      sessionId: session.id,
      email: session.user.email,
      displayName: session.user.displayName,
    };

    return true;
  }
}
