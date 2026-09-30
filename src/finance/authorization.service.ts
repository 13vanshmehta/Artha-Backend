import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExpenseGroup,
  ExpenseGroupMember,
  ExpenseRecord,
  GroupRole,
} from '@prisma/client';
import { SecurityLoggerService } from '../common/logging/security-logger.service';
import { PrismaService } from '../prisma/prisma.service';

const ROLE_WEIGHT: Record<GroupRole, number> = {
  [GroupRole.MEMBER]: 1,
  [GroupRole.ADMIN]: 2,
  [GroupRole.OWNER]: 3,
};

@Injectable()
export class ResourceAuthorizationService {
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

  async assertExpenseReadAccess(
    userId: string,
    expenseId: string,
  ): Promise<ExpenseRecord> {
    const expense = await this.prisma.expenseRecord.findUnique({
      where: { id: expenseId },
    });

    if (!expense) {
      throw new NotFoundException({
        errorCode: 'EXPENSE_NOT_FOUND',
        message: 'Expense record not found.',
      });
    }

    if (expense.ownerId === userId) {
      return expense;
    }

    if (expense.groupId) {
      const membership = await this.prisma.expenseGroupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: expense.groupId,
            userId,
          },
        },
      });
      if (membership) {
        return expense;
      }
    }

    await this.securityLogger.record({
      eventType: 'CROSS_USER_EXPENSE_READ_BLOCKED',
      userId,
      metadata: { expenseId, ownerId: expense.ownerId },
    });

    throw new ForbiddenException({
      errorCode: 'CROSS_USER_ACCESS_DENIED',
      message: 'You are not authorized to view this expense record.',
    });
  }

  async assertExpenseWriteAccess(
    userId: string,
    expenseId: string,
  ): Promise<ExpenseRecord> {
    const expense = await this.prisma.expenseRecord.findUnique({
      where: { id: expenseId },
    });

    if (!expense) {
      throw new NotFoundException({
        errorCode: 'EXPENSE_NOT_FOUND',
        message: 'Expense record not found.',
      });
    }

    if (expense.ownerId === userId) {
      return expense;
    }

    if (expense.groupId) {
      const membership = await this.prisma.expenseGroupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: expense.groupId,
            userId,
          },
        },
      });
      if (
        membership &&
        (membership.role === GroupRole.OWNER ||
          membership.role === GroupRole.ADMIN)
      ) {
        return expense;
      }
    }

    await this.securityLogger.record({
      eventType: 'CROSS_USER_EXPENSE_MUTATION_BLOCKED',
      userId,
      metadata: { expenseId, ownerId: expense.ownerId },
    });

    throw new ForbiddenException({
      errorCode: 'CROSS_USER_ACCESS_DENIED',
      message: 'You are not authorized to modify or delete this expense record.',
    });
  }
}
