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
  CreateAccountDto,
  ListAccountsQueryDto,
  UpdateAccountDto,
} from './accounts.dto';
import { AccountsService } from './accounts.service';

@ApiTags('Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List your accounts with current balances (creates a Cash account on first use)',
  })
  async list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: ListAccountsQueryDto,
  ) {
    return {
      accounts: await this.accounts.list(
        user.userId,
        query.includeArchived ?? false,
      ),
    };
  }

  @Post()
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Create an account' })
  async create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: CreateAccountDto,
  ) {
    return { account: await this.accounts.create(user.userId, dto) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of your accounts' })
  async get(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { account: await this.accounts.get(user.userId, id) };
  }

  @Patch(':id')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary:
      'Rename, retype, set default, change opening balance, or un-archive',
  })
  async update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return { account: await this.accounts.update(user.userId, id, dto) };
  }

  @Delete(':id')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary: 'Archive an account (history is kept; never hard-deleted)',
  })
  async archive(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { account: await this.accounts.archive(user.userId, id) };
  }
}
