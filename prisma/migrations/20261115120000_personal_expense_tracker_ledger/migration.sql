-- Personal Expense Tracker ledger.
--
-- Replaces the prototype "ExpenseRecord" table (Float amounts, free-text
-- category, EXPENSE/INCOME only, no accounts) with Account / Category /
-- Transaction. ExpenseRecord was never consumed by the mobile app, but this
-- migration refuses to run if it holds data rather than silently dropping it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ExpenseRecord" LIMIT 1) THEN
    RAISE EXCEPTION 'ExpenseRecord contains rows. Export or migrate them before applying 20261115120000_personal_expense_tracker_ledger.';
  END IF;
END $$;

-- Retire the prototype table and its two-value enum.
DROP TABLE "ExpenseRecord";
DROP TYPE "TransactionType";

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'REFUND', 'ADJUSTMENT');
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK', 'WALLET', 'CREDIT_CARD', 'OTHER');
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER', 'WALLET', 'OTHER');
CREATE TYPE "TransactionSource" AS ENUM ('MANUAL', 'BANK_STATEMENT', 'BANK_SYNC', 'IMPORT', 'SYSTEM');
CREATE TYPE "AdjustmentDirection" AS ENUM ('INCREASE', 'DECREASE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "openingBalanceMinor" BIGINT NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Account_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "Account_name_check" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "Account_default_not_archived_check" CHECK (NOT ("isDefault" AND "isArchived"))
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "systemKey" VARCHAR(64),
    "name" VARCHAR(40) NOT NULL,
    "type" "CategoryType" NOT NULL,
    "icon" VARCHAR(40),
    "color" VARCHAR(9),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id"),
    -- A category is either system-owned (no user, has a stable key) or user-owned.
    CONSTRAINT "Category_owner_check" CHECK (
      ("isSystem" AND "userId" IS NULL AND "systemKey" IS NOT NULL)
      OR (NOT "isSystem" AND "userId" IS NOT NULL AND "systemKey" IS NULL)
    ),
    CONSTRAINT "Category_name_check" CHECK (length(btrim("name")) > 0)
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "categoryId" UUID,
    "sourceAccountId" UUID,
    "destinationAccountId" UUID,
    "adjustmentDirection" "AdjustmentDirection",
    "paymentMethod" "PaymentMethod",
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "payee" VARCHAR(120),
    "note" VARCHAR(500),
    "relatedTransactionId" UUID,
    "source" "TransactionSource" NOT NULL DEFAULT 'MANUAL',
    "clientTransactionId" VARCHAR(64) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Transaction_amount_positive_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "Transaction_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "Transaction_distinct_accounts_check" CHECK (
      "sourceAccountId" IS NULL OR "destinationAccountId" IS NULL
      OR "sourceAccountId" <> "destinationAccountId"
    ),
    -- Defence in depth for the per-type rules the service layer validates.
    CONSTRAINT "Transaction_type_shape_check" CHECK (
      CASE "type"
        WHEN 'EXPENSE' THEN "sourceAccountId" IS NOT NULL AND "destinationAccountId" IS NULL
          AND "categoryId" IS NOT NULL AND "adjustmentDirection" IS NULL AND "relatedTransactionId" IS NULL
        WHEN 'INCOME' THEN "destinationAccountId" IS NOT NULL AND "sourceAccountId" IS NULL
          AND "categoryId" IS NOT NULL AND "adjustmentDirection" IS NULL AND "relatedTransactionId" IS NULL
        WHEN 'TRANSFER' THEN "sourceAccountId" IS NOT NULL AND "destinationAccountId" IS NOT NULL
          AND "categoryId" IS NULL AND "adjustmentDirection" IS NULL AND "relatedTransactionId" IS NULL
        WHEN 'REFUND' THEN "destinationAccountId" IS NOT NULL AND "sourceAccountId" IS NULL
          AND "adjustmentDirection" IS NULL
        WHEN 'ADJUSTMENT' THEN "categoryId" IS NULL AND "relatedTransactionId" IS NULL
          AND (
            ("adjustmentDirection" = 'INCREASE' AND "destinationAccountId" IS NOT NULL AND "sourceAccountId" IS NULL)
            OR ("adjustmentDirection" = 'DECREASE' AND "sourceAccountId" IS NOT NULL AND "destinationAccountId" IS NULL)
          )
          AND "note" IS NOT NULL AND length(btrim("note")) > 0
        ELSE false
      END
    )
);

