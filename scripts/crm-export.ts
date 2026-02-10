#!/usr/bin/env node
/**
 * CRM Export Script
 * -----------------
 * Exports leads from the Lead Engine database into CRM-compatible CSV/JSON.
 *
 * Usage:
 *   npx ts-node scripts/crm-export.ts [options]
 *
 * Options:
 *   --format csv|json      Output format (default: csv)
 *   --status SOLD|ALL      Filter by status (default: SOLD)
 *   --country US|ALL       Filter by country (default: ALL)
 *   --output <path>        Output file path (default: stdout)
 *   --days <number>        Only leads from last N days (default: 30)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ExportOptions {
    format: 'csv' | 'json';
    status: string;
    country: string;
    output: string | null;
    days: number;
}

function parseArgs(): ExportOptions {
    const args = process.argv.slice(2);
    const opts: ExportOptions = {
        format: 'csv',
        status: 'SOLD',
        country: 'ALL',
        output: null,
        days: 30,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--format': opts.format = args[++i] as 'csv' | 'json'; break;
            case '--status': opts.status = args[++i]; break;
            case '--country': opts.country = args[++i]; break;
            case '--output': opts.output = args[++i]; break;
            case '--days': opts.days = parseInt(args[++i], 10); break;
        }
    }
    return opts;
}

async function exportLeads(opts: ExportOptions) {
    const since = new Date();
    since.setDate(since.getDate() - opts.days);

    const where: any = {
        createdAt: { gte: since },
    };

    if (opts.status !== 'ALL') {
        where.status = opts.status;
    }

    const leads = await prisma.lead.findMany({
        where,
        include: {
            bids: {
                where: { status: 'ACCEPTED' },
                take: 1,
                orderBy: { amount: 'desc' },
            },
            seller: {
                select: { companyName: true },
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    // Filter by country if specified (geo is JSON)
    const filtered = opts.country === 'ALL'
        ? leads
        : leads.filter((l) => {
            const geo = l.geo as any;
            return geo?.country === opts.country;
        });

    console.error(`[CRM Export] Found ${filtered.length} leads (status=${opts.status}, country=${opts.country}, days=${opts.days})`);

    if (opts.format === 'json') {
        return formatJson(filtered);
    }
    return formatCsv(filtered);
}

function formatCsv(leads: any[]): string {
    const headers = [
        'lead_id',
        'vertical',
        'country',
        'state',
        'city',
        'zip',
        'status',
        'source',
        'seller_company',
        'reserve_price',
        'winning_bid',
        'created_at',
        'crm_import_date',
    ];

    const rows = leads.map((l) => {
        const geo = l.geo as any;
        const winBid = l.bids?.[0];
        return [
            l.id,
            l.vertical,
            geo?.country || 'US',
            geo?.state || geo?.region || '',
            geo?.city || '',
            geo?.zip || '',
            l.status,
            l.source,
            l.seller?.companyName || '',
            l.reservePrice?.toString() || '0',
            winBid?.amount?.toString() || '',
            l.createdAt.toISOString(),
            new Date().toISOString(),
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    return [headers.join(','), ...rows].join('\n');
}

function formatJson(leads: any[]): string {
    const records = leads.map((l) => {
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
            created_at: l.createdAt.toISOString(),
            crm_import_date: new Date().toISOString(),
        };
    });

    return JSON.stringify({ leads: records, count: records.length, exported_at: new Date().toISOString() }, null, 2);
}

async function main() {
    const opts = parseArgs();

    try {
        const output = await exportLeads(opts);

        if (opts.output) {
            const fs = await import('fs');
            fs.writeFileSync(opts.output, output, 'utf-8');
            console.error(`[CRM Export] Written to ${opts.output}`);
        } else {
            console.log(output);
        }
    } catch (error) {
        console.error('[CRM Export] Error:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
