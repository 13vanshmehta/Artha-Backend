import { Injectable } from '@nestjs/common';
import { AdjustmentDirection, TransactionType } from '@prisma/client';
import {
  divideRounded,
  minorToString,
  percentageOf,
} from '../../common/money/money';
import {
  addDays,
  addMonths,
  compareLocalDates,
  daysBetween,
  formatLocalDate,
  LocalDate,
  startOfIsoWeek,
  startOfMonth,
} from '../../common/time/local-calendar';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountsService, AccountView } from '../accounts/accounts.service';
import { ResolvedRange, resolveClosedRange } from '../shared/date-range';
import { LedgerErrors } from '../shared/ledger-errors';
import {
  serializeTransaction,
  TRANSACTION_INCLUDE,
  TransactionView,
} from '../transactions/transaction.serializer';
import { GroupBy, SummaryQueryDto } from './analytics.dto';

const MAX_SUMMARY_DAYS = 1100;
const MAX_BUCKETS: Record<GroupBy, number> = { DAY: 366, WEEK: 160, MONTH: 40 };
const HOME_TOP_CATEGORIES = 5;
const HOME_RECENT = 5;

/** Raw sums for one window. Transfers never enter income/expense/flow. */
interface FlowTotals {
  income: bigint;
  expense: bigint;
  refunds: bigint;
  transfers: bigint;
  adjustmentIncrease: bigint;
  adjustmentDecrease: bigint;
  count: number;
}

export interface TotalsView {
  incomeMinor: string;
  expenseMinor: string;
  refundsMinor: string;
  /** expense − refunds */
  netSpendingMinor: string;
  /** income + refunds − expense (transfers and adjustments excluded) */
  netFlowMinor: string;
  /** Money moved between own accounts. Informational; not income or spending. */
  transferVolumeMinor: string;
  adjustments: {
    increaseMinor: string;
    decreaseMinor: string;
    netMinor: string;
  };
  transactionCount: number;
}

export interface CategoryBreakdownView {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  isArchived: boolean;
  expenseMinor: string;
  refundsMinor: string;
  netSpendingMinor: string;
  /** Share of the sum of positive per-category net spending, 0–100, 2 dp. */
  sharePercent: number;
}

interface CategoryBreakdown {
  items: CategoryBreakdownView[];
  uncategorizedRefunds: bigint;
}

export interface SeriesPoint {
  /** Local date (YYYY-MM-DD) the bucket starts on. */
  bucket: string;
  incomeMinor: string;
  expenseMinor: string;
  refundsMinor: string;
  netSpendingMinor: string;
}

function emptyTotals(): FlowTotals {
  return {
    income: 0n,
    expense: 0n,
    refunds: 0n,
    transfers: 0n,
    adjustmentIncrease: 0n,
    adjustmentDecrease: 0n,
    count: 0,
  };
}

function totalsView(t: FlowTotals): TotalsView {
  return {
    incomeMinor: minorToString(t.income),
    expenseMinor: minorToString(t.expense),
    refundsMinor: minorToString(t.refunds),
    netSpendingMinor: minorToString(t.expense - t.refunds),
    netFlowMinor: minorToString(t.income + t.refunds - t.expense),
    transferVolumeMinor: minorToString(t.transfers),
    adjustments: {
      increaseMinor: minorToString(t.adjustmentIncrease),
      decreaseMinor: minorToString(t.adjustmentDecrease),
      netMinor: minorToString(t.adjustmentIncrease - t.adjustmentDecrease),
    },
    transactionCount: t.count,
  };
}

function defaultGroupBy(days: number): GroupBy {
  if (days <= 31) return 'DAY';
  if (days <= 120) return 'WEEK';
  return 'MONTH';
}

