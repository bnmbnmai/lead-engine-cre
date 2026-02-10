import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { AnalyticsQuerySchema } from '../utils/validation';
import { analyticsLimiter } from '../middleware/rateLimit';
import { analyticsOverviewCache, analyticsLeadCache } from '../lib/cache';

const router = Router();

// ============================================
// Dashboard Overview
// ============================================

router.get('/overview', analyticsLimiter, authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const role = req.user!.role;
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

export default router;
