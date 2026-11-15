import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GroupRole } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'Roommates' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'currency must be a 3-letter ISO 4217 currency code.',
  })
  currency?: string;
}

export class AddGroupMemberDto {
  @ApiProperty({ description: 'UUID of the user to add to the group' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ enum: GroupRole, default: GroupRole.MEMBER })
  @IsOptional()
  @IsEnum(GroupRole)
  role?: GroupRole;
}

