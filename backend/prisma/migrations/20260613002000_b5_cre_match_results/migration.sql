-- Phase B5: DON → backend match-result feedback loop (idempotent ingestion)

CREATE TABLE "CreMatchResult" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "matchedSets" INTEGER NOT NULL DEFAULT 0,
    "bidsPlaced" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "CreMatchResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreMatchResult_leadId_key" ON "CreMatchResult"("leadId");

CREATE INDEX "CreMatchResult_receivedAt_idx" ON "CreMatchResult"("receivedAt");
