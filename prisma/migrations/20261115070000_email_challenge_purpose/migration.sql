-- BE-08: sign-up codes and email-change codes shared one table with no purpose,
-- so an email-change code could be redeemed at the public sign-up confirm
-- endpoint for a full session. Every lookup now filters on "purpose".

CREATE TYPE "EmailChallengePurpose" AS ENUM ('SIGNUP_VERIFICATION', 'EMAIL_CHANGE');

ALTER TABLE "EmailVerificationChallenge"
  ADD COLUMN "purpose" "EmailChallengePurpose" NOT NULL DEFAULT 'SIGNUP_VERIFICATION';

-- Backfill: a challenge addressed to something other than the user's current
-- email, on an already-verified account, was an email-change request.
UPDATE "EmailVerificationChallenge" AS c
SET "purpose" = 'EMAIL_CHANGE'
FROM "User" AS u
WHERE c."userId" = u."id"
  AND u."emailVerifiedAt" IS NOT NULL
  AND lower(trim(c."email")) <> u."normalizedEmail";

CREATE INDEX "EmailVerificationChallenge_userId_purpose_consumedAt_idx"
  ON "EmailVerificationChallenge"("userId", "purpose", "consumedAt");
