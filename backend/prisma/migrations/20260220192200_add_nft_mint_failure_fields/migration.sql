-- BUG-08: Graceful NFT mint failure
-- Adds three columns to the Lead table so mint failures are persisted and
-- queryable instead of being swallowed in a console.warn call.
--
-- Re-trigger query (cron / admin script):
--   SELECT id FROM "Lead"
--   WHERE "nftMintFailed" = true
--     AND "nftMintRetryAt" <= now()
--     AND "nftTokenId" IS NULL;

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "nftMintFailed"  BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nftMintError"   TEXT,
  ADD COLUMN IF NOT EXISTS "nftMintRetryAt" TIMESTAMP(3);
