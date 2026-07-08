-- Agent webhooks (persisted) + sandbox API keys
ALTER TABLE "AgentApiKey" ADD COLUMN IF NOT EXISTS "sandboxOnly" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "AgentWebhook" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentWebhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentWebhook_ownerId_idx" ON "AgentWebhook"("ownerId");

CREATE TABLE IF NOT EXISTS "AgentWebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "AgentWebhookDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentWebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "AgentWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AgentWebhookDelivery_webhookId_createdAt_idx" ON "AgentWebhookDelivery"("webhookId", "createdAt");
