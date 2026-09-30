import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { extractRequestMetadata } from '../common/guards/ip-throttler.guard';
import { AuthService, type RequestMetadata } from './auth.service';
import {
  type AuthenticatedPrincipal,
  CurrentUser,
} from './decorators/current-user.decorator';
import {
  AppleOAuthDto,
  ChangePasswordDto,
  ConfirmEmailVerificationDto,
  DeleteAccountDto,
  ForgotPasswordDto,
  GoogleOAuthDto,
  LoginDto,
  LogoutDto,
  ReauthenticateDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  SendEmailVerificationDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Authentication & Sessions')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private extractMeta(req: Request): RequestMetadata {
    return extractRequestMetadata(req);
  }

  @Post('register')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Register a new Artha account and dispatch a 6-digit email OTP',
  })
  @ApiResponse({ status: 201, description: 'Account created in unverified state' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, this.extractMeta(req));
  }

  @Post('email/verification/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Send or resend a 6-digit email verification code (OTP)',
  })
  @ApiResponse({ status: 200, description: 'Verification code dispatched' })
  @ApiResponse({ status: 429, description: 'Resend cooldown active' })
  async sendEmailVerification(
    @Body() dto: SendEmailVerificationDto,
    @Req() req: Request,
  ) {
    return this.authService.sendEmailVerification(dto, this.extractMeta(req));
  }

  @Post('email/verification/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Confirm 6-digit email OTP and issue an authenticated Artha session',
  })
  @ApiResponse({ status: 200, description: 'Email verified and session issued' })
  @ApiResponse({ status: 400, description: 'Invalid, expired, or consumed OTP' })
  async confirmEmailVerification(
    @Body() dto: ConfirmEmailVerificationDto,
    @Req() req: Request,
  ) {
    return this.authService.confirmEmailVerification(
      dto,
      this.extractMeta(req),
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiResponse({ status: 200, description: 'Authenticated session issued' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({ status: 403, description: 'Email unverified or account disabled' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, this.extractMeta(req));
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request a single-use password reset token (enumeration-safe)',
  })
  @ApiResponse({ status: 200, description: 'Generic recovery confirmation' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto, this.extractMeta(req));
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Reset password using a single-use reset token and revoke active sessions',
  })
  @ApiResponse({ status: 200, description: 'Password reset completed' })
  @ApiResponse({ status: 400, description: 'Invalid, expired, or reused token' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto, this.extractMeta(req));
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change password for the currently authenticated user',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.authService.changePassword(
      user.userId,
      user.sessionId,
      dto,
      this.extractMeta(req),
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user profile' })
  async getMe(@CurrentUser() user: AuthenticatedPrincipal) {
    return {
      user: await this.authService.getMe(user.userId),
      currentSessionId: user.sessionId,
    };
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the currently authenticated user profile' })
  async updateMe(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: UpdateProfileDto,
    @Req() req: Request,
  ) {
    const updatedUser = await this.authService.updateProfile(
      user.userId,
      user.sessionId,
      dto,
      this.extractMeta(req),
    );
    return {
      message: 'Profile updated successfully.',
      user: updatedUser,
    };
  }

  @Post('oauth/google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sign in or register with a server-verified Google ID token',
  })
  async googleOAuth(@Body() dto: GoogleOAuthDto, @Req() req: Request) {
    return this.authService.loginWithGoogle(dto, this.extractMeta(req));
  }

  @Post('oauth/apple')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sign in or register with a server-verified Apple identity token',
  })
  async appleOAuth(@Body() dto: AppleOAuthDto, @Req() req: Request) {
    return this.authService.loginWithApple(dto, this.extractMeta(req));
  }

  @Post('oauth/link/google')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Link a verified Google identity to the currently authenticated user',
  })
  async linkGoogle(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: GoogleOAuthDto,
    @Req() req: Request,
  ) {
    const updated = await this.authService.linkGoogleIdentity(
      user.userId,
      dto,
      this.extractMeta(req),
    );
    return {
      message: 'Google account linked successfully.',
      user: updated,
    };
  }

  @Post('oauth/link/apple')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Link a verified Apple identity to the currently authenticated user',
  })
  async linkApple(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: AppleOAuthDto,
    @Req() req: Request,
  ) {
    const updated = await this.authService.linkAppleIdentity(
      user.userId,
      dto,
      this.extractMeta(req),
    );
    return {
      message: 'Apple account linked successfully.',
      user: updated,
    };
  }

  @Delete('oauth/:provider')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Unlink a social identity provider (google or apple)',
  })
  async unlinkOAuth(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('provider') provider: string,
    @Req() req: Request,
  ) {
    const updated = await this.authService.unlinkOAuthIdentity(
      user.userId,
      provider,
      this.extractMeta(req),
    );
    return {
      message: `${provider.toUpperCase()} account unlinked successfully.`,
      user: updated,
    };
  }

  @Post('token/refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Atomically rotate an opaque refresh token and issue a fresh access JWT',
  })
  async refreshTokens(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refreshTokens(
      dto.refreshToken,
      this.extractMeta(req),
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session and its refresh tokens' })
  async logout(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: LogoutDto,
    @Req() req: Request,
  ) {
    return this.authService.logout(
      user.userId,
      user.sessionId,
      dto.refreshToken,
      this.extractMeta(req),
    );
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke all active sessions across all devices for the current user',
  })
  async logoutAll(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Req() req: Request,
  ) {
    return this.authService.logoutAll(
      user.userId,
      user.sessionId,
      this.extractMeta(req),
    );
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all active sessions for the currently authenticated user',
  })
  async listSessions(@CurrentUser() user: AuthenticatedPrincipal) {
    return {
      sessions: await this.authService.listSessions(
        user.userId,
        user.sessionId,
      ),
    };
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a specific session by ID' })
  async revokeSession(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Req() req: Request,
  ) {
    return this.authService.revokeSession(
      user.userId,
      user.sessionId,
      sessionId,
      this.extractMeta(req),
    );
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Revoke all active sessions except the current device session',
  })
  async revokeOtherSessions(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Req() req: Request,
  ) {
    return this.authService.revokeOtherSessions(
      user.userId,
      user.sessionId,
      this.extractMeta(req),
    );
  }

  @Post('re-authenticate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Re-authenticate the current session using password or PIN for sensitive operations',
  })
  async reauthenticate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: ReauthenticateDto,
    @Req() req: Request,
  ) {
    return this.authService.reauthenticate(
      user.userId,
      user.sessionId,
      dto,
      this.extractMeta(req),
    );
  }

  @Post('account/delete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Permanently delete the authenticated user account after re-authentication and group ownership transfer',
  })
  async deleteAccount(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: DeleteAccountDto,
    @Req() req: Request,
  ) {
    return this.authService.deleteAccount(
      user.userId,
      user.sessionId,
      dto,
      this.extractMeta(req),
    );
  }
}
