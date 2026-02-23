/**
 * demo-lead-drip.ts — Lead injection and continuous marketplace drip
 *
 * Handles:
 *   - buildDemoParams: builds realistic vertical-specific form data
 *   - ensureDemoSeller: idempotent seller profile creation
 *   - injectOneLead: creates a single DEMO lead in DB and emits marketplace:lead:new
 *   - startLeadDrip: runs a background loop, injecting leads at 3–9 s intervals
 *   - countActiveLeads: counts IN_AUCTION leads with future auctionEndAt (exported for tests)
 *   - checkActiveLeadsAndTopUp: enforces DEMO_MIN_ACTIVE_LEADS floor (exported for tests)
 */

import { Server as SocketServer } from 'socket.io';
import { prisma } from '../../lib/prisma';
import { computeCREQualityScore, type LeadScoringInput } from '../../lib/chainlink/cre-quality-score';
import {
    DEMO_SELLER_WALLET,
    DEMO_VERTICALS,
    GEOS,
    FALLBACK_VERTICALS,
    LEAD_AUCTION_DURATION_SECS,
    DEMO_LEAD_DRIP_INTERVAL_MS,
    DEMO_INITIAL_LEADS,
    DEMO_MIN_ACTIVE_LEADS,
    emit,
    rand,
    pick,
    sleep,
} from './demo-shared';

// scheduleBuyerBids is declared in demo-buyer-scheduler; injectOneLead calls it after lead creation.
// We import it lazily via a setter to resolve the circular dep at module initialisation time.
let _scheduleBuyerBids: (
    io: SocketServer,
    leadId: string,
    vertical: string,
    qualityScore: number,
    reservePrice: number,
    auctionEndAt: Date,
) => void = () => { /* no-op until wired */ };

/** Called by demo-buyer-scheduler during module initialisation to inject its function here. */
export function wireScheduleBuyerBids(fn: typeof _scheduleBuyerBids): void {
    _scheduleBuyerBids = fn;
}

// ── Lead Helpers ──────────────────────────────────

/** Build realistic demo form parameters for a given vertical */
export function buildDemoParams(vertical: string): Record<string, string | boolean> {
    const root = vertical.split('.')[0];
    switch (root) {
        case 'solar':
            return {
                roofType: pick(['Asphalt Shingle', 'Metal', 'Tile', 'Flat/TPO']),
                roofAge: `${rand(2, 25)} years`,
                sqft: `${rand(1200, 4500)}`,
                electricBill: `$${rand(100, 400)}/mo`,
                creditScore: pick(['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)']),
                timeline: pick(['ASAP', '1-3 months', '3-6 months']),
            };
        case 'mortgage':
            return {
                propertyType: pick(['Single Family', 'Condo', 'Townhouse']),
                homeValue: `$${rand(200, 900) * 1000}`,
                loanAmount: `$${rand(150, 750) * 1000}`,
                creditScore: pick(['Excellent (750+)', 'Good (700-749)', 'Fair (650-699)']),
                occupancy: pick(['Primary Residence', 'Second Home', 'Investment Property']),
            };
        case 'insurance':
            return {
                coverageType: pick(['Full Coverage', 'Liability Only', 'Comprehensive']),
                currentCarrier: pick(['State Farm', 'Allstate', 'Progressive', 'None']),
                claimsHistory: pick(['No claims', '1 claim', '2+ claims']),
            };
        case 'real_estate':
            return {
                propertyType: pick(['Single Family', 'Condo', 'Townhouse', 'Land']),
                transactionType: pick(['Buying', 'Selling', 'Both']),
                priceRange: `$${rand(150, 500) * 1000}-$${rand(500, 1200) * 1000}`,
                timeline: pick(['Immediately', '1-3 months', '3-6 months']),
            };
        case 'roofing':
            return {
                roofType: pick(['Asphalt Shingle', 'Metal', 'Tile']),
                roofAge: `${rand(5, 35)} years`,
                projectType: pick(['Full Replacement', 'Repair', 'Inspection']),
                urgency: pick(['Emergency', 'This week', 'Flexible']),
            };
        case 'hvac':
            return {
                serviceType: pick(['Installation', 'Repair', 'Maintenance']),
                systemAge: `${rand(3, 20)} years`,
                propertyType: pick(['Single Family', 'Condo', 'Commercial']),
                urgency: pick(['Emergency', 'This week', 'Flexible']),
            };
        case 'legal':
            return {
                caseType: pick(['Personal Injury', 'Family Law', 'Criminal Defense', 'Estate Planning']),
                urgency: pick(['Emergency', 'This week', 'Flexible']),
                consultationType: pick(['In-person', 'Virtual', 'Phone']),
            };
        case 'financial_services':
            return {
                serviceType: pick(['Tax Planning', 'Retirement Planning', 'Wealth Management']),
                investmentRange: pick(['<$50K', '$50K-$250K', '$250K-$1M', '$1M+']),
                timeline: pick(['Immediately', '1-3 months', 'Long-term planning']),
            };
        default:
            return { serviceType: 'General', urgency: 'Flexible' };
    }
}

