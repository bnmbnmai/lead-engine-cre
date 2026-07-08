/**
 * Agent integration webhooks — persisted, signed, SSRF-hardened.
 */

import crypto from 'crypto';
import { prisma } from '../lib/prisma';

export type AgentWebhookEvent =
    | 'strategy.decision'
    | 'bid.placed'
    | 'auction.won'
    | 'lead.matched';

export type SellerWebhookEvent =
    | 'lead.listed'
    | 'auction.closed'
    | 'settlement.paid';

export type WebhookEvent = AgentWebhookEvent | SellerWebhookEvent;

const MAX_DELIVERY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 5000, 30000];

function generateWebhookSecret(): string {
    return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

function signPayload(secret: string, body: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** Validate webhook URL — HTTPS only in prod; block private/metadata hosts. */
export function isWebhookUrlAllowed(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (process.env.NODE_ENV !== 'production') {
            if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') return true;
        }
        if (parsed.protocol !== 'https:') return false;

        const host = parsed.hostname.toLowerCase();
        if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;

        // Block literal private IPv4
        const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
        if (ipv4) {
            const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
            if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) {
                return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

export async function registerAgentWebhook(
    ownerId: string,
    url: string,
    events: AgentWebhookEvent[],
): Promise<{ id: string; url: string; events: string[]; secret: string; active: boolean; createdAt: Date }> {
    const secret = generateWebhookSecret();
    const row = await prisma.agentWebhook.create({
        data: { ownerId, url, events, secret, side: 'BUYER' },
    });
    return {
        id: row.id,
        url: row.url,
        events: row.events,
        secret: row.secret,
        active: row.active,
        createdAt: row.createdAt,
    };
}

export async function listAgentWebhooks(ownerId: string) {
    return prisma.agentWebhook.findMany({
        where: { ownerId, active: true, side: 'BUYER' },
        select: { id: true, url: true, events: true, active: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
    });
}

export async function registerSellerWebhook(
    ownerId: string,
    url: string,
    events: SellerWebhookEvent[],
) {
    const secret = generateWebhookSecret();
    const row = await prisma.agentWebhook.create({
        data: { ownerId, url, events, secret, side: 'SELLER' },
    });
    return {
        id: row.id,
        url: row.url,
        events: row.events,
        secret: row.secret,
        active: row.active,
        createdAt: row.createdAt,
    };
}

export async function listSellerWebhooks(ownerId: string) {
    return prisma.agentWebhook.findMany({
        where: { ownerId, active: true, side: 'SELLER' },
        select: { id: true, url: true, events: true, active: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
    });
}

export async function deleteSellerWebhook(ownerId: string, id: string): Promise<boolean> {
    const result = await prisma.agentWebhook.updateMany({
        where: { id, ownerId, side: 'SELLER' },
        data: { active: false },
    });
    return result.count > 0;
}

export async function deleteAgentWebhook(ownerId: string, id: string): Promise<boolean> {
    const result = await prisma.agentWebhook.updateMany({
        where: { id, ownerId },
        data: { active: false },
    });
    return result.count > 0;
}

export async function listWebhookDeliveries(ownerId: string, webhookId: string, limit = 50) {
    const hook = await prisma.agentWebhook.findFirst({ where: { id: webhookId, ownerId } });
    if (!hook) return null;
    return prisma.agentWebhookDelivery.findMany({
        where: { webhookId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
        select: {
            id: true,
            eventType: true,
            status: true,
            attempts: true,
            lastError: true,
            createdAt: true,
            deliveredAt: true,
        },
    });
}

async function deliverWebhook(
    webhookId: string,
    secret: string,
    url: string,
    eventType: WebhookEvent,
    payload: Record<string, unknown>,
    deliveryId: string,
): Promise<void> {
    const body = JSON.stringify({
        source: 'lead-engine-agentrtb',
        event: eventType,
        timestamp: new Date().toISOString(),
        deliveryId,
        ...payload,
    });
    const signature = signPayload(secret, body);

    for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt++) {
        if (RETRY_DELAYS_MS[attempt] > 0) {
            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-AgentRTB-Signature': signature,
                    'X-AgentRTB-Event': eventType,
                    'X-AgentRTB-Delivery-Id': deliveryId,
                },
                body,
                signal: AbortSignal.timeout(10000),
            });
            if (resp.ok) {
                await prisma.agentWebhookDelivery.update({
                    where: { id: deliveryId },
                    data: { status: 'delivered', attempts: attempt + 1, deliveredAt: new Date() },
                });
                return;
            }
            const errText = `HTTP ${resp.status}`;
            await prisma.agentWebhookDelivery.update({
                where: { id: deliveryId },
                data: { attempts: attempt + 1, lastError: errText },
            });
        } catch (err: any) {
            await prisma.agentWebhookDelivery.update({
                where: { id: deliveryId },
                data: { attempts: attempt + 1, lastError: err.message },
            });
        }
    }
    await prisma.agentWebhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'failed' },
    });
}

export async function fireAgentWebhooks(
    ownerId: string,
    eventType: AgentWebhookEvent,
    payload: Record<string, unknown>,
): Promise<void> {
    const hooks = await prisma.agentWebhook.findMany({
        where: { ownerId, active: true, side: 'BUYER', events: { has: eventType } },
    });
    if (hooks.length === 0) return;

    for (const hook of hooks) {
        const delivery = await prisma.agentWebhookDelivery.create({
            data: {
                webhookId: hook.id,
                eventType,
                payload: payload as object,
                status: 'pending',
            },
        });
        deliverWebhook(hook.id, hook.secret, hook.url, eventType, payload, delivery.id).catch((err) => {
            console.warn(`[AgentWebhook] delivery ${delivery.id} failed: ${err.message}`);
        });
    }
}

export async function fireSellerWebhooks(
    ownerId: string,
    eventType: SellerWebhookEvent,
    payload: Record<string, unknown>,
): Promise<void> {
    const hooks = await prisma.agentWebhook.findMany({
        where: { ownerId, active: true, side: 'SELLER', events: { has: eventType } },
    });
    if (hooks.length === 0) return;

    for (const hook of hooks) {
        const delivery = await prisma.agentWebhookDelivery.create({
            data: {
                webhookId: hook.id,
                eventType,
                payload: payload as object,
                status: 'pending',
            },
        });
        deliverWebhook(hook.id, hook.secret, hook.url, eventType, payload, delivery.id).catch((err) => {
            console.warn(`[SellerWebhook] delivery ${delivery.id} failed: ${err.message}`);
        });
    }
}

/** Retry failed deliveries (cron / startup hook). */
export async function retryFailedWebhookDeliveries(limit = 20): Promise<number> {
    const pending = await prisma.agentWebhookDelivery.findMany({
        where: { status: 'pending', attempts: { lt: MAX_DELIVERY_ATTEMPTS } },
        orderBy: { createdAt: 'asc' },
        take: limit,
        include: { webhook: true },
    });
    for (const d of pending) {
        if (!d.webhook.active) continue;
        await deliverWebhook(
            d.webhookId,
            d.webhook.secret,
            d.webhook.url,
            d.eventType as AgentWebhookEvent,
            d.payload as Record<string, unknown>,
            d.id,
        );
    }
    return pending.length;
}
