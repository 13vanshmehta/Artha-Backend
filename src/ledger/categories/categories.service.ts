import { Injectable } from '@nestjs/common';
import { Category, CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerErrors } from '../shared/ledger-errors';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

export interface CategoryView {
  id: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  systemKey: string | null;
  isArchived: boolean;
  sortOrder: number;
}

type Db = PrismaService | Prisma.TransactionClient;

/** Categories a user may see: every system category plus their own. */
export function visibleTo(userId: string): Prisma.CategoryWhereInput {
  return { OR: [{ isSystem: true }, { userId }] };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    filter: { type?: CategoryType; includeArchived: boolean },
  ): Promise<CategoryView[]> {
    const categories = await this.prisma.category.findMany({
      where: {
        AND: [
          visibleTo(userId),
          filter.type ? { type: filter.type } : {},
          filter.includeArchived ? {} : { isArchived: false },
        ],
      },
      // System categories first in their curated order, then the user's own.
      orderBy: [
        { type: 'asc' },
        { isSystem: 'desc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
        { id: 'asc' },
      ],
    });
    return categories.map((c) => CategoriesService.serialize(c));
  }

  async create(userId: string, dto: CreateCategoryDto): Promise<CategoryView> {
    await this.assertNameFree(userId, dto.type, dto.name);
    try {
      const created = await this.prisma.category.create({
        data: {
          userId,
          name: dto.name,
          type: dto.type,
          icon: dto.icon ?? null,
          color: dto.color ?? null,
          sortOrder: dto.sortOrder ?? 500,
          isSystem: false,
        },
      });
      return CategoriesService.serialize(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw LedgerErrors.duplicateName('category');
      }
      throw err;
    }
  }

  async update(
    userId: string,
    categoryId: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryView> {
    const current = await this.findEditable(userId, categoryId);
    const nextName = dto.name ?? current.name;
    const nextArchived = dto.isArchived ?? current.isArchived;
    const nameOrStateChanged =
      nextName.toLowerCase() !== current.name.toLowerCase() ||
      (current.isArchived && !nextArchived);
    if (!nextArchived && nameOrStateChanged) {
      await this.assertNameFree(userId, current.type, nextName, current.id);
    }
    try {
      const updated = await this.prisma.category.update({
        where: { id: current.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isArchived !== undefined
            ? { isArchived: dto.isArchived }
            : {}),
        },
      });
      return CategoriesService.serialize(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw LedgerErrors.duplicateName('category');
      }
      throw err;
    }
  }

  /** Archive only: transactions keep their category for history and analytics. */
  async archive(userId: string, categoryId: string): Promise<CategoryView> {
    const current = await this.findEditable(userId, categoryId);
    const updated = current.isArchived
      ? current
      : await this.prisma.category.update({
          where: { id: current.id },
          data: { isArchived: true },
        });
    return CategoriesService.serialize(updated);
  }

  /** A category the user may reference: system or their own. */
  async findVisible(
    userId: string,
    categoryId: string,
    db: Db = this.prisma,
  ): Promise<Category> {
    const category = await db.category.findFirst({
      where: { AND: [{ id: categoryId }, visibleTo(userId)] },
    });
    if (!category) throw LedgerErrors.categoryNotFound();
    return category;
  }

  private async findEditable(
    userId: string,
    categoryId: string,
  ): Promise<Category> {
    const category = await this.findVisible(userId, categoryId);
    if (category.isSystem) throw LedgerErrors.systemCategoryReadOnly();
    return category;
  }

  /**
   * Custom names are unique per user and type (case-insensitive) among active
   * categories, and may not shadow a system category of the same type.
   */
  private async assertNameFree(
    userId: string,
    type: CategoryType,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.category.findFirst({
      where: {
        AND: [
          visibleTo(userId),
          {
            type,
            isArchived: false,
            name: { equals: name, mode: 'insensitive' },
          },
          excludeId ? { id: { not: excludeId } } : {},
        ],
      },
      select: { id: true },
    });
    if (clash) throw LedgerErrors.duplicateName('category');
  }

  static serialize(c: Category): CategoryView {
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      icon: c.icon,
      color: c.color,
      isSystem: c.isSystem,
      systemKey: c.systemKey,
      isArchived: c.isArchived,
      sortOrder: c.sortOrder,
    };
  }
}
