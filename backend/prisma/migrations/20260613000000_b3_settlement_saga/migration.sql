-- Phase B3: settlement saga (outbox pattern) + SETTLING lead status

ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'SETTLING';

CREATE TYPE "SettlementSagaState" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'COMPENSATED', 'FAILED');

CREATE TABLE "SettlementSaga" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "winningBidId" TEXT NOT NULL,
    "state" "SettlementSagaState" NOT NULL DEFAULT 'PENDING',
    "steps" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementSaga_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementSaga_leadId_key" ON "SettlementSaga"("leadId");

CREATE INDEX "SettlementSaga_state_updatedAt_idx" ON "SettlementSaga"("state", "updatedAt");
