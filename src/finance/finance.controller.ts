import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GroupRole, TransactionType, UserStatus } from '@prisma/client';
import {
  type AuthenticatedPrincipal,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ResourceAuthorizationService } from './authorization.service';
import {
  AddGroupMemberDto,
  CreateExpenseDto,
  CreateGroupDto,
  UpdateExpenseDto,
} from './dto/finance.dto';

const MAX_EXPENSE_PAGE_SIZE = 200;
const MAX_GROUP_PAGE_SIZE = 100;

function roundCurrencyAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

@ApiTags('Protected Expenses & Collaborative Groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FinanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: ResourceAuthorizationService,
  ) {}

  @Post('expenses')
  @ApiOperation({
    summary:
      'Create an individual or group expense owned by the authenticated user',
  })
  async createExpense(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: CreateExpenseDto,
  ) {
    if (dto.groupId) {
      await this.authz.assertGroupMembership(
        user.userId,
        dto.groupId,
        GroupRole.MEMBER,
      );
    }

    const expense = await this.prisma.expenseRecord.create({
      data: {
        ownerId: user.userId,
        groupId: dto.groupId ?? null,
        merchant: dto.merchant.trim(),
        category: dto.category.trim(),
        amount: roundCurrencyAmount(dto.amount),
        type: dto.type ?? TransactionType.EXPENSE,
        paymentMethod: dto.paymentMethod.trim(),
        notes: dto.notes?.trim() ?? null,
      },
    });

    return { expense };
  }

  @Get('expenses')
  @ApiOperation({
    summary:
      'List personal expenses belonging strictly to the authenticated user',
  })
  async listMyExpenses(@CurrentUser() user: AuthenticatedPrincipal) {
    const expenses = await this.prisma.expenseRecord.findMany({
      where: { ownerId: user.userId },
      orderBy: { incurredAt: 'desc' },
      take: MAX_EXPENSE_PAGE_SIZE,
    });
    return { expenses };
  }

  @Get('expenses/:expenseId')
  @ApiOperation({
    summary:
      'Get a single expense record (enforces ownership or group membership)',
  })
  async getExpense(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
  ) {
    const expense = await this.authz.assertExpenseReadAccess(
      user.userId,
      expenseId,
    );
    return { expense };
  }

  @Patch('expenses/:expenseId')
  @ApiOperation({
    summary: 'Update an expense record (enforces ownership or group admin role)',
  })
  async updateExpense(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    await this.authz.assertExpenseWriteAccess(user.userId, expenseId);

    const updated = await this.prisma.expenseRecord.update({
      where: { id: expenseId },
      data: {
        ...(dto.merchant !== undefined ? { merchant: dto.merchant.trim() } : {}),
        ...(dto.category !== undefined ? { category: dto.category.trim() } : {}),
        ...(dto.amount !== undefined
          ? { amount: roundCurrencyAmount(dto.amount) }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
      },
    });

    return { expense: updated };
  }

  @Delete('expenses/:expenseId')
  @ApiOperation({
    summary: 'Delete an expense record (enforces ownership or group admin role)',
  })
  async deleteExpense(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
  ) {
    await this.authz.assertExpenseWriteAccess(user.userId, expenseId);
    await this.prisma.expenseRecord.delete({ where: { id: expenseId } });
    return { message: 'Expense deleted successfully.', deletedId: expenseId };
  }

  @Post('groups')
  @ApiOperation({
    summary: 'Create a collaborative expense group with caller as OWNER',
  })
  async createGroup(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Body() dto: CreateGroupDto,
  ) {
    const group = await this.prisma.expenseGroup.create({
      data: {
        name: dto.name.trim(),
        currency: (dto.currency?.trim() || 'INR').toUpperCase(),
        createdById: user.userId,
        members: {
          create: {
            userId: user.userId,
            role: GroupRole.OWNER,
          },
        },
      },
      include: { members: true },
    });

    return { group };
  }

  @Get('groups')
  @ApiOperation({
    summary:
      'List collaborative groups where the authenticated user is a member',
  })
  async listMyGroups(@CurrentUser() user: AuthenticatedPrincipal) {
    const groups = await this.prisma.expenseGroup.findMany({
      where: {
        members: {
          some: { userId: user.userId },
        },
      },
      include: {
        members: true,
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_GROUP_PAGE_SIZE,
    });
    return { groups };
  }

  @Get('groups/:groupId')
  @ApiOperation({
    summary: 'Get group details and expenses (requires group membership)',
  })
  async getGroup(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
  ) {
    await this.authz.assertGroupMembership(
      user.userId,
      groupId,
      GroupRole.MEMBER,
    );

    const group = await this.prisma.expenseGroup.findUnique({
      where: { id: groupId },
      include: {
        members: true,
        expenses: {
          orderBy: { incurredAt: 'desc' },
          take: MAX_EXPENSE_PAGE_SIZE,
        },
      },
    });

    return { group };
  }

  @Post('groups/:groupId/members')
  @ApiOperation({
    summary:
      'Add a member to a collaborative group (requires ADMIN or OWNER role)',
  })
  async addGroupMember(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Body() dto: AddGroupMemberDto,
  ) {
    const callerMembership = await this.authz.assertGroupMembership(
      user.userId,
      groupId,
      GroupRole.ADMIN,
    );

    const requestedRole = dto.role ?? GroupRole.MEMBER;
    if (
      requestedRole !== GroupRole.MEMBER &&
      callerMembership.membership.role !== GroupRole.OWNER
    ) {
      throw new ForbiddenException({
        errorCode: 'INSUFFICIENT_GROUP_ROLE',
        message: 'Only a group owner can assign ADMIN or OWNER roles.',
      });
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, status: true, deletedAt: true },
    });

    if (
      !targetUser ||
      targetUser.deletedAt !== null ||
      targetUser.status !== UserStatus.ACTIVE
    ) {
      throw new NotFoundException({
        errorCode: 'TARGET_USER_NOT_FOUND',
        message: 'The specified user could not be found or is not active.',
      });
    }

    const existingTargetMembership =
      await this.prisma.expenseGroupMember.findUnique({
        where: {
          groupId_userId: {
            groupId,
            userId: dto.userId,
          },
        },
      });

    if (
      existingTargetMembership?.role === GroupRole.OWNER &&
      requestedRole !== GroupRole.OWNER
    ) {
      throw new BadRequestException({
        errorCode: 'CANNOT_DEMOTE_GROUP_OWNER',
        message: 'The group owner cannot be demoted through member upsert.',
      });
    }

    const member = await this.prisma.expenseGroupMember.upsert({
      where: {
        groupId_userId: {
          groupId,
          userId: dto.userId,
        },
      },
      create: {
        groupId,
        userId: dto.userId,
        role: requestedRole,
      },
      update: {
        role: requestedRole,
      },
    });

    return { member };
  }
}

