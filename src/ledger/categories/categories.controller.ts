import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthenticatedPrincipal,
  CurrentUser,
} from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WRITE_THROTTLE } from '../shared/throttle';
import {
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './categories.dto';
import { CategoriesService } from './categories.service';

@ApiTags('Categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'List system categories plus your own custom categories',
  })
  async list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: ListCategoriesQueryDto,
  ) {
    return {
      categories: await this.categories.list(user.userId, {
        type: query.type,
        includeArchived: query.includeArchived ?? false,
      }),
    };
  }

  @Post()
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Create a custom category' })
  async create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: CreateCategoryDto,
  ) {
    return { category: await this.categories.create(user.userId, dto) };
  }

  @Patch(':id')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Edit or un-archive one of your custom categories' })
  async update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return { category: await this.categories.update(user.userId, id, dto) };
  }

  @Delete(':id')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary: 'Archive one of your custom categories (history is kept)',
  })
  async archive(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { category: await this.categories.archive(user.userId, id) };
  }
}
