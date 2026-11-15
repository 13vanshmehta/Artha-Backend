import { Module } from '@nestjs/common';
import { GroupAuthorizationService } from './group-authorization.service';
import { GroupsController } from './groups.controller';

/**
 * Collaborative groups and membership. Shared group expenses are not part of
 * Phase 1; personal money lives in the LedgerModule.
 */
@Module({
  controllers: [GroupsController],
  providers: [GroupAuthorizationService],
  exports: [GroupAuthorizationService],
})
export class GroupsModule {}
