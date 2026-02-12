import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { AnalyticsQuerySchema } from '../utils/validation';
import { analyticsLimiter } from '../middleware/rateLimit';
import { analyticsOverviewCache, analyticsLeadCache } from '../lib/cache';
import { getMockOverview, getMockLeadAnalytics, getMockBidAnalytics } from '../services/analytics-mock';

const router = Router();

const IS_PROD = process.env.NODE_ENV === 'production';
const USE_MOCK = process.env.USE_MOCK_DATA === 'true' && !IS_PROD;

if (process.env.USE_MOCK_DATA === 'true' && IS_PROD) {
    console.warn('[analytics] ⚠️  USE_MOCK_DATA=true ignored in production. Using real data from Prisma/Redis.');
}

// ============================================
// Dashboard Overview
// ============================================

router.get('/overview', analyticsLimiter, authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const role = req.user!.role;

        // ── Mock data shortcut ──
        if (USE_MOCK) {
            res.json(getMockOverview(role));
            return;
        }
        const cacheKey = `overview:${role}:${userId}`;
        const cached = analyticsOverviewCache.get(cacheKey);
        if (cached) {
            res.json(cached);
            return;
        }

        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        if (role === 'SELLER') {
            const seller = await prisma.sellerProfile.findFirst({
                where: { user: { id: userId } },
            });

            if (!seller) {
                res.status(400).json({ error: 'Seller profile not found' });
                return;
            }

            const [
                totalLeads,
                leadsThisMonth,
                soldLeads,
                totalRevenue,
                activeAuctions,
                avgBidsPerLead,
            ] = await Promise.all([
                prisma.lead.count({ where: { sellerId: seller.id } }),
                prisma.lead.count({
                    where: { sellerId: seller.id, createdAt: { gte: thirtyDaysAgo } },
                }),
                prisma.lead.count({
                    where: { sellerId: seller.id, status: 'SOLD' },
                }),
                prisma.lead.aggregate({
                    where: { sellerId: seller.id, status: 'SOLD' },
                    _sum: { winningBid: true },
                }),
                prisma.lead.count({
                    where: { sellerId: seller.id, status: 'IN_AUCTION' },
                }),
                prisma.bid.groupBy({
                    by: ['leadId'],
                    where: { lead: { sellerId: seller.id } },
                    _count: true,
                }),
            ]);

            const avgBids = avgBidsPerLead.length > 0
                ? avgBidsPerLead.reduce((sum, l) => sum + l._count, 0) / avgBidsPerLead.length
                : 0;

            const result = {
                role: 'SELLER',
                stats: {
                    totalLeads,
                    leadsThisMonth,
                    soldLeads,
                    totalRevenue: totalRevenue._sum.winningBid || 0,
                    activeAuctions,
                    avgBidsPerLead: Math.round(avgBids * 10) / 10,
                    conversionRate: totalLeads > 0 ? (soldLeads / totalLeads * 100).toFixed(1) : 0,
                },
            };
            analyticsOverviewCache.set(cacheKey, result);
            res.json(result);
        } else if (role === 'BUYER') {
            const [
                totalBids,
                bidsThisMonth,
                wonBids,
                totalSpent,
                activeBids,
                avgBidAmount,
            ] = await Promise.all([
                prisma.bid.count({ where: { buyerId: userId } }),
                prisma.bid.count({
                    where: { buyerId: userId, createdAt: { gte: thirtyDaysAgo } },
                }),
                prisma.bid.count({
                    where: { buyerId: userId, status: 'ACCEPTED' },
                }),
                prisma.transaction.aggregate({
                    where: { buyerId: userId, status: 'RELEASED' },
                    _sum: { amount: true },
                }),
                prisma.bid.count({
                    where: { buyerId: userId, status: { in: ['PENDING', 'REVEALED'] } },
                }),
                prisma.bid.aggregate({
                    where: { buyerId: userId, amount: { not: null } },
                    _avg: { amount: true },
                }),
            ]);

            const result = {
                role: 'BUYER',
                stats: {
                    totalBids,
                    bidsThisMonth,
                    wonBids,
                    totalSpent: totalSpent._sum.amount || 0,
                    activeBids,
                    avgBidAmount: avgBidAmount._avg.amount || 0,
                    winRate: totalBids > 0 ? (wonBids / totalBids * 100).toFixed(1) : 0,
                },
            };
            analyticsOverviewCache.set(cacheKey, result);
            res.json(result);
        } else {
            // Admin overview
            const [totalUsers, totalLeads, totalTransactions, platformRevenue] = await Promise.all([
                prisma.user.count(),
                prisma.lead.count(),
                prisma.transaction.count({ where: { status: 'RELEASED' } }),
                prisma.transaction.aggregate({
                    where: { status: 'RELEASED' },
                    _sum: { platformFee: true },
                }),
            ]);

            res.json({
                role: 'ADMIN',
                stats: {
                    totalUsers,
                    totalLeads,
                    totalTransactions,
                    platformRevenue: platformRevenue._sum.platformFee || 0,
                },
            });
        }
    } catch (error) {
        console.error('Analytics overview error:', error);
        res.status(500).json({ error: 'Failed to get analytics' });
    }
});

