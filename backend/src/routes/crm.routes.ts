import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// ============================================
// CRM Export — Download CSV/JSON
// ============================================

router.get('/export', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const format = (req.query.format as string) || 'csv';
        const status = (req.query.status as string) || 'ALL';
        const days = parseInt((req.query.days as string) || '30');
        const vertical = req.query.vertical as string | undefined;
        const country = req.query.country as string | undefined;

        const since = new Date();
        since.setDate(since.getDate() - days);

        const where: any = { createdAt: { gte: since } };
        if (status !== 'ALL') where.status = status;
        if (vertical) where.vertical = vertical;

        const leads = await prisma.lead.findMany({
            where,
            include: {
                bids: {
                    where: { status: 'ACCEPTED' },
                    take: 1,
                    orderBy: { amount: 'desc' },
                },
                seller: { select: { companyName: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        // Filter by country if specified (geo is JSON)
        const filtered = !country
            ? leads
            : leads.filter((l) => {
                const geo = l.geo as any;
                return geo?.country === country;
            });

        if (format === 'json') {
            const records = filtered.map((l) => mapLeadToExport(l));
            const output = { leads: records, count: records.length, exported_at: new Date().toISOString() };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="leads-export-${Date.now()}.json"`);
            res.json(output);
        } else {
            const csv = formatCsv(filtered);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="leads-export-${Date.now()}.csv"`);
            res.send(csv);
        }
    } catch (error) {
        console.error('CRM export error:', error);
        res.status(500).json({ error: 'Failed to export leads' });
    }
});

// ============================================
// CRM Push — Webhook Integration
// ============================================

router.post('/push', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { leadIds, webhookUrl, format = 'json' } = req.body;
        const targetUrl = webhookUrl || process.env.CRM_WEBHOOK_URL;

        if (!targetUrl) {
            res.status(400).json({ error: 'No webhook URL configured. Set CRM_WEBHOOK_URL in env or pass webhookUrl.' });
            return;
        }

        // Fetch leads
        const where: any = {};
        if (leadIds && Array.isArray(leadIds) && leadIds.length > 0) {
            where.id = { in: leadIds };
        } else {
            // Default: last 50 sold leads
            where.status = 'SOLD';
            where.createdAt = { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
        }

        const leads = await prisma.lead.findMany({
            where,
            include: {
                bids: { where: { status: 'ACCEPTED' }, take: 1, orderBy: { amount: 'desc' } },
                seller: { select: { companyName: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 500,
        });

        const records = leads.map((l) => mapLeadToExport(l));

        // Push to CRM webhook
        const payload = {
            source: 'lead-engine-cre',
            format,
            count: records.length,
            pushed_at: new Date().toISOString(),
            pushed_by: req.user?.id,
            leads: records,
        };

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            res.status(502).json({
                error: 'CRM webhook returned error',
                status: response.status,
                statusText: response.statusText,
            });
            return;
        }

        // Log the push event
        await prisma.analyticsEvent.create({
            data: {
                eventType: 'crm_push',
                entityType: 'export',
                entityId: `push-${Date.now()}`,
                userId: req.user!.id,
                metadata: { leadCount: records.length, webhookUrl: targetUrl },
            },
        });

        res.json({ success: true, pushed: records.length, webhookUrl: targetUrl });
    } catch (error: any) {
        console.error('CRM push error:', error);
        res.status(500).json({ error: 'Failed to push to CRM', message: error.message });
    }
});

// ============================================
// CRM Webhooks — Register / List / Delete
// ============================================

// In-memory webhook store (in production, persist to DB)
interface CRMWebhook {
    id: string;
    url: string;
    format: 'hubspot' | 'zapier' | 'generic';
    events: string[];
    createdBy: string;
    createdAt: string;
    active: boolean;
}

const webhookStore: CRMWebhook[] = [];

router.post('/webhooks', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { url, format = 'generic', events = ['lead.sold'] } = req.body;
        if (!url) {
            res.status(400).json({ error: 'Webhook URL is required' });
            return;
        }
        if (!['hubspot', 'zapier', 'generic'].includes(format)) {
            res.status(400).json({ error: 'Format must be hubspot, zapier, or generic' });
            return;
        }

        const webhook: CRMWebhook = {
            id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            url,
            format,
            events,
            createdBy: req.user!.id,
            createdAt: new Date().toISOString(),
            active: true,
        };
        webhookStore.push(webhook);

        await prisma.analyticsEvent.create({
            data: {
                eventType: 'crm_webhook_registered',
                entityType: 'webhook',
                entityId: webhook.id,
                userId: req.user!.id,
                metadata: { url, format, events },
            },
        });

        res.status(201).json({ webhook });
    } catch (error) {
        console.error('Register webhook error:', error);
        res.status(500).json({ error: 'Failed to register webhook' });
    }
});

router.get('/webhooks', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const userWebhooks = webhookStore.filter((w) => w.createdBy === req.user!.id);
    res.json({ webhooks: userWebhooks });
});