/** Local dates on which each bucket starts, matching Postgres date_trunc (weeks start Monday). */
function bucketStarts(
  from: LocalDate,
  to: LocalDate,
  groupBy: GroupBy,
): string[] {
  const starts: string[] = [];
  let cursor =
    groupBy === 'DAY'
      ? from
      : groupBy === 'WEEK'
        ? startOfIsoWeek(from)
        : startOfMonth(from);
  while (compareLocalDates(cursor, to) <= 0) {
    starts.push(formatLocalDate(cursor));
    cursor =
      groupBy === 'DAY'
        ? addDays(cursor, 1)
        : groupBy === 'WEEK'
          ? addDays(cursor, 7)
          : addMonths(cursor, 1);
  }
  return starts;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {}

  async summary(userId: string, timezone: string, q: SummaryQueryDto) {
    const currency = q.currency ?? 'INR';
    const range = resolveClosedRange(q, timezone, {
      defaultPeriod: 'THIS_MONTH',
      maxDays: MAX_SUMMARY_DAYS,
    });
    const spanDays = daysBetween(range.from, range.to) + 1;
    const groupBy = q.groupBy ?? defaultGroupBy(spanDays);
    const buckets = bucketStarts(range.from, range.to, groupBy);
    if (buckets.length > MAX_BUCKETS[groupBy]) {
      throw LedgerErrors.invalidDateRange(
        `Too many ${groupBy} buckets (${buckets.length}); use a coarser groupBy or a shorter range.`,
      );
    }

    const [totals, categories, series] = await Promise.all([
      this.totals(userId, currency, range),
      this.byCategory(userId, currency, range),
      this.series(userId, currency, range, groupBy, buckets),
    ]);

    // Average over days that have actually started: a month in progress is
    // averaged over elapsed days, not all 30.
    const lastCounted =
      compareLocalDates(range.to, range.today) < 0 ? range.to : range.today;
    const elapsedDays = Math.max(0, daysBetween(range.from, lastCounted) + 1);
    const netSpending = totals.expense - totals.refunds;

    return {
      timezone,
      currency,
      range: this.rangeView(range),
      groupBy,
      totals: totalsView(totals),
      elapsedDays,
      averageDailySpendMinor: minorToString(
        elapsedDays > 0 ? divideRounded(netSpending, BigInt(elapsedDays)) : 0n,
      ),
      byCategory: categories.items,
      uncategorizedRefundsMinor: minorToString(categories.uncategorizedRefunds),
      series,
    };
  }

  async home(
    userId: string,
    timezone: string,
    currency = 'INR',
    now = new Date(),
  ) {
    await this.accounts.ensureDefaultAccount(userId);
    const month = resolveClosedRange({ period: 'THIS_MONTH' }, timezone, {
      defaultPeriod: 'THIS_MONTH',
      maxDays: 31,
      now,
    });
    const today = resolveClosedRange({ period: 'TODAY' }, timezone, {
      defaultPeriod: 'TODAY',
      maxDays: 1,
      now,
    });

    const [monthTotals, todayTotals, monthCategories, recentRows, accounts] =
      await Promise.all([
        this.totals(userId, currency, month),
        this.totals(userId, currency, today),
        this.byCategory(userId, currency, month),
        this.prisma.transaction.findMany({
          where: { userId, deletedAt: null },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: HOME_RECENT,
          include: TRANSACTION_INCLUDE,
        }),
        this.accounts.list(userId, false),
      ]);

    const inCurrency = accounts.filter((a) => a.currency === currency);
    const totalBalance = inCurrency.reduce(
      (sum, a) => sum + BigInt(a.currentBalanceMinor),
      0n,
    );
    const m = totalsView(monthTotals);

    return {
      timezone,
      currency,
      today: formatLocalDate(today.from),
      month: {
        ...this.rangeView(month),
        incomeMinor: m.incomeMinor,
        expenseMinor: m.expenseMinor,
        refundsMinor: m.refundsMinor,
        netSpendingMinor: m.netSpendingMinor,
        netFlowMinor: m.netFlowMinor,
      },
      todaySpending: {
        expenseMinor: minorToString(todayTotals.expense),
        refundsMinor: minorToString(todayTotals.refunds),
        netSpendingMinor: minorToString(
          todayTotals.expense - todayTotals.refunds,
        ),
      },
      topExpenseCategories: monthCategories.items.slice(0, HOME_TOP_CATEGORIES),
      recentTransactions: recentRows.map(
        serializeTransaction,
      ) as TransactionView[],
      accounts: accounts as AccountView[],
      totalBalanceMinor: minorToString(totalBalance),
    };
  }

  private rangeView(range: ResolvedRange) {
    return {
      from: formatLocalDate(range.from),
      to: formatLocalDate(range.to),
      startUtc: range.startUtc.toISOString(),
      endUtc: range.endUtc.toISOString(),
    };
  }

  private baseWhere(userId: string, currency: string, range: ResolvedRange) {
    return {
      userId,
      currency,
      deletedAt: null,
      occurredAt: { gte: range.startUtc, lt: range.endUtc },
    };
  }

  private async totals(
    userId: string,
    currency: string,
    range: ResolvedRange,
  ): Promise<FlowTotals> {
    const rows = await this.prisma.transaction.groupBy({
      by: ['type', 'adjustmentDirection'],
      where: this.baseWhere(userId, currency, range),
      _sum: { amountMinor: true },
      _count: { _all: true },
    });
    const t = emptyTotals();
    for (const row of rows) {
      const sum = row._sum.amountMinor ?? 0n;
      t.count += row._count._all;
      switch (row.type) {
        case TransactionType.INCOME:
          t.income += sum;
          break;
        case TransactionType.EXPENSE:
          t.expense += sum;
          break;
        case TransactionType.REFUND:
          t.refunds += sum;
          break;
        case TransactionType.TRANSFER:
          t.transfers += sum;
          break;
        case TransactionType.ADJUSTMENT:
          if (row.adjustmentDirection === AdjustmentDirection.INCREASE)
            t.adjustmentIncrease += sum;
          else t.adjustmentDecrease += sum;
          break;
      }
    }
    return t;
  }

  /**
   * Net spending per expense category = expenses − refunds attributed to it.
   * Refunds carry their expense's category (inherited at write time) unless the
   * user picked none, in which case they are reported as uncategorised.
   */
  private async byCategory(
    userId: string,
    currency: string,
    range: ResolvedRange,
  ): Promise<CategoryBreakdown> {
    const rows = await this.prisma.transaction.groupBy({
      by: ['categoryId', 'type'],
      where: {
        ...this.baseWhere(userId, currency, range),
        type: { in: [TransactionType.EXPENSE, TransactionType.REFUND] },
      },
      _sum: { amountMinor: true },
    });

    const perCategory = new Map<string, { expense: bigint; refunds: bigint }>();
    let uncategorizedRefunds = 0n;
    for (const row of rows) {
      const sum = row._sum.amountMinor ?? 0n;
      if (!row.categoryId) {
        if (row.type === TransactionType.REFUND) uncategorizedRefunds += sum;
        continue;
      }
      const entry = perCategory.get(row.categoryId) ?? {
        expense: 0n,
        refunds: 0n,
      };
      if (row.type === TransactionType.EXPENSE) entry.expense += sum;
      else entry.refunds += sum;
      perCategory.set(row.categoryId, entry);
    }

    const categories = await this.prisma.category.findMany({
      where: { id: { in: [...perCategory.keys()] } },
    });
    const positiveTotal = [...perCategory.values()].reduce(
      (sum, e) => (e.expense > e.refunds ? sum + (e.expense - e.refunds) : sum),
      0n,
    );

    const items = categories
      .map((c) => {
        const e = perCategory.get(c.id) ?? { expense: 0n, refunds: 0n };
        const net = e.expense - e.refunds;
        return { c, e, net };
      })
      .sort((a, b) =>
        a.net === b.net
          ? a.c.name.localeCompare(b.c.name)
          : a.net > b.net
            ? -1
            : 1,
      )
      .map(({ c, e, net }) => ({
        categoryId: c.id,
        name: c.name,
        icon: c.icon,
        color: c.color,
        isSystem: c.isSystem,
        isArchived: c.isArchived,
        expenseMinor: minorToString(e.expense),
        refundsMinor: minorToString(e.refunds),
        netSpendingMinor: minorToString(net),
        sharePercent: percentageOf(net, positiveTotal),
      }));

    return { items, uncategorizedRefunds };
  }

  /**
   * Buckets by the user's local calendar using Postgres `AT TIME ZONE`. Every
   * value is a bound parameter; the timezone was validated when it was saved.
   */
  private async series(
    userId: string,
    currency: string,
    range: ResolvedRange,
    groupBy: GroupBy,
    buckets: string[],
  ): Promise<SeriesPoint[]> {
    const unit = groupBy.toLowerCase();
    const rows = await this.prisma.$queryRaw<
      Array<{ bucket: string; type: string; total: string }>
    >`
      SELECT to_char(date_trunc(${unit}::text, t."occurredAt" AT TIME ZONE ${range.timezone}::text), 'YYYY-MM-DD') AS bucket,
             t."type"::text AS type,
             SUM(t."amountMinor")::text AS total
        FROM "Transaction" t
       WHERE t."userId" = ${userId}::uuid
         AND t."deletedAt" IS NULL
         AND t."currency" = ${currency}
         AND t."occurredAt" >= ${range.startUtc.toISOString()}::timestamptz
         AND t."occurredAt" < ${range.endUtc.toISOString()}::timestamptz
         AND t."type" IN ('INCOME', 'EXPENSE', 'REFUND')
       GROUP BY 1, 2`;

    const points = new Map(
      buckets.map((b) => [b, { income: 0n, expense: 0n, refunds: 0n }]),
    );
    for (const row of rows) {
      const point = points.get(row.bucket);
      if (!point) continue;
      const total = BigInt(row.total);
      if (row.type === 'INCOME') point.income += total;
      else if (row.type === 'EXPENSE') point.expense += total;
      else point.refunds += total;
    }
    return buckets.map((bucket) => {
      const p = points.get(bucket)!;
      return {
        bucket,
        incomeMinor: minorToString(p.income),
        expenseMinor: minorToString(p.expense),
        refundsMinor: minorToString(p.refunds),
        netSpendingMinor: minorToString(p.expense - p.refunds),
      };
    });
  }
}
