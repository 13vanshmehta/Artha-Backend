import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthenticatedPrincipal,
  CurrentUser,
} from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrencyQueryDto, SummaryQueryDto } from './analytics.dto';
import { AnalyticsService } from './analytics.service';

@ApiTags('Home & Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('home')
  @ApiOperation({
    summary: 'Home screen: this month, today, top categories, recent, balances',
  })
  async home(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: CurrencyQueryDto,
  ) {
    return this.analytics.home(
      user.userId,
      user.timezone,
      query.currency ?? 'INR',
    );
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Totals, category breakdown and time series for a period',
  })
  async summary(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query() query: SummaryQueryDto,
  ) {
    return this.analytics.summary(user.userId, user.timezone, query);
  }
}
