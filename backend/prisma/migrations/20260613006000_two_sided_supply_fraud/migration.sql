-- Two-sided AgentRTB: seller role, SupplySpec, ingest dedup, seller webhooks

CREATE TYPE "AgentProfileRole" AS ENUM ('BUYER', 'SELLER', 'BOTH');
CREATE TYPE "AgentWebhookSide" AS ENUM ('BUYER', 'SELLER');

ALTER TABLE "AgentProfile" ADD COLUMN "role" "AgentProfileRole" NOT NULL DEFAULT 'BUYER';

ALTER TABLE "AgentWebhook" ADD COLUMN "side" "AgentWebhookSide" NOT NULL DEFAULT 'BUYER';

CREATE TABLE "SupplyStrategy" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AgentStrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyStrategy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyStrategyVersion" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "spec" JSONB NOT NULL,
    "changelog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyStrategyVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadContactDedup" (
    "id" TEXT NOT NULL,
    "hashType" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "vertical" TEXT,
    "leadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadContactDedup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplyStrategy_ownerId_status_idx" ON "SupplyStrategy"("ownerId", "status");
CREATE UNIQUE INDEX "SupplyStrategyVersion_strategyId_version_key" ON "SupplyStrategyVersion"("strategyId", "version");
CREATE INDEX "LeadContactDedup_hashType_hash_vertical_createdAt_idx" ON "LeadContactDedup"("hashType", "hash", "vertical", "createdAt");

ALTER TABLE "SupplyStrategyVersion" ADD CONSTRAINT "SupplyStrategyVersion_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "SupplyStrategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
