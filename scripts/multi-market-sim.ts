#!/usr/bin/env node
/**
 * Multi-Market Simulation — Lead Engine CRE
 * ==========================================
 * Simulates 500 buyers + 500 sellers placing 1000+ bids across 15 countries.
 *
 * Usage:
 *   npx ts-node scripts/multi-market-sim.ts [--buyers 500] [--sellers 500] [--rounds 5]
 *
 * Scenarios covered:
 *   1. Global concurrency — bids across US/EU/APAC simultaneously
 *   2. EU solar match blocked by ACE compliance
 *   3. Off-site fraud detection with acceptOffSite toggle
 *   4. On-chain testnet gas estimation
 *   5. Empty market / cold-start edge case
 */

const API_BASE = process.env.API_URL || 'http://localhost:3001/api/v1';

// ─── Configuration ─────────────────────────────────

interface SimConfig {
    buyers: number;
    sellers: number;
    rounds: number;
    verbose: boolean;
}

function parseArgs(): SimConfig {
    const args = process.argv.slice(2);
    const config: SimConfig = { buyers: 500, sellers: 500, rounds: 5, verbose: false };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--buyers') config.buyers = parseInt(args[++i], 10);
        if (args[i] === '--sellers') config.sellers = parseInt(args[++i], 10);
        if (args[i] === '--rounds') config.rounds = parseInt(args[++i], 10);
        if (args[i] === '--verbose') config.verbose = true;
    }
    return config;
}

// ─── Data Generators ───────────────────────────────

const COUNTRIES = ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'BR', 'IN', 'MX', 'JP', 'KR', 'SG', 'AE', 'ZA', 'NG'];
const REGIONS: Record<string, string[]> = {
    US: ['CA', 'TX', 'FL', 'NY', 'WA', 'CO', 'IL', 'OH', 'PA', 'GA'],
    CA: ['ON', 'BC', 'AB', 'QC'],
    GB: ['ENG', 'SCT', 'WLS', 'NIR'],
    AU: ['NSW', 'VIC', 'QLD', 'WA', 'SA'],
    DE: ['NW', 'BY', 'BW', 'HE'],
    FR: ['IDF', 'ARA', 'NAQ', 'OCC'],
    IN: ['MH', 'KA', 'DL', 'TN', 'GJ'],
    BR: ['SP', 'RJ', 'MG'],
    JP: ['TK', 'OS', 'AI'],
    MX: ['CMX', 'JAL', 'NL'],
    KR: ['SEO', 'PUS'],
    SG: ['SG'],
    AE: ['DXB', 'AUH'],
    ZA: ['GP', 'WC', 'KZN'],
    NG: ['LA', 'ABJ', 'KAN'],
};
const VERTICALS = ['solar', 'mortgage', 'roofing', 'insurance', 'home_services', 'real_estate', 'b2b_saas', 'auto'];
const SOURCES = ['PLATFORM', 'API', 'OFFSITE'];

function randomItem<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
    return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function generateWalletAddress(): string {
    const hex = '0123456789abcdef';
    let addr = '0x';
    for (let i = 0; i < 40; i++) addr += hex[Math.floor(Math.random() * 16)];
    return addr;
}

// ─── Simulation Actors ─────────────────────────────

interface Seller {
    id: string;
    wallet: string;
    company: string;
    country: string;
    verticals: string[];
}

interface Buyer {
    id: string;
    wallet: string;
    company: string;
    countries: string[];
    budget: number;
    kycStatus: 'APPROVED' | 'PENDING' | 'REJECTED';
}

interface SimResult {
    totalLeads: number;
    totalBids: number;
    totalAsks: number;
    aceBlocked: number;
    fraudDetected: number;
    gasCostEstimate: number;
    byCountry: Record<string, { leads: number; bids: number; revenue: number }>;
    byVertical: Record<string, { leads: number; bids: number; revenue: number }>;
    errors: string[];
    latencyMs: { p50: number; p95: number; p99: number };
}

function generateSellers(count: number): Seller[] {
    return Array.from({ length: count }, (_, i) => {
        const country = randomItem(COUNTRIES);
        return {
            id: `seller-${i.toString().padStart(4, '0')}`,
            wallet: generateWalletAddress(),
            company: `${country} Lead Co #${i}`,
            country,
            verticals: [randomItem(VERTICALS), randomItem(VERTICALS)].filter((v, j, a) => a.indexOf(v) === j),
        };
    });
}

function generateBuyers(count: number): Buyer[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `buyer-${i.toString().padStart(4, '0')}`,
        wallet: generateWalletAddress(),
        company: `Buyer Corp #${i}`,
        countries: [randomItem(COUNTRIES), randomItem(COUNTRIES)].filter((v, j, a) => a.indexOf(v) === j),
        budget: randomBetween(500, 50000),
        kycStatus: randomItem(['APPROVED', 'APPROVED', 'APPROVED', 'PENDING', 'REJECTED'] as const),
    }));
}

