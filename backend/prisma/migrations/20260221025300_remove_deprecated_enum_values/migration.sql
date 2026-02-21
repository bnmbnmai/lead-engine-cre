-- ============================================================
-- P2-12: Remove deprecated LeadStatus / AuctionPhase enum values
-- ============================================================
--
-- Deprecated values and their canonical replacements:
--
--  LeadStatus:
--    PENDING_PING  → PENDING_AUCTION  (pre-auction staging, equivalent semantic)
--    IN_PING_POST  → PENDING_AUCTION  (ping-post is no longer a distinct phase)
--    REVEAL_PHASE  → IN_AUCTION       (reveal was part of the auction, now collapsed)
--
--  AuctionPhase:
--    PING_POST     → BIDDING          (no separate ping-post phase)
--    REVEAL        → RESOLVED         (reveal is transitional to resolved)
--
-- Step 1: Migrate existing Lead rows with deprecated status values
UPDATE "Lead"
SET "status" = 'PENDING_AUCTION'
WHERE "status" IN ('PENDING_PING', 'IN_PING_POST');

UPDATE "Lead"
SET "status" = 'IN_AUCTION'
WHERE "status" = 'REVEAL_PHASE';

-- Step 2: Migrate existing AuctionRoom rows with deprecated phase values
UPDATE "AuctionRoom"
SET "phase" = 'BIDDING'
WHERE "phase" = 'PING_POST';

UPDATE "AuctionRoom"
SET "phase" = 'RESOLVED'
WHERE "phase" = 'REVEAL';

-- Step 3: Remove deprecated values from PostgreSQL enum types
-- (Must be done AFTER migrating existing rows, otherwise constraint violations)

ALTER TYPE "LeadStatus" RENAME TO "LeadStatus_old";

CREATE TYPE "LeadStatus" AS ENUM (
  'PENDING_AUCTION',
  'IN_AUCTION',
  'SOLD',
  'UNSOLD',
  'EXPIRED',
  'CANCELLED',
  'DISPUTED'
);

ALTER TABLE "Lead"
  ALTER COLUMN "status" TYPE "LeadStatus"
  USING "status"::text::"LeadStatus";

DROP TYPE "LeadStatus_old";

ALTER TYPE "AuctionPhase" RENAME TO "AuctionPhase_old";

CREATE TYPE "AuctionPhase" AS ENUM (
  'BIDDING',
  'RESOLVED',
  'CANCELLED'
);

ALTER TABLE "AuctionRoom"
  ALTER COLUMN "phase" TYPE "AuctionPhase"
  USING "phase"::text::"AuctionPhase";

DROP TYPE "AuctionPhase_old";