// ============================================
// Lead Analytics
// ============================================

router.get('/leads', analyticsLimiter, authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = AnalyticsQuerySchema.safeParse(req.query);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid query', details: validation.error.issues });
            return;
        }

        // ── Mock data shortcut ──
        if (USE_MOCK) {
            const { groupBy } = validation.data;
            res.json(getMockLeadAnalytics(groupBy || 'day'));
            return;
        }

        const { startDate, endDate, vertical, groupBy } = validation.data;

        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();

        const where: any = {
            createdAt: { gte: start, lte: end },
        };

        if (vertical) where.vertical = vertical;

        // For sellers, filter to their leads only
        if (req.user!.role === 'SELLER') {
            const seller = await prisma.sellerProfile.findFirst({
                where: { user: { id: req.user!.id } },
            });
            if (seller) where.sellerId = seller.id;
        }

        // Get aggregated data
        const leads = await prisma.lead.findMany({
            where,
            select: {
                id: true,
                vertical: true,
                status: true,
                source: true,
                reservePrice: true,
                winningBid: true,
                createdAt: true,
            },
        });

        // Group by time period
        const grouped: Record<string, { count: number; sold: number; revenue: number }> = {};

        for (const lead of leads) {
            let key: string;
            const date = new Date(lead.createdAt);

            if (groupBy === 'day') {
                key = date.toISOString().split('T')[0];
            } else if (groupBy === 'week') {
                const weekStart = new Date(date);
                weekStart.setDate(date.getDate() - date.getDay());
                key = weekStart.toISOString().split('T')[0];
            } else {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            }

            if (!grouped[key]) {
                grouped[key] = { count: 0, sold: 0, revenue: 0 };
            }

            grouped[key].count++;
            if (lead.status === 'SOLD') {
                grouped[key].sold++;
                grouped[key].revenue += Number(lead.winningBid || 0);
            }
        }

        // Aggregate by vertical
        const byVertical = leads.reduce((acc, lead) => {
            if (!acc[lead.vertical]) {
                acc[lead.vertical] = { count: 0, sold: 0, revenue: 0 };
            }
            acc[lead.vertical].count++;
            if (lead.status === 'SOLD') {
                acc[lead.vertical].sold++;
                acc[lead.vertical].revenue += Number(lead.winningBid || 0);
            }
            return acc;
        }, {} as Record<string, { count: number; sold: number; revenue: number }>);

        // Aggregate by source
        const bySource = leads.reduce((acc, lead) => {
            if (!acc[lead.source]) {
                acc[lead.source] = { count: 0, sold: 0 };
            }
            acc[lead.source].count++;
            if (lead.status === 'SOLD') acc[lead.source].sold++;
            return acc;
        }, {} as Record<string, { count: number; sold: number }>);

        res.json({
            period: { start, end },
            timeSeries: Object.entries(grouped).map(([date, data]) => ({ date, ...data })),
            byVertical: Object.entries(byVertical).map(([vertical, data]) => ({ vertical, ...data })),
            bySource: Object.entries(bySource).map(([source, data]) => ({ source, ...data })),
            totals: {
                count: leads.length,
                sold: leads.filter(l => l.status === 'SOLD').length,
                revenue: leads.reduce((sum, l) => sum + Number(l.winningBid || 0), 0),
            },
        });
    } catch (error) {
        console.error('Lead analytics error:', error);
        res.status(500).json({ error: 'Failed to get lead analytics' });
    }
});

// ============================================
// Bid Analytics
// ============================================

