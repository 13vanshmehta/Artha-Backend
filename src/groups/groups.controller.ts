import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GroupRole, UserStatus } from '@prisma/client';
import {
  type AuthenticatedPrincipal,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../auth/mail.service';
import { GroupAuthorizationService } from './group-authorization.service';
import { AddGroupMemberDto, CreateGroupDto } from './dto/groups.dto';

const MAX_GROUP_PAGE_SIZE = 100;

@ApiTags('Collaborative Groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class GroupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: GroupAuthorizationService,
    private readonly mailService: MailService,
  ) {}

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
    summary: 'Get group details and members (requires group membership)',
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
      select: {
        id: true,
        status: true,
        deletedAt: true,
        email: true,
        displayName: true,
      },
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

    // Notify new member via group invitation email
    if (!existingTargetMembership && targetUser.email) {
      this.prisma.expenseGroup
        .findUnique({ where: { id: groupId }, select: { name: true } })
        .then((group) => {
          if (group) {
            this.mailService
              .sendGroupInvitationEmail({
                to: targetUser.email,
                recipientName: targetUser.displayName || 'Artha Member',
                inviterName: user.displayName || 'An Artha member',
                groupName: group.name,
                role: requestedRole,
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
    }

    return { member };
  }
}