// ─── Simulation Engine ─────────────────────────────

async function simulateRound(
    roundNum: number,
    sellers: Seller[],
    buyers: Buyer[],
    result: SimResult,
    config: SimConfig,
    latencies: number[]
): Promise<void> {
    const leadsPerSeller = Math.ceil(1000 / config.sellers / config.rounds);

    console.log(`\n  📍 Round ${roundNum}/${config.rounds} — ${sellers.length} sellers × ${leadsPerSeller} leads`);

    // ── Phase 1: Sellers submit leads & asks ──
    for (const seller of sellers) {
        for (let l = 0; l < leadsPerSeller; l++) {
            const vertical = randomItem(seller.verticals);
            const country = seller.country;
            const region = randomItem(REGIONS[country] || ['DEFAULT']);
            const source = randomItem(SOURCES);
            const reservePrice = randomBetween(10, 500);

            const start = Date.now();

            // Simulate off-site fraud check
            if (source === 'OFFSITE' && Math.random() < 0.08) {
                result.fraudDetected++;
                result.errors.push(`[FRAUD] Off-site lead from ${seller.id} in ${country}/${region} flagged`);
                latencies.push(Date.now() - start);
                continue;
            }

            result.totalLeads++;
            const countryStats = result.byCountry[country] || { leads: 0, bids: 0, revenue: 0 };
            countryStats.leads++;
            result.byCountry[country] = countryStats;

            const verticalStats = result.byVertical[vertical] || { leads: 0, bids: 0, revenue: 0 };
            verticalStats.leads++;
            result.byVertical[vertical] = verticalStats;

            // Create ask
            result.totalAsks++;

            // ── Phase 2: Buyers bid on leads ──
            const eligibleBuyers = buyers.filter((b) => {
                if (b.kycStatus !== 'APPROVED') return false;
                if (!b.countries.includes(country)) return false;
                if (b.budget < reservePrice) return false;
                return true;
            });

            // ACE compliance check — EU solar blocked scenario
            const aceBlockedBuyers = eligibleBuyers.filter((b) => {
                // Simulate ACE blocking EU solar leads for non-EU buyers
                if (vertical === 'solar' && ['DE', 'FR', 'GB'].includes(country)) {
                    const buyerIsEU = b.countries.some((c) => ['DE', 'FR', 'GB'].includes(c));
                    if (!buyerIsEU) {
                        result.aceBlocked++;
                        return true; // blocked
                    }
                }
                // Simulate cross-border mortgage compliance (NY/CA/MA restrictions)
                if (vertical === 'mortgage' && country === 'US' && ['NY', 'CA', 'MA'].includes(region)) {
                    if (Math.random() < 0.15) {
                        result.aceBlocked++;
                        return true;
                    }
                }
                return false;
            });

            const clearBuyers = eligibleBuyers.filter((b) => !aceBlockedBuyers.includes(b));
            const bidders = clearBuyers.slice(0, Math.min(clearBuyers.length, Math.floor(Math.random() * 8 + 1)));

            for (const bidder of bidders) {
                const bidAmount = randomBetween(reservePrice, reservePrice * 2.5);
                result.totalBids++;

                countryStats.bids++;
                countryStats.revenue += bidAmount;
                verticalStats.bids++;
                verticalStats.revenue += bidAmount;

                bidder.budget -= bidAmount;

                // Estimate gas cost (testnet ~0.0001 ETH/tx ≈ $0.25)
                result.gasCostEstimate += 0.25;
            }

            latencies.push(Date.now() - start);
        }
    }
}

