/**
 * Seeded mock data provider for analytics endpoints.
 * Activated when USE_MOCK_DATA=true.
 * Uses @faker-js/faker with a fixed seed (42) so output is deterministic.
 */
import { faker } from '@faker-js/faker';

// Fixed seed → identical data on every call
faker.seed(42);

// Defensive guard — this module should never be imported in production
if (process.env.NODE_ENV === 'production') {
    console.error('[analytics-mock] ❌ Mock data module loaded in production — this should never happen.');
}

// ============================================
// Helpers
// ============================================

const VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'real_estate', 'auto', 'b2b_saas'];

function dateLabel(daysAgo: number): string {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
}

// ============================================
// Overview
// ============================================

export function getMockOverview(role: string) {
    // Re-seed so each call is deterministic regardless of prior faker usage
    faker.seed(42);

    if (role === 'SELLER') {
        return {
            role: 'SELLER',
            stats: {
                totalLeads: faker.number.int({ min: 120, max: 500 }),
                leadsThisMonth: faker.number.int({ min: 18, max: 65 }),
                soldLeads: faker.number.int({ min: 40, max: 200 }),
                totalRevenue: faker.number.float({ min: 5000, max: 50000, fractionDigits: 2 }),
                activeAuctions: faker.number.int({ min: 3, max: 15 }),
                avgBidsPerLead: +(faker.number.float({ min: 1.5, max: 6.0, fractionDigits: 1 })),
                conversionRate: faker.number.float({ min: 25, max: 75, fractionDigits: 1 }).toFixed(1),
            },
        };
    }

    if (role === 'BUYER') {
        const totalBids = faker.number.int({ min: 50, max: 300 });
        const wonBids = faker.number.int({ min: 10, max: Math.floor(totalBids * 0.6) });
        return {
            role: 'BUYER',
            stats: {
                totalBids,
                bidsThisMonth: faker.number.int({ min: 5, max: 40 }),
                wonBids,
                totalSpent: faker.number.float({ min: 2000, max: 25000, fractionDigits: 2 }),
                activeBids: faker.number.int({ min: 2, max: 12 }),
                avgBidAmount: faker.number.float({ min: 40, max: 250, fractionDigits: 2 }),
                winRate: totalBids > 0 ? (wonBids / totalBids * 100).toFixed(1) : '0',
            },
        };
    }

    // Admin
    return {
        role: 'ADMIN',
        stats: {
            totalUsers: faker.number.int({ min: 50, max: 500 }),
            totalLeads: faker.number.int({ min: 200, max: 5000 }),
            totalTransactions: faker.number.int({ min: 80, max: 2000 }),
            platformRevenue: faker.number.float({ min: 1000, max: 20000, fractionDigits: 2 }),
        },
    };
}

// ============================================
// Lead Analytics
// ============================================

export function getMockLeadAnalytics(groupBy: string = 'day') {
    faker.seed(100);

    const days = 30;
    const timeSeries: { date: string; count: number; sold: number; revenue: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
        const count = faker.number.int({ min: 1, max: 15 });
        const sold = faker.number.int({ min: 0, max: count });
        timeSeries.push({
            date: dateLabel(i),
            count,
            sold,
            revenue: +(sold * faker.number.float({ min: 30, max: 200, fractionDigits: 2 })).toFixed(2),
        });
    }

    const byVertical = VERTICALS.map((v) => {
        const count = faker.number.int({ min: 5, max: 60 });
        const sold = faker.number.int({ min: 0, max: count });
        return {
            vertical: v,
            count,
            sold,
            revenue: +(sold * faker.number.float({ min: 40, max: 250, fractionDigits: 2 })).toFixed(2),
        };
    });

    const bySource = {
        PLATFORM: { count: faker.number.int({ min: 40, max: 200 }), sold: faker.number.int({ min: 20, max: 100 }) },
        OFFSITE: { count: faker.number.int({ min: 10, max: 80 }), sold: faker.number.int({ min: 5, max: 40 }) },
    };

    const totalCount = timeSeries.reduce((s, d) => s + d.count, 0);
    const totalSold = timeSeries.reduce((s, d) => s + d.sold, 0);
    const totalRevenue = timeSeries.reduce((s, d) => s + d.revenue, 0);

    return {
        period: { start: dateLabel(days), end: dateLabel(0) },
        groupBy,
        timeSeries,
        byVertical,
        bySource,
        totals: { count: totalCount, sold: totalSold, revenue: +totalRevenue.toFixed(2) },
    };
}

// ============================================
// Bid Analytics
// ============================================

export function getMockBidAnalytics() {
    faker.seed(200);

    const byVertical = VERTICALS.slice(0, 6).map((v) => {
        const total = faker.number.int({ min: 8, max: 50 });
        const won = faker.number.int({ min: 2, max: Math.floor(total * 0.7) });
        return {
            vertical: v,
            total,
            won,
            avgAmount: faker.number.float({ min: 35, max: 220, fractionDigits: 2 }),
        };
    });

    const totalBids = byVertical.reduce((s, v) => s + v.total, 0);
    const wonBids = byVertical.reduce((s, v) => s + v.won, 0);

    return {
        period: { start: dateLabel(30), end: dateLabel(0) },
        byStatus: {
            PENDING: faker.number.int({ min: 5, max: 30 }),
            REVEALED: faker.number.int({ min: 3, max: 20 }),
            ACCEPTED: wonBids,
            REJECTED: faker.number.int({ min: 2, max: 15 }),
        },
        byVertical,
        totals: {
            total: totalBids,
            won: wonBids,
            pending: faker.number.int({ min: 5, max: 25 }),
        },
    };
}