/** Ensure a demo seller user + profile exists, return sellerId */
export async function ensureDemoSeller(walletAddress: string): Promise<string> {
    let seller = await prisma.sellerProfile.findFirst({
        where: { user: { walletAddress } },
    });
    if (seller) return seller.id;

    let user = await prisma.user.findFirst({ where: { walletAddress } });
    if (!user) {
        user = await prisma.user.create({
            data: {
                walletAddress,
                role: 'SELLER',
                sellerProfile: {
                    create: {
                        companyName: 'Demo Seller Co.',
                        verticals: FALLBACK_VERTICALS,
                        isVerified: true,
                        kycStatus: 'VERIFIED',
                    },
                },
            },
            include: { sellerProfile: true },
        });
        seller = (user as any).sellerProfile;
    } else {
        seller = await prisma.sellerProfile.create({
            data: {
                userId: user.id,
                companyName: 'Demo Seller Co.',
                verticals: FALLBACK_VERTICALS,
                isVerified: true,
                kycStatus: 'VERIFIED',
            },
        });
    }

    if (!seller) throw new Error('Failed to create demo seller profile');
    return seller.id;
}

/** Create a single demo lead and emit marketplace:lead:new */
export async function injectOneLead(
    io: SocketServer,
    sellerId: string,
    index: number,
): Promise<void> {
    const vertical = DEMO_VERTICALS[index % DEMO_VERTICALS.length];
    const geo = GEOS[index % GEOS.length];
    const reservePrice = rand(12, 45);
    const params = buildDemoParams(vertical);
    const paramCount = Object.keys(params).filter(k => params[k] != null && params[k] !== '').length;
    const scoreInput: LeadScoringInput = {
        tcpaConsentAt: new Date(),
        geo: { country: geo.country, state: geo.state, zip: `${rand(10000, 99999)}` },
        hasEncryptedData: false,
        encryptedDataValid: false,
        parameterCount: paramCount,
        source: 'PLATFORM',
        zipMatchesState: false,
    };
    const qualityScore = computeCREQualityScore(scoreInput);
    const auctionDurationSecs = LEAD_AUCTION_DURATION_SECS;
    // Fix 1: runtime assertion — every demo lead MUST have a full 60s auction.
    if (auctionDurationSecs < 60) {
        throw new Error(`[DRIP] auctionDurationSecs=${auctionDurationSecs} < 60 — check LEAD_AUCTION_DURATION_SECS env var`);
    }

    const lead = await prisma.lead.create({
        data: {
            sellerId,
            vertical,
            geo: { country: geo.country, state: geo.state, city: geo.city } as any,
            source: 'DEMO',
            status: 'IN_AUCTION',
            reservePrice,
            isVerified: true,
            qualityScore,
            tcpaConsentAt: new Date(),
            auctionStartAt: new Date(),
            auctionEndAt: new Date(Date.now() + auctionDurationSecs * 1000),
            parameters: params as any,
        },
    });

    await prisma.auctionRoom.create({
        data: {
            leadId: lead.id,
            roomId: `auction_${lead.id}`,
            phase: 'BIDDING',
            biddingEndsAt: new Date(Date.now() + auctionDurationSecs * 1000),
            revealEndsAt: new Date(Date.now() + auctionDurationSecs * 1000),
        },
    });

    const auctionEndMs = lead.auctionEndAt!.getTime();
    const serverTs = Date.now();
    const remainingTime = Math.max(0, auctionEndMs - serverTs);

    io.emit('marketplace:lead:new', {
        lead: {
            id: lead.id,
            vertical,
            status: 'IN_AUCTION',
            reservePrice,
            geo: { country: geo.country, state: geo.state },
            isVerified: true,
            sellerId,
            auctionStartAt: lead.auctionStartAt?.toISOString(),
            auctionEndAt: lead.auctionEndAt?.toISOString(),
            parameters: params,
            qualityScore: qualityScore != null ? Math.floor(qualityScore / 100) : null,
            _count: { bids: 0 },
        },
    });

    // v10: Immediately broadcast auction:updated so the store gets a server-
    // authoritative liveRemainingMs baseline right away — not waiting for the
    // AuctionMonitor 12 s closing-window query (which would leave seeded leads
    // stuck with only a Date.now() estimate for their full 60 s lifetime).
    io.emit('auction:updated', {
        leadId: lead.id,
        remainingTime,
        serverTs,
        bidCount: 0,
        highestBid: null,
        isSealed: false,
    });

    // BUG-D fix: signal all tabs that a new lead is available so socketBridge
    // triggers a bulk-refresh from the REST API.
    const activeCount = await prisma.lead.count({
        where: { status: 'IN_AUCTION', auctionEndAt: { gt: new Date() } },
    });
    io.emit('leads:updated', { activeCount });

    // Kick off staggered buyer bids for this lead (non-blocking, fire-and-forget)
    _scheduleBuyerBids(io, lead.id, vertical, qualityScore ?? 0, reservePrice, lead.auctionEndAt!);
}

