-- User.phoneNumber was added to schema.prisma (commit 2542410) without a migration.
-- Databases built from migrations (CI, fresh environments, production deploys)
-- lacked the column, so every query selecting a User failed (P2022 -> HTTP 503).
-- IF NOT EXISTS keeps this safe on databases where the column was already
-- created out-of-band (e.g. via `prisma db push`).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT;