router.delete('/webhooks/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const idx = webhookStore.findIndex((w) => w.id === req.params.id && w.createdBy === req.user!.id);
    if (idx === -1) {
        res.status(404).json({ error: 'Webhook not found' });
        return;
    }
    webhookStore.splice(idx, 1);
    res.json({ success: true });
});

// ============================================
// CRM Webhook Fire — Called on lead status change
// ============================================

// ─── Webhook Hardening: Rate Limit + Retry + Circuit Breaker ───

const WEBHOOK_RATE_LIMIT = 60; // max fires per minute per webhook
const WEBHOOK_RATE_WINDOW_MS = 60_000;
const WEBHOOK_MAX_RETRIES = 3;
const WEBHOOK_CIRCUIT_THRESHOLD = 5; // consecutive failures to trip
const WEBHOOK_CIRCUIT_COOLDOWN_MS = 5 * 60_000; // 5 minutes

interface WebhookHealth {
    fires: number[];           // timestamps of recent fires
    consecutiveFailures: number;
    circuitOpenUntil: number;  // timestamp when circuit re-closes
}

const webhookHealthMap = new Map<string, WebhookHealth>();

function getWebhookHealth(id: string): WebhookHealth {
    if (!webhookHealthMap.has(id)) {
        webhookHealthMap.set(id, { fires: [], consecutiveFailures: 0, circuitOpenUntil: 0 });
    }
    return webhookHealthMap.get(id)!;
}

function isRateLimited(health: WebhookHealth): boolean {
    const now = Date.now();
    health.fires = health.fires.filter((t) => now - t < WEBHOOK_RATE_WINDOW_MS);
    return health.fires.length >= WEBHOOK_RATE_LIMIT;
}

function isCircuitOpen(health: WebhookHealth): boolean {
    if (health.circuitOpenUntil === 0) return false;
    if (Date.now() >= health.circuitOpenUntil) {
        // Cooldown expired — half-open: allow one attempt
        health.circuitOpenUntil = 0;
        health.consecutiveFailures = 0;
        return false;
    }
    return true;
}

async function fetchWithRetry(url: string, body: string, retries = WEBHOOK_MAX_RETRIES): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(10000),
            });
            if (resp.ok) return;
            // Only retry on 5xx (server errors)
            if (resp.status >= 500 && attempt < retries) {
                await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
                continue;
            }
            throw new Error(`HTTP ${resp.status}`);
        } catch (err: any) {
            if (attempt >= retries) throw err;
            // Retry on network errors
            if (err.name === 'AbortError' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
                await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
                continue;
            }
            throw err;
        }
    }
}

export async function fireCRMWebhooks(eventType: string, leads: any[]) {
    const activeWebhooks = webhookStore.filter(
        (w) => w.active && w.events.includes(eventType)
    );

    for (const webhook of activeWebhooks) {
        const health = getWebhookHealth(webhook.id);

        // Circuit breaker check
        if (isCircuitOpen(health)) {
            console.warn(`[Webhook] ${webhook.id} circuit OPEN — skipping until ${new Date(health.circuitOpenUntil).toISOString()}`);
            continue;
        }

        // Rate limit check
        if (isRateLimited(health)) {
            console.warn(`[Webhook] ${webhook.id} rate limited (${WEBHOOK_RATE_LIMIT}/min) — skipping`);
            continue;
        }

        try {
            const payload = formatWebhookPayload(webhook.format, leads);
            await fetchWithRetry(webhook.url, JSON.stringify(payload));
            health.fires.push(Date.now());
            health.consecutiveFailures = 0; // reset on success
        } catch (err: any) {
            health.consecutiveFailures++;
            console.error(JSON.stringify({
                event: 'webhook_failure',
                webhookId: webhook.id,
                url: webhook.url,
                error: err.message,
                consecutiveFailures: health.consecutiveFailures,
                timestamp: new Date().toISOString(),
            }));

            // Trip circuit breaker
            if (health.consecutiveFailures >= WEBHOOK_CIRCUIT_THRESHOLD) {
                health.circuitOpenUntil = Date.now() + WEBHOOK_CIRCUIT_COOLDOWN_MS;
                console.error(`[Webhook] ${webhook.id} circuit TRIPPED after ${WEBHOOK_CIRCUIT_THRESHOLD} failures — cooldown ${WEBHOOK_CIRCUIT_COOLDOWN_MS / 1000}s`);
            }
        }
    }
}

// ============================================
// Format-Specific Transformers
// ============================================

function formatWebhookPayload(format: string, leads: any[]) {
    switch (format) {
        case 'hubspot':
            return formatHubSpotPayload(leads);
        case 'zapier':
            return formatZapierPayload(leads);
        default:
            return {
                source: 'lead-engine-cre',
                event: 'lead.sold',
                count: leads.length,
                timestamp: new Date().toISOString(),
                leads: leads.map(mapLeadToExport),
            };
    }
}

/**
 * HubSpot CRM format: creates/updates contacts via HubSpot's batch API shape.
 * Maps lead fields to HubSpot contact properties.
 */
