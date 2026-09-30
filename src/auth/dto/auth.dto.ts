import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class DeviceContextDto {
  @ApiPropertyOptional({ example: 'iPhone 16 Pro' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @ApiPropertyOptional({ example: 'ios' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  platform?: string;
}

export class RegisterDto extends DeviceContextDto {
  @ApiProperty({ example: 'Vansh Mehta' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @ApiProperty({ example: 'vansh@artha.app' })
  @Transform(trimString)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'StrongPass#2026',
    description:
      'Minimum 8 characters, including uppercase, lowercase, number, and symbol.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, {
    message:
      'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.',
  })
  password!: string;
}

export class SendEmailVerificationDto {
  @ApiProperty({ example: 'vansh@artha.app' })
  @Transform(trimString)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ConfirmEmailVerificationDto extends DeviceContextDto {
  @ApiProperty({ example: 'vansh@artha.app' })
  @Transform(trimString)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '482910', description: '6-digit numeric OTP code' })
  @Transform(trimString)
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'OTP code must be exactly 6 digits.' })
  code!: string;
}

export class LoginDto extends DeviceContextDto {
  @ApiProperty({ example: 'vansh@artha.app' })
  @Transform(trimString)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'StrongPass#2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'vansh@artha.app' })
  @Transform(trimString)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'vansh@artha.app' })
  @Transform(trimString)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ description: 'Single-use cryptographic reset token' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(16)
  @MaxLength(256)
  resetToken!: string;

  @ApiProperty({ example: 'NewStrongPass#2026' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, {
    message:
      'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.',
  })
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiPropertyOptional({
    description:
      'Current password (required unless session was recently re-authenticated)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;

  @ApiProperty({ example: 'UpdatedStrongPass#2026' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, {
    message:
      'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character.',
  })
  newPassword!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  revokeOtherSessions?: boolean;
}

export class GoogleOAuthDto extends DeviceContextDto {
  @ApiProperty({ description: 'Signed Google ID Token (JWT) from Google SDK' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  idToken!: string;
}

export class AppleOAuthDto extends DeviceContextDto {
  @ApiProperty({
    description: 'Signed Apple identityToken (JWT) from Sign in with Apple',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  identityToken!: string;

  @ApiPropertyOptional({
    description:
      'Optional user display name provided by Apple on first authorization',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fullName?: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Opaque refresh token' })
  @IsString()
  @IsNotEmpty()
  @MinLength(24)
  @MaxLength(512)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({
    description: 'Optional opaque refresh token to revoke alongside session',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  refreshToken?: string;
}

export class ReauthenticateDto {
  @ApiPropertyOptional({ description: 'Account password for re-authentication' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ description: '4 to 6 digit app PIN for re-authentication' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4 to 6 digits.' })
  pin?: string;
}

export class UpdateSecurityPreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  biometricEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  biometricKeyId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pinEnabled?: boolean;

  @ApiPropertyOptional({
    description: '4 to 6 digit numeric PIN when enabling or changing PIN',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'PIN must be 4 to 6 numeric digits.',
  })
  pin?: string;

  @ApiPropertyOptional({
    description: 'Current PIN when changing or disabling an existing PIN',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, {
    message: 'Current PIN must be 4 to 6 numeric digits.',
  })
  currentPin?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 3600 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  appLockTimeoutSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireReauthForSensitiveAction?: boolean;
}

export class VerifyPinDto {
  @ApiProperty({ example: '2580' })
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4 to 6 numeric digits.' })
  pin!: string;
}

export class UpdateProfileDto {
  @ApiProperty({ example: 'Vansh Mehta' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MinLength(2, { message: 'Full name must be at least 2 characters.' })
  @MaxLength(80, { message: 'Full name must be at most 80 characters.' })
  displayName!: string;
}

export class DeleteAccountDto {
  @ApiProperty({
    example: 'DELETE',
    description: 'Explicit confirmation phrase DELETE',
  })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  confirmationText!: string;

  @ApiPropertyOptional({
    description: 'Current account password for re-authentication',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({
    description: '4 to 6 digit app PIN for re-authentication',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4 to 6 numeric digits.' })
  pin?: string;
}

