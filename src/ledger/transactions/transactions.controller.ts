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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  type AuthenticatedPrincipal,
  CurrentUser,
} from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WRITE_THROTTLE } from '../shared/throttle';
import {
  CreateTransactionDto,
  ListTransactionsQueryDto,
  UpdateTransactionDto,
} from './transactions.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary:
      'Record an INCOME, EXPENSE, TRANSFER, REFUND or ADJUSTMENT (idempotent)',
  })
  @ApiResponse({ status: 201, description: 'Created.' })
  @ApiResponse({
    status: 200,
    description: 'Replay of an already-recorded clientTransactionId.',
  })
  @ApiResponse({
    status: 409,
    description: 'clientTransactionId reused with different content.',
  })
  async create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: CreateTransactionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.transactions.create(user.userId, dto);
    res.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return {
      transaction: result.transaction,
      idempotentReplay: result.replayed,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'History with filters, search and cursor pagination',
  })
  async list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.transactions.list(user.userId, user.timezone, query);
  }

  @Get('recent')
  @ApiOperation({
    summary: 'Today, yesterday and the day before, in your timezone',
  })
  async recent(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.transactions.recent(user.userId, user.timezone);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One transaction (including soft-deleted ones, for Undo)',
  })
  async get(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { transaction: await this.transactions.get(user.userId, id) };
  }

  @Patch(':id')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Edit a transaction (type is immutable)' })
  async update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    return {
      transaction: await this.transactions.update(user.userId, id, dto),
    };
  }

  @Delete(':id')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Soft-delete (restorable)' })
  async remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { transaction: await this.transactions.remove(user.userId, id) };
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Undo a soft delete' })
  async restore(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { transaction: await this.transactions.restore(user.userId, id) };
  }
}