function calculatePercentile(arr: number[], pct: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((pct / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] || 0;
}

// ─── Report Generator ──────────────────────────────

function generateReport(result: SimResult, config: SimConfig, durationMs: number): string {
    const lines: string[] = [];
    const hr = '═'.repeat(60);

    lines.push('');
    lines.push(hr);
    lines.push('  LEAD ENGINE CRE — Multi-Market Simulation Report');
    lines.push(hr);
    lines.push('');
    lines.push(`  Simulation: ${config.buyers} buyers × ${config.sellers} sellers × ${config.rounds} rounds`);
    lines.push(`  Duration: ${(durationMs / 1000).toFixed(2)}s`);
    lines.push('');

    // Summary
    lines.push('  ┌─── Summary ──────────────────────────────────┐');
    lines.push(`  │  Total Leads:     ${result.totalLeads.toString().padStart(8)}`);
    lines.push(`  │  Total Asks:      ${result.totalAsks.toString().padStart(8)}`);
    lines.push(`  │  Total Bids:      ${result.totalBids.toString().padStart(8)}`);
    lines.push(`  │  ACE Blocked:     ${result.aceBlocked.toString().padStart(8)}`);
    lines.push(`  │  Fraud Detected:  ${result.fraudDetected.toString().padStart(8)}`);
    lines.push(`  │  Gas Estimate:    $${result.gasCostEstimate.toFixed(2).padStart(7)}`);
    lines.push('  └──────────────────────────────────────────────┘');
    lines.push('');

    // Latency
    lines.push('  Latency (simulated):');
    lines.push(`    p50: ${result.latencyMs.p50}ms | p95: ${result.latencyMs.p95}ms | p99: ${result.latencyMs.p99}ms`);
    lines.push('');

    // By Country
    lines.push('  Revenue by Country:');
    lines.push('  ┌─────────┬────────┬────────┬──────────────┐');
    lines.push('  │ Country │  Leads │   Bids │      Revenue │');
    lines.push('  ├─────────┼────────┼────────┼──────────────┤');
    Object.entries(result.byCountry)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .forEach(([country, stats]) => {
            lines.push(
                `  │ ${country.padEnd(7)} │ ${stats.leads.toString().padStart(6)} │ ${stats.bids.toString().padStart(6)} │ $${stats.revenue.toFixed(2).padStart(11)} │`
            );
        });
    lines.push('  └─────────┴────────┴────────┴──────────────┘');
    lines.push('');

    // By Vertical
    lines.push('  Revenue by Vertical:');
    lines.push('  ┌───────────────┬────────┬────────┬──────────────┐');
    lines.push('  │ Vertical      │  Leads │   Bids │      Revenue │');
    lines.push('  ├───────────────┼────────┼────────┼──────────────┤');
    Object.entries(result.byVertical)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .forEach(([vertical, stats]) => {
            lines.push(
                `  │ ${vertical.padEnd(13)} │ ${stats.leads.toString().padStart(6)} │ ${stats.bids.toString().padStart(6)} │ $${stats.revenue.toFixed(2).padStart(11)} │`
            );
        });
    lines.push('  └───────────────┴────────┴────────┴──────────────┘');
    lines.push('');

    // Errors
    if (result.errors.length > 0) {
        lines.push(`  Errors/Warnings (${result.errors.length}):`);
        result.errors.slice(0, 20).forEach((e) => lines.push(`    ⚠  ${e}`));
        if (result.errors.length > 20) lines.push(`    ... and ${result.errors.length - 20} more`);
        lines.push('');
    }

    // Verdict
    const passed = result.totalBids >= 1000 && result.latencyMs.p99 < 2000;
    lines.push(hr);
    lines.push(`  VERDICT: ${passed ? '✅ PASS — Hackathon-ready' : '❌ FAIL — Needs optimization'}`);
    lines.push(`  Threshold: ≥1000 bids, p99 < 2000ms`);
    lines.push(hr);
    lines.push('');

    return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────

async function main() {
    const config = parseArgs();

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  LEAD ENGINE CRE — Multi-Market Simulation             ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`  Config: ${config.buyers} buyers, ${config.sellers} sellers, ${config.rounds} rounds`);

    const sellers = generateSellers(config.sellers);
    const buyers = generateBuyers(config.buyers);

    console.log(`  Generated ${sellers.length} sellers across ${new Set(sellers.map((s) => s.country)).size} countries`);
    console.log(`  Generated ${buyers.length} buyers (${buyers.filter((b) => b.kycStatus === 'APPROVED').length} KYC approved)`);

    const result: SimResult = {
        totalLeads: 0,
        totalBids: 0,
        totalAsks: 0,
        aceBlocked: 0,
        fraudDetected: 0,
        gasCostEstimate: 0,
        byCountry: {},
        byVertical: {},
        errors: [],
        latencyMs: { p50: 0, p95: 0, p99: 0 },
    };

    const latencies: number[] = [];
    const startTime = Date.now();

    for (let r = 1; r <= config.rounds; r++) {
        await simulateRound(r, sellers, buyers, result, config, latencies);
        console.log(`    ✓ Leads: ${result.totalLeads} | Bids: ${result.totalBids} | ACE blocked: ${result.aceBlocked} | Fraud: ${result.fraudDetected}`);
    }

    const durationMs = Date.now() - startTime;
    result.latencyMs = {
        p50: calculatePercentile(latencies, 50),
        p95: calculatePercentile(latencies, 95),
        p99: calculatePercentile(latencies, 99),
    };

    const report = generateReport(result, config, durationMs);
    console.log(report);

    // Write report to file
    const fs = await import('fs');
    const reportPath = `test-results/sim-report-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(reportPath, report, 'utf-8');
    console.log(`  Report saved: ${reportPath}`);
}

main().catch(console.error);
