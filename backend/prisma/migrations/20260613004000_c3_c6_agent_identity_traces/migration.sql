-- Phase C3/C6: agent identity, API keys, decision traces

CREATE TABLE "AgentProfile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "onChainAgentId" TEXT,
    "walletAddress" TEXT,
    "reputationScore" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "settlements" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentProfile_ownerId_key" ON "AgentProfile"("ownerId");
CREATE INDEX "AgentProfile_reputationScore_idx" ON "AgentProfile"("reputationScore");

CREATE TABLE "AgentApiKey" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'default',
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['bid', 'read']::TEXT[],
    "lastUsed" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentApiKey_keyHash_key" ON "AgentApiKey"("keyHash");
CREATE INDEX "AgentApiKey_agentId_idx" ON "AgentApiKey"("agentId");

ALTER TABLE "AgentApiKey" ADD CONSTRAINT "AgentApiKey_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgentDecisionTrace" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "ownerId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "traces" JSONB NOT NULL,
    "bidsPlaced" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecisionTrace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentDecisionTrace_leadId_createdAt_idx" ON "AgentDecisionTrace"("leadId", "createdAt");
CREATE INDEX "AgentDecisionTrace_ownerId_createdAt_idx" ON "AgentDecisionTrace"("ownerId", "createdAt");