function formatHubSpotPayload(leads: any[]) {
    return {
        inputs: leads.map((l) => {
            const geo = l.geo as any;
            const ad = l.adSource as any;
            return {
                properties: {
                    firstname: l.firstName || '',
                    lastname: l.lastName || '',
                    email: l.email || '',
                    phone: l.phone || '',
                    company: l.seller?.companyName || '',
                    city: geo?.city || '',
                    state: geo?.state || geo?.region || '',
                    zip: geo?.zip || '',
                    country: geo?.country || 'US',
                    lead_source: 'Lead Engine CRE',
                    lead_vertical: l.vertical,
                    lead_id: l.id,
                    lead_status: l.status,
                    lead_quality_score: String(l.qualityScore || 0),
                    lead_reserve_price: String(l.reservePrice || 0),
                    lead_winning_bid: l.bids?.[0]?.amount ? String(l.bids[0].amount) : '',
                    hs_lead_status: l.status === 'SOLD' ? 'QUALIFIED' : 'NEW',
                    // Ad tracking
                    utm_source: ad?.utm_source || '',
                    utm_medium: ad?.utm_medium || '',
                    utm_campaign: ad?.utm_campaign || '',
                    utm_content: ad?.utm_content || '',
                    utm_term: ad?.utm_term || '',
                    ad_id: ad?.ad_id || '',
                    ad_platform: ad?.ad_platform || '',
                },
            };
        }),
    };
}

/**
 * Zapier catch hook format: flat key-value structure per lead.
 * Each lead is a separate object (Zapier processes one at a time).
 */
function formatZapierPayload(leads: any[]) {
    return leads.map((l) => {
        const geo = l.geo as any;
        const ad = l.adSource as any;
        const winBid = l.bids?.[0];
        return {
            lead_id: l.id,
            vertical: l.vertical,
            status: l.status,
            source: l.source,
            country: geo?.country || 'US',
            state: geo?.state || geo?.region || '',
            city: geo?.city || '',
            zip: geo?.zip || '',
            seller_company: l.seller?.companyName || '',
            reserve_price: parseFloat(l.reservePrice?.toString() || '0'),
            winning_bid: winBid ? parseFloat(winBid.amount?.toString() || '0') : null,
            quality_score: l.qualityScore || null,
            // Ad tracking
            utm_source: ad?.utm_source || '',
            utm_medium: ad?.utm_medium || '',
            utm_campaign: ad?.utm_campaign || '',
            ad_id: ad?.ad_id || '',
            ad_platform: ad?.ad_platform || '',
            created_at: l.createdAt?.toISOString(),
            event_type: 'lead.sold',
            event_timestamp: new Date().toISOString(),
        };
    });
}

// ============================================
// Helpers
// ============================================

function mapLeadToExport(l: any) {
    const geo = l.geo as any;
    const ad = l.adSource as any;
    const winBid = l.bids?.[0];
    return {
        lead_id: l.id,
        vertical: l.vertical,
        geo: {
            country: geo?.country || 'US',
            state: geo?.state || geo?.region || null,
            city: geo?.city || null,
            zip: geo?.zip || null,
        },
        status: l.status,
        source: l.source,
        seller_company: l.seller?.companyName || null,
        pricing: {
            reserve: parseFloat(l.reservePrice?.toString() || '0'),
            winning_bid: winBid ? parseFloat(winBid.amount?.toString() || '0') : null,
        },
        quality_score: l.qualityScore || null,
        ad_source: ad ? {
            utm_source: ad.utm_source || null,
            utm_medium: ad.utm_medium || null,
            utm_campaign: ad.utm_campaign || null,
            ad_id: ad.ad_id || null,
            ad_platform: ad.ad_platform || null,
        } : null,
        created_at: l.createdAt?.toISOString(),
        crm_import_date: new Date().toISOString(),
    };
}

function formatCsv(leads: any[]): string {
    const headers = [
        'lead_id', 'vertical', 'country', 'state', 'city', 'zip',
        'status', 'source', 'seller_company', 'reserve_price',
        'winning_bid', 'quality_score',
        'utm_source', 'utm_medium', 'utm_campaign', 'ad_id', 'ad_platform',
        'created_at', 'crm_import_date',
    ];

    const rows = leads.map((l) => {
        const geo = l.geo as any;
        const ad = l.adSource as any;
        const winBid = l.bids?.[0];
        return [
            l.id, l.vertical, geo?.country || 'US',
            geo?.state || geo?.region || '', geo?.city || '', geo?.zip || '',
            l.status, l.source, l.seller?.companyName || '',
            l.reservePrice?.toString() || '0',
            winBid?.amount?.toString() || '',
            l.qualityScore?.toString() || '',
            ad?.utm_source || '', ad?.utm_medium || '', ad?.utm_campaign || '',
            ad?.ad_id || '', ad?.ad_platform || '',
            l.createdAt?.toISOString(),
            new Date().toISOString(),
        ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
    });

    return [headers.join(','), ...rows].join('\n');
}

export default router;

