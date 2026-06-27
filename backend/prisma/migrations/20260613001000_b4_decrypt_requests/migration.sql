-- Phase B4: winner PII decrypt request queue + audit trail

CREATE TYPE "DecryptRequestStatus" AS ENUM ('PENDING', 'DELIVERED', 'DENIED', 'EXPIRED');

CREATE TABLE "DecryptRequest" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "winnerId" TEXT NOT NULL,
    "status" "DecryptRequestStatus" NOT NULL DEFAULT 'PENDING',
    "dataHash" TEXT,
    "failReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "DecryptRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DecryptRequest_leadId_winnerId_key" ON "DecryptRequest"("leadId", "winnerId");

CREATE INDEX "DecryptRequest_status_requestedAt_idx" ON "DecryptRequest"("status", "requestedAt");
