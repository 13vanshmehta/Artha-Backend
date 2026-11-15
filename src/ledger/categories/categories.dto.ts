import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  toStrictBoolean,
  trimOrNull,
  trimToNull,
} from '../../common/validation/query-transforms';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const ICON_NAME = /^[A-Za-z0-9_-]{1,40}$/;

export class CreateCategoryDto {
  @ApiProperty({ example: 'Pet Care', maxLength: 40 })
  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name!: string;

  @ApiProperty({ enum: CategoryType })
  @IsEnum(CategoryType)
  type!: CategoryType;

  @ApiPropertyOptional({ example: 'PawPrint' })
  @IsOptional()
  @Matches(ICON_NAME, {
    message: 'icon must be an icon name of letters, digits, _ or -.',
  })
  icon?: string;

  @ApiPropertyOptional({ example: '#F97316' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'color must be a hex colour like #F97316.' })
  color?: string;

  @ApiPropertyOptional({ default: 500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null clears' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(ICON_NAME, {
    message: 'icon must be an icon name of letters, digits, _ or -.',
  })
  icon?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'null clears' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(HEX_COLOR, { message: 'color must be a hex colour like #F97316.' })
  color?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;

  @ApiPropertyOptional({
    description: '`false` un-archives. Archive with DELETE /categories/:id.',
  })
  @IsOptional()
  @Transform(toStrictBoolean)
  @IsBoolean()
  isArchived?: boolean;
}

export class ListCategoriesQueryDto {
  @ApiPropertyOptional({ enum: CategoryType })
  @IsOptional()
  @IsEnum(CategoryType)
  type?: CategoryType;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toStrictBoolean)
  @IsBoolean()
  includeArchived?: boolean;
}
