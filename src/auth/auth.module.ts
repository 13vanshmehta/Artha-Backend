import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SecurityLoggerService } from '../common/logging/security-logger.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MailService } from './mail.service';
import { OAuthVerifierService } from './oauth-verifier.service';
import { UsersSecurityController } from './users-security.controller';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, UsersSecurityController],
  providers: [
    AuthService,
    CryptoService,
    MailService,
    OAuthVerifierService,
    SecurityLoggerService,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    CryptoService,
    MailService,
    OAuthVerifierService,
    SecurityLoggerService,
    JwtAuthGuard,
    JwtModule,
  ],
})
export class AuthModule {}
