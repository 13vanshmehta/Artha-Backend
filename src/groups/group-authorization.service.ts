import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExpenseGroup, ExpenseGroupMember, GroupRole } from '@prisma/client';
import { SecurityLoggerService } from '../common/logging/security-logger.service';
import { PrismaService } from '../prisma/prisma.service';

const ROLE_WEIGHT: Record<GroupRole, number> = {
  [GroupRole.MEMBER]: 1,
  [GroupRole.ADMIN]: 2,
  [GroupRole.OWNER]: 3,
};

@Injectable()
export class GroupAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityLogger: SecurityLoggerService,
  ) {}

  async assertGroupMembership(
    userId: string,
    groupId: string,
    minimumRole: GroupRole = GroupRole.MEMBER,
  ): Promise<ExpenseGroup & { membership: ExpenseGroupMember }> {
    const group = await this.prisma.expenseGroup.findUnique({
      where: { id: groupId },
      include: {
        members: {
          where: { userId },
        },
      },
    });

    if (!group) {
      throw new NotFoundException({
        errorCode: 'GROUP_NOT_FOUND',
        message: 'Expense group not found.',
      });
    }

    const membership = group.members[0];
    if (!membership) {
      await this.securityLogger.record({
        eventType: 'UNAUTHORIZED_GROUP_ACCESS_ATTEMPT',
        userId,
        metadata: { groupId, requiredRole: minimumRole },
      });
      throw new ForbiddenException({
        errorCode: 'NOT_GROUP_MEMBER',
        message: 'You do not have access to this expense group.',
      });
    }

    if (ROLE_WEIGHT[membership.role] < ROLE_WEIGHT[minimumRole]) {
      await this.securityLogger.record({
        eventType: 'INSUFFICIENT_GROUP_ROLE',
        userId,
        metadata: {
          groupId,
          actualRole: membership.role,
          requiredRole: minimumRole,
        },
      });
      throw new ForbiddenException({
        errorCode: 'INSUFFICIENT_GROUP_ROLE',
        message: `This action requires ${minimumRole} privileges in the group.`,
      });
    }

    return {
      ...group,
      membership,
    };
  }
}