-- Indexes (see schema.prisma for the query each one serves)
CREATE INDEX "Account_userId_isArchived_idx" ON "Account"("userId", "isArchived");
CREATE UNIQUE INDEX "Category_systemKey_key" ON "Category"("systemKey");
CREATE INDEX "Category_userId_type_idx" ON "Category"("userId", "type");
CREATE INDEX "Transaction_userId_occurredAt_id_idx" ON "Transaction"("userId", "occurredAt" DESC, "id" DESC);
CREATE INDEX "Transaction_userId_type_occurredAt_idx" ON "Transaction"("userId", "type", "occurredAt");
CREATE INDEX "Transaction_userId_categoryId_occurredAt_idx" ON "Transaction"("userId", "categoryId", "occurredAt");
CREATE INDEX "Transaction_userId_sourceAccountId_occurredAt_idx" ON "Transaction"("userId", "sourceAccountId", "occurredAt");
CREATE INDEX "Transaction_userId_destinationAccountId_occurredAt_idx" ON "Transaction"("userId", "destinationAccountId", "occurredAt");
CREATE INDEX "Transaction_relatedTransactionId_idx" ON "Transaction"("relatedTransactionId");
CREATE UNIQUE INDEX "Transaction_userId_clientTransactionId_key" ON "Transaction"("userId", "clientTransactionId");

-- Partial / expression unique indexes Prisma cannot model (listed in schema.prisma).
CREATE UNIQUE INDEX "Account_userId_active_name_key"
  ON "Account"("userId", lower("name")) WHERE NOT "isArchived";
CREATE UNIQUE INDEX "Account_userId_default_key"
  ON "Account"("userId") WHERE "isDefault";
CREATE UNIQUE INDEX "Category_userId_type_active_name_key"
  ON "Category"("userId", "type", lower("name")) WHERE "userId" IS NOT NULL AND NOT "isArchived";

-- Foreign keys. NO ACTION (end-of-statement check) lets a User delete cascade
-- through accounts, categories and transactions without ordering problems.
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_relatedTransactionId_fkey" FOREIGN KEY ("relatedTransactionId") REFERENCES "Transaction"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- System categories (shared by all users, read-only). Icon names match the
-- mobile app's lucide icon set; colours are suggestions the client may ignore.
INSERT INTO "Category" ("id", "systemKey", "name", "type", "icon", "color", "isSystem", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'expense.food_dining',    'Food & Dining',     'EXPENSE', 'Utensils',      '#2563EB', true, 10,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.groceries',      'Groceries',         'EXPENSE', 'ShoppingCart',  '#16A34A', true, 20,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.transport',      'Transport',         'EXPENSE', 'Car',           '#F59E0B', true, 30,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.fuel',           'Fuel',              'EXPENSE', 'Fuel',          '#EA580C', true, 40,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.rent',           'Rent',              'EXPENSE', 'Home',          '#7C3AED', true, 50,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.bills_utilities','Bills & Utilities', 'EXPENSE', 'Zap',           '#0EA5E9', true, 60,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.shopping',       'Shopping',          'EXPENSE', 'ShoppingBag',   '#1E3A8A', true, 70,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.health',         'Health',            'EXPENSE', 'HeartPulse',    '#10B981', true, 80,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.education',      'Education',         'EXPENSE', 'GraduationCap', '#6366F1', true, 90,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.entertainment',  'Entertainment',     'EXPENSE', 'Film',          '#8B5CF6', true, 100, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.emi_loans',      'EMI / Loans',       'EXPENSE', 'Landmark',      '#DC2626', true, 110, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.investments',    'Investments',       'EXPENSE', 'TrendingUp',    '#0D9488', true, 120, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.gifts',          'Gifts',             'EXPENSE', 'Gift',          '#DB2777', true, 130, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'expense.other',          'Other',             'EXPENSE', 'CircleEllipsis','#64748B', true, 1000,CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'income.salary',          'Salary',            'INCOME',  'Briefcase',     '#16A34A', true, 10,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'income.business',        'Business',          'INCOME',  'Store',         '#2563EB', true, 20,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'income.freelance',       'Freelance',         'INCOME',  'Laptop',        '#7C3AED', true, 30,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'income.interest',        'Interest',          'INCOME',  'Percent',       '#0D9488', true, 40,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'income.gift',            'Gift',              'INCOME',  'Gift',          '#DB2777', true, 50,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'income.other',           'Other',             'INCOME',  'CircleEllipsis','#64748B', true, 1000,CURRENT_TIMESTAMP)
ON CONFLICT ("systemKey") DO NOTHING;
