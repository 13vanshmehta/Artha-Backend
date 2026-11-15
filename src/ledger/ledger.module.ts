import { Module } from '@nestjs/common';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { TransactionsController } from './transactions/transactions.controller';
import { TransactionsService } from './transactions/transactions.service';

/**
 * Personal Expense Tracker: accounts, categories, the five-type transaction
 * ledger, and home/summary analytics. Auth (JwtAuthGuard) comes from the
 * global AuthModule; the API contract lives in docs/API_CONTRACT.md.
 */
@Module({
  controllers: [
    AccountsController,
    CategoriesController,
    TransactionsController,
    AnalyticsController,
  ],
  providers: [
    AccountsService,
    CategoriesService,
    TransactionsService,
    AnalyticsService,
  ],
})
export class LedgerModule {}
