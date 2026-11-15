-- BE-10: password reset moves from a 43-character opaque token (copied by hand)
-- to a 6-digit code like every other verification flow. A 6-digit code is only
-- safe with a per-challenge attempt limit, so the challenge now counts attempts.
-- Outstanding opaque-token challenges simply stop verifying; users request a new code.
ALTER TABLE "PasswordResetChallenge"
  ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 5;
