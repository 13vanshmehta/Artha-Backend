import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ResourceAuthorizationService } from './authorization.service';
import { FinanceController } from './finance.controller';

@Module({
  imports: [AuthModule],
  controllers: [FinanceController],
  providers: [ResourceAuthorizationService],
  exports: [ResourceAuthorizationService],
})
export class FinanceModule {}