// ── Active Lead Minimum Top-Up (BUG-10) ──────────────

/**
 * Count how many leads are currently active in the marketplace:
 * status = 'IN_AUCTION' and auctionEndAt in the future.
 * @internal — exported for unit testing
 */
export async function countActiveLeads(): Promise<number> {
    return prisma.lead.count({
        where: {
            status: 'IN_AUCTION',
            auctionEndAt: { gt: new Date() },
        },
    });
}

/**
 * After each drip cycle (and after the initial burst), check the count of
 * currently active (IN_AUCTION, non-expired) leads. If below DEMO_MIN_ACTIVE_LEADS,
 * call injectOneLead() repeatedly until the minimum is restored or deadline passed.
 * @internal — exported for unit testing
 */
export async function checkActiveLeadsAndTopUp(
    io: SocketServer,
    sellerId: string,
    createdRef: { value: number },
    signal: AbortSignal,
    deadline: number,
): Promise<void> {
    if (signal.aborted || Date.now() >= deadline) return;

    let active: number;
    try {
        active = await countActiveLeads();
    } catch {
        return;
    }

    if (active >= DEMO_MIN_ACTIVE_LEADS) return;

    const needed = DEMO_MIN_ACTIVE_LEADS - active;
    emit(io, {
        ts: new Date().toISOString(),
        level: 'warn',
        message: `⚡ Active leads (${active}) below minimum (${DEMO_MIN_ACTIVE_LEADS}) — injecting ${needed} top-up lead(s)`,
    });

    for (let i = 0; i < needed && !signal.aborted && Date.now() < deadline; i++) {
        try {
            await injectOneLead(io, sellerId, createdRef.value);
            createdRef.value++;
            emit(io, {
                ts: new Date().toISOString(),
                level: 'info',
                message: `📋 Top-up lead #${createdRef.value} injected (active=${active + i + 1}/${DEMO_MIN_ACTIVE_LEADS})`,
            });
        } catch (err: any) {
            emit(io, {
                ts: new Date().toISOString(),
                level: 'warn',
                message: `⚠️ Top-up inject failed: ${(err?.message ?? 'unknown').slice(0, 80)}`,
            });
        }
        await sleep(300);
    }
}