router.get('/bids', analyticsLimiter, authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // ── Mock data shortcut ──
        if (USE_MOCK) {
            res.json(getMockBidAnalytics());
            return;
        }

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const where: any = {
            createdAt: { gte: thirtyDaysAgo },
        };

        if (req.user!.role === 'BUYER') {
            where.buyerId = req.user!.id;
        }

        const bids = await prisma.bid.findMany({
            where,
            include: {
                lead: {
                    select: { vertical: true, status: true },
                },
            },
        });

        const byStatus = bids.reduce((acc, bid) => {
            acc[bid.status] = (acc[bid.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const byVertical = bids.reduce((acc, bid) => {
            const v = bid.lead.vertical;
            if (!acc[v]) acc[v] = { total: 0, won: 0, avgAmount: 0, amounts: [] };
            acc[v].total++;
            if (bid.status === 'ACCEPTED') acc[v].won++;
            if (bid.amount) acc[v].amounts.push(Number(bid.amount));
            return acc;
        }, {} as Record<string, { total: number; won: number; avgAmount: number; amounts: number[] }>);

        // Calculate averages
        for (const v of Object.keys(byVertical)) {
            const amounts = byVertical[v].amounts;
            byVertical[v].avgAmount = amounts.length > 0
                ? amounts.reduce((a, b) => a + b, 0) / amounts.length
                : 0;
            delete (byVertical[v] as any).amounts;
        }

        res.json({
            period: { start: thirtyDaysAgo, end: new Date() },
            byStatus,
            byVertical: Object.entries(byVertical).map(([vertical, data]) => ({ vertical, ...data })),
            totals: {
                total: bids.length,
                won: bids.filter(b => b.status === 'ACCEPTED').length,
                pending: bids.filter(b => b.status === 'PENDING' || b.status === 'REVEALED').length,
            },
        });
    } catch (error) {
        console.error('Bid analytics error:', error);
        res.status(500).json({ error: 'Failed to get bid analytics' });
    }
});

// ============================================
// Conversion Analytics — Ad Source Tracking
// ============================================

router.get('/conversions', analyticsLimiter, authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const days = Math.min(parseInt((req.query.days as string) || '30') || 30, 365);
        const vertical = req.query.vertical as string | undefined;

        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { id: req.user!.id } },
        });

        if (!seller) {
            res.status(403).json({ error: 'Seller profile required for conversion analytics' });
            return;
        }

        const since = new Date();
        since.setDate(since.getDate() - days);

        const where: any = { sellerId: seller.id, createdAt: { gte: since } };
        if (vertical) where.vertical = vertical;

        const leads = await prisma.lead.findMany({
            where,
            select: {
                id: true,
                status: true,
                adSource: true,
                winningBid: true,
                vertical: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        // Group by utm_source (or "direct" if no adSource)
        const groups = new Map<string, { leads: number; sold: number; revenue: number; bids: number[] }>();

        for (const lead of leads) {
            const ad = lead.adSource as any;
            const source = ad?.utm_source || 'direct';

            if (!groups.has(source)) {
                groups.set(source, { leads: 0, sold: 0, revenue: 0, bids: [] });
            }

            const g = groups.get(source)!;
            g.leads++;

            if (lead.status === 'SOLD' && lead.winningBid) {
                g.sold++;
                const bid = parseFloat(lead.winningBid.toString());
                g.revenue += bid;
                g.bids.push(bid);
            }
        }

        const conversions = Array.from(groups.entries())
            .map(([source, data]) => ({
                source,
                leads: data.leads,
                sold: data.sold,
                conversionRate: data.leads > 0 ? Math.round((data.sold / data.leads) * 10000) / 100 : 0,
                revenue: Math.round(data.revenue * 100) / 100,
                avgBid: data.bids.length > 0
                    ? Math.round((data.revenue / data.bids.length) * 100) / 100
                    : 0,
            }))
            .sort((a, b) => b.revenue - a.revenue);

        const totalLeads = leads.length;
        const directLeads = groups.get('direct')?.leads || 0;

        res.json({
            conversions,
            meta: {
                days,
                total: totalLeads,
                directPct: totalLeads > 0 ? Math.round((directLeads / totalLeads) * 100) : 0,
                queriedAt: new Date().toISOString(),
            },
        });
    } catch (error) {
        console.error('Conversion analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch conversion analytics' });
    }
});

router.get('/conversions/by-platform', analyticsLimiter, authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const days = Math.min(parseInt((req.query.days as string) || '30') || 30, 365);

        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { id: req.user!.id } },
        });

        if (!seller) {
            res.status(403).json({ error: 'Seller profile required' });
            return;
        }

        const since = new Date();
        since.setDate(since.getDate() - days);

        const leads = await prisma.lead.findMany({
            where: { sellerId: seller.id, createdAt: { gte: since } },
            select: { status: true, adSource: true, winningBid: true },
        });

        const platforms = new Map<string, { leads: number; sold: number; revenue: number }>();

        for (const lead of leads) {
            const ad = lead.adSource as any;
            const platform = ad?.ad_platform || 'none';

            if (!platforms.has(platform)) {
                platforms.set(platform, { leads: 0, sold: 0, revenue: 0 });
            }

            const p = platforms.get(platform)!;
            p.leads++;

            if (lead.status === 'SOLD' && lead.winningBid) {
                p.sold++;
                p.revenue += parseFloat(lead.winningBid.toString());
            }
        }

        const result = Array.from(platforms.entries())
            .map(([platform, data]) => ({
                platform,
                leads: data.leads,
                sold: data.sold,
                conversionRate: data.leads > 0 ? Math.round((data.sold / data.leads) * 10000) / 100 : 0,
                revenue: Math.round(data.revenue * 100) / 100,
            }))
            .sort((a, b) => b.revenue - a.revenue);

        res.json({ platforms: result });
    } catch (error) {
        console.error('Platform analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch platform analytics' });
    }
});

export default router;
