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

export async function fireCRMWebhooks(eventType: string, leads: any[]) {
    const activeWebhooks = webhookStore.filter(
        (w) => w.active && w.events.includes(eventType)
    );

    for (const webhook of activeWebhooks) {
        try {
            const payload = formatWebhookPayload(webhook.format, leads);
            await fetch(webhook.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10000),
            });
        } catch (err: any) {
            console.error(`Webhook ${webhook.id} failed:`, err.message);
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
        created_at: l.createdAt?.toISOString(),
        crm_import_date: new Date().toISOString(),
    };
}

function formatCsv(leads: any[]): string {
    const headers = [
        'lead_id', 'vertical', 'country', 'state', 'city', 'zip',
        'status', 'source', 'seller_company', 'reserve_price',
        'winning_bid', 'quality_score', 'created_at', 'crm_import_date',
    ];

    const rows = leads.map((l) => {
        const geo = l.geo as any;
        const winBid = l.bids?.[0];
        return [
            l.id, l.vertical, geo?.country || 'US',
            geo?.state || geo?.region || '', geo?.city || '', geo?.zip || '',
            l.status, l.source, l.seller?.companyName || '',
            l.reservePrice?.toString() || '0',
            winBid?.amount?.toString() || '',
            l.qualityScore?.toString() || '',
            l.createdAt?.toISOString(),
            new Date().toISOString(),
        ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
    });

    return [headers.join(','), ...rows].join('\n');
}

export default router;

