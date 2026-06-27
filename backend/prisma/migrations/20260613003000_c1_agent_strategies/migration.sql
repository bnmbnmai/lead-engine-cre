-- Phase C1: versioned agent strategies (deterministic strategy engine)

CREATE TYPE "AgentStrategyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

CREATE TABLE "AgentStrategy" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AgentStrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "forkedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentStrategy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentStrategy_ownerId_status_idx" ON "AgentStrategy"("ownerId", "status");
CREATE INDEX "AgentStrategy_isPublic_status_idx" ON "AgentStrategy"("isPublic", "status");

CREATE TABLE "AgentStrategyVersion" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "spec" JSONB NOT NULL,
    "changelog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStrategyVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentStrategyVersion_strategyId_version_key" ON "AgentStrategyVersion"("strategyId", "version");

ALTER TABLE "AgentStrategyVersion" ADD CONSTRAINT "AgentStrategyVersion_strategyId_fkey"
    FOREIGN KEY ("strategyId") REFERENCES "AgentStrategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
