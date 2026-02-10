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
