import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { extractRequestMetadata } from '../common/guards/ip-throttler.guard';
import { AuthService, type RequestMetadata } from './auth.service';
import {
  type AuthenticatedPrincipal,
  CurrentUser,
} from './decorators/current-user.decorator';
import { UpdateSecurityPreferencesDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('User Security Preferences')
@Controller('users/me/security')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersSecurityController {
  constructor(private readonly authService: AuthService) {}

  private extractMeta(req: Request): RequestMetadata {
    return extractRequestMetadata(req);
  }

  @Get()
  @ApiOperation({
    summary:
      'Get biometric, PIN, re-authentication, and linked provider security settings',
  })
  async getSecurityPreferences(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.authService.getSecurityPreferences(user.userId);
  }

  @Patch()
  @ApiOperation({
    summary:
      'Update biometric opt-in, app PIN (stored hashed with Argon2id), or lock timeout settings',
  })
  async updateSecurityPreferences(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: UpdateSecurityPreferencesDto,
    @Req() req: Request,
  ) {
    return this.authService.updateSecurityPreferences(
      user.userId,
      user.sessionId,
      dto,
      this.extractMeta(req),
    );
  }
}
