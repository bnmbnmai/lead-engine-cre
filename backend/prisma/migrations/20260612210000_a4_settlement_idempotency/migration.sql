-- Phase A4: settlement idempotency
--
-- 1. New LeadStatus value CLOSING — CAS gate claimed by a closure worker.
-- 2. Unique (leadId, buyerId) on Transaction — one charge per lead+buyer.
-- 3. Unique (vaultId, type, reference) on VaultTransaction — a given
--    on-chain reference can only be applied to the ledger once.
--
-- The dedup DELETEs below remove duplicates produced by the historical
-- double-settlement race (the bug this migration fixes), keeping the
-- earliest record in each group.

-- 1. LeadStatus.CLOSING
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CLOSING';

-- 2. Transaction (leadId, buyerId) unique
DELETE FROM "Transaction" t
USING "Transaction" keep
WHERE t."leadId" = keep."leadId"
  AND t."buyerId" = keep."buyerId"
  AND t."createdAt" > keep."createdAt";

CREATE UNIQUE INDEX "Transaction_leadId_buyerId_key"
    ON "Transaction"("leadId", "buyerId");

-- 3. VaultTransaction (vaultId, type, reference) unique
-- (NULL references are exempt — Postgres treats NULLs as distinct.)
DELETE FROM "VaultTransaction" v
USING "VaultTransaction" keep
WHERE v."vaultId" = keep."vaultId"
  AND v."type" = keep."type"
  AND v."reference" IS NOT NULL
  AND v."reference" = keep."reference"
  AND v."createdAt" > keep."createdAt";

CREATE UNIQUE INDEX "VaultTransaction_vaultId_type_reference_key"
    ON "VaultTransaction"("vaultId", "type", "reference");