// ── Staggered Lead Drip (Background) ──────────────

/**
 * Start a background drip that injects 1 new lead every 3–9 s (avg ~6 s).
 * Runs concurrently with vault cycles until the AbortSignal fires or
 * maxMinutes elapses.
 */
export function startLeadDrip(
    io: SocketServer,
    signal: AbortSignal,
    maxLeads: number = 0,
    maxMinutes: number = 30,
): { stop: () => void; promise: Promise<void> } {
    let stopped = false;
    const stop = () => { stopped = true; };

    const dripAvgMs = DEMO_LEAD_DRIP_INTERVAL_MS;
    const dripMinMs = Math.round(dripAvgMs * 0.67);
    const dripMaxMs = Math.round(dripAvgMs * 2.0);
    const dripMinSec = Math.round(dripMinMs / 1000);
    const dripMaxSec = Math.round(dripMaxMs / 1000);

    const promise = (async () => {
        const sellerId = await ensureDemoSeller(DEMO_SELLER_WALLET);
        const deadline = Date.now() + maxMinutes * 60 * 1000;
        let created = 0;

        emit(io, {
            ts: new Date().toISOString(),
            level: 'step',
            message: `📦 Starting lead drip — ${DEMO_INITIAL_LEADS} leads staggered naturally over ~35 s, then 1 every ${dripMinSec}–${dripMaxSec}s`,
        });

        // Staggered initial seeding — one lead every 1200–2500ms for a natural 20–30s one-by-one appearance
        for (let i = 0; i < DEMO_INITIAL_LEADS && !stopped && !signal.aborted; i++) {
            let auctionEndAtIso = 'N/A';
            try {
                await injectOneLead(io, sellerId, created);
                created++;
                // Compute auctionEndAt from what injectOneLead just stored in DB
                auctionEndAtIso = new Date(Date.now() + LEAD_AUCTION_DURATION_SECS * 1000).toISOString();
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'info',
                    message: `📋 Lead #${i + 1} dripped — auction ends at ${auctionEndAtIso}`,
                });
            } catch { /* non-fatal */ }
            // Random 2000–4000ms between initial leads for slow, visible one-by-one reveal (~35 s total)
            await sleep(2000 + Math.floor(Math.random() * 2000));
        }

        emit(io, {
            ts: new Date().toISOString(),
            level: 'info',
            message: `⚡ Initial drip complete — ${created} leads live in marketplace`,
        });

        const _createdRef = { value: created };
        await checkActiveLeadsAndTopUp(io, sellerId, _createdRef, signal, deadline);
        created = _createdRef.value;

        // Continuous drip
        while (
            (maxLeads === 0 || created < maxLeads) &&
            Date.now() < deadline &&
            !stopped &&
            !signal.aborted
        ) {
            const delayMs = rand(dripMinMs, dripMaxMs);
            const ticks = Math.ceil(delayMs / 1000);
            for (let t = 0; t < ticks && !stopped && !signal.aborted; t++) {
                await sleep(1000);
            }
            if (stopped || signal.aborted) break;

            try {
                await injectOneLead(io, sellerId, created);
                created++;
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'info',
                    message: `📋 Lead #${created} dripped into marketplace`,
                });
            } catch (err: any) {
                emit(io, {
                    ts: new Date().toISOString(),
                    level: 'warn',
                    message: `⚠️ Lead drip #${created + 1} failed: ${err.message?.slice(0, 80)}`,
                });
            }

            const _ref = { value: created };
            await checkActiveLeadsAndTopUp(io, sellerId, _ref, signal, deadline);
            created = _ref.value;
        }

        emit(io, {
            ts: new Date().toISOString(),
            level: 'success',
            message: `✅ Lead drip finished — ${created} leads added to marketplace`,
        });
    })();

    return { stop, promise };
}
