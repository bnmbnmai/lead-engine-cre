/**
 * BidService — THE single sealed-bid path (Phase B2).
 *
 * Every bid in the system flows through this service:
 *   - Human HTTP commit  → POST /api/v1/bids            → placeSealedBid()
 *   - Human socket bid   → socket 'bid:place'           → placeSealedBid()
 *   - Auto-bid engine    → auto-bid.service.ts          → placeSealedBid({ serverCustody })
 *   - LLM agents (MCP)   → mcp-server → POST /api/v1/bids → placeSealedBid()
 *   - Reveal             → POST /api/v1/bids/:id/reveal → revealSealedBid()
 *
 * Commitment scheme (domain-separated, v1):
 *   commitment = keccak256(abi.encode(
 *       bytes32 DOMAIN,            // keccak256("LEAD_ENGINE_SEALED_BID_V1")
 *       bytes32 keccak256(leadId), // listing binding
 *       bytes32 keccak256(buyerId),// bidder binding — prevents commitment replay
 *       uint96  amountUnits,       // USDC 6-decimals
 *       bytes32 salt,
 *   ))
 *
 * Binding the lead AND the bidder into the hash prevents two classic sealed-bid
 * attacks: replaying another bidder's observed commitment, and reusing your own
 * commitment across listings.
 *
 * Custody modes:
 *   - SEALED (humans/agents): only the commitment is stored at commit time. No
 *     amount ever crosses the wire or touches the DB pre-close. Vault funds are
 *     locked AT REVEAL (the amount is unknowable before), and the auction
 *     resolver waits for a reveal window before finalizing.
 *   - SERVER-CUSTODY (auto-bid engine): the server itself computes the bid, so
 *     it already knows the amount. It locks vault funds immediately and stores
 *     amount+salt for auto-reveal at close. Never broadcast pre-close.
 */
import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { aceService } from './ace.service';
import { applyHolderPerks, applyMultiplier } from './holder-perks.service';
import * as vaultService from './vault.service';

// ── Commitment scheme ─────────────────────────────────────────────────────

export const SEALED_BID_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes('LEAD_ENGINE_SEALED_BID_V1'));

const abi = ethers.AbiCoder.defaultAbiCoder();

function hashId(id: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(id));
}

/** USDC display units → 6-decimal integer units (uint96-safe). */
export function toAmountUnits(amount: number): bigint {
    return BigInt(Math.round(amount * 1e6));
}

/** Compute the v1 domain-separated sealed-bid commitment. */
export function computeBidCommitment(opts: {
    leadId: string;
    buyerId: string;
    amount: number;
    salt: string; // 0x-prefixed bytes32
}): string {
    return ethers.keccak256(
        abi.encode(
            ['bytes32', 'bytes32', 'bytes32', 'uint96', 'bytes32'],
            [SEALED_BID_DOMAIN, hashId(opts.leadId), hashId(opts.buyerId), toAmountUnits(opts.amount), opts.salt],
        ),
    );
}

/**
 * Verify a reveal against a stored commitment.
 * Accepts the v1 domain-separated scheme plus legacy formats produced before
 * this service existed (so in-flight bids stay revealable across the deploy):
 *   - legacy frontend: keccak256(abi.encode(uint96 amount*1e6, bytes32 salt))
 *   - legacy backend:  keccak256(abi.encode(uint96 amount,     bytes32 salt))
 */
export function verifyBidCommitment(
    commitment: string,
    opts: { leadId: string; buyerId: string; amount: number; salt: string },
): boolean {
    try {
        if (computeBidCommitment(opts) === commitment) return true;
        const saltBytes32 = opts.salt as `0x${string}`;
        const legacyScaled = ethers.keccak256(
            abi.encode(['uint96', 'bytes32'], [toAmountUnits(opts.amount), saltBytes32]),
        );
        if (legacyScaled === commitment) return true;
        if (Number.isInteger(opts.amount)) {
            const legacyRaw = ethers.keccak256(
                abi.encode(['uint96', 'bytes32'], [BigInt(opts.amount), saltBytes32]),
            );
            if (legacyRaw === commitment) return true;
        }
        return false;
    } catch {
        return false;
    }
}

/** Generate a cryptographically random bytes32 salt. */
export function generateSalt(): string {
    return ethers.hexlify(ethers.randomBytes(32));
}

// ── Reveal window ─────────────────────────────────────────────────────────

/**
 * How long after auctionEndAt buyers may reveal commit-only sealed bids
 * before the resolver finalizes. Server-custody bids auto-reveal, so the
 * window only delays closure when at least one commit-only bid exists.
 */
export const REVEAL_WINDOW_MS = Math.max(
    0,
    parseInt(process.env.SEALED_BID_REVEAL_WINDOW_MS || '60000', 10) || 0,
);

// ── Types ─────────────────────────────────────────────────────────────────

export type BidSourceKind = 'MANUAL' | 'AUTO_BID' | 'AGENT' | 'API';

export interface PlaceSealedBidOptions {
    leadId: string;
    buyerId: string;
    /** Wallet for compliance + vault operations (optional in demo/off-chain). */
    walletAddress?: string | null;
    /** v1 domain-separated commitment. Required unless serverCustody computes it. */
    commitment?: string;
    /**
     * Server-custody mode: the caller is a TRUSTED server path that already
     * knows the amount (auto-bid engine). The service computes the commitment,
     * locks vault funds now, and stores amount+salt for auto-reveal at close.
     */
    serverCustody?: { amount: number; salt?: string };
    source?: BidSourceKind;
    /** Skip ACE compliance (trusted internal callers that already checked). */
    skipCompliance?: boolean;
}

export interface PlaceSealedBidResult {
    ok: boolean;
    error?: string;
    statusCode?: number;
    bid?: { id: string; leadId: string; status: string; createdAt: Date };
    isNewBid?: boolean;
    isHolder?: boolean;
    holderMultiplier?: number;
    bidCount?: number;
}

export interface RevealSealedBidResult {
    ok: boolean;
    error?: string;
    statusCode?: number;
    bid?: { id: string; amount: number; effectiveBid: number; status: string; revealedAt: Date | null };
}

// ── Place (commit) ────────────────────────────────────────────────────────

export async function placeSealedBid(opts: PlaceSealedBidOptions): Promise<PlaceSealedBidResult> {
    const { leadId, buyerId, walletAddress, serverCustody } = opts;
    const source = opts.source ?? 'MANUAL';

    // ── Validate inputs: exactly one custody mode ──
    let commitment = opts.commitment;
    let salt: string | undefined;
    let amount: number | undefined;
    if (serverCustody) {
        amount = serverCustody.amount;
        if (!Number.isFinite(amount) || amount <= 0) {
            return { ok: false, statusCode: 400, error: 'Invalid server-custody amount' };
        }
        salt = serverCustody.salt ?? generateSalt();
        commitment = computeBidCommitment({ leadId, buyerId, amount, salt });
    } else if (!commitment || !/^0x[a-fA-F0-9]{64}$/.test(commitment)) {
        return { ok: false, statusCode: 400, error: 'Invalid commitment hash' };
    }

    // ── Auction-state gate (single source of truth for ALL paths) ──
    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: { auctionRoom: true },
    });
    if (!lead) return { ok: false, statusCode: 404, error: 'Lead not found' };
    if (lead.status !== 'IN_AUCTION') {
        return { ok: false, statusCode: 400, error: 'Lead is not in auction' };
    }
    if (lead.auctionEndAt && lead.auctionEndAt < new Date()) {
        return { ok: false, statusCode: 400, error: 'Auction has ended' };
    }

    // ── ACE compliance gate ──
    if (!opts.skipCompliance && walletAddress) {
        const compliance = await aceService.canTransact(
            walletAddress,
            lead.vertical,
            (lead.geo as any)?.geoHash || '',
        );
        if (!compliance.allowed) {
            return { ok: false, statusCode: 403, error: compliance.reason || 'Compliance check failed' };
        }
    }

    // ── Holder perks (flag recorded at commit; multiplier applied at reveal) ──
    const perks = await applyHolderPerks(lead.vertical, walletAddress ?? undefined);

    const existingBid = await prisma.bid.findUnique({
        where: { leadId_buyerId: { leadId, buyerId } },
        select: { id: true, escrowTxHash: true },
    });
    const isNewBid = !existingBid;

    // ── Vault lock (server-custody only — sealed bids lock at reveal) ──
    let vaultLockId: number | undefined;
    if (serverCustody && walletAddress) {
        // Re-bid: refund the previous lock first so funds are never orphaned
        if (existingBid?.escrowTxHash?.startsWith('vaultLock:')) {
            const oldLockId = parseInt(existingBid.escrowTxHash.split(':')[1], 10);
            if (oldLockId > 0) {
                try {
                    await vaultService.refundBid(oldLockId, buyerId, leadId);
                } catch (err: any) {
                    console.warn(`[BidService] Failed to refund old lock #${oldLockId} on re-bid: ${err.message}`);
                }
            }
        }
        const lockResult = await vaultService.lockForBid(walletAddress, amount!, buyerId, leadId);
        if (!lockResult.success) {
            return { ok: false, statusCode: 400, error: lockResult.error || 'Failed to lock vault funds' };
        }
        vaultLockId = lockResult.lockId;
    }

    // ── Persist (saga: compensating refund if the DB write fails post-lock) ──
    let bid;
    try {
        const effectiveBid = serverCustody && perks.isHolder
            ? applyMultiplier(amount!, perks.multiplier)
            : serverCustody ? amount! : null;
        bid = await prisma.bid.upsert({
            where: { leadId_buyerId: { leadId, buyerId } },
            create: {
                leadId,
                buyerId,
                commitment,
                amount: serverCustody ? amount : null,
                salt: serverCustody ? salt : null,
                effectiveBid,
                isHolder: perks.isHolder,
                escrowTxHash: vaultLockId ? `vaultLock:${vaultLockId}` : null,
                status: 'PENDING',
                source: source === 'AGENT' || source === 'API' ? 'AGENT' : source,
            },
            update: {
                commitment,
                amount: serverCustody ? amount : null,
                salt: serverCustody ? salt : null,
                effectiveBid,
                isHolder: perks.isHolder,
                escrowTxHash: vaultLockId ? `vaultLock:${vaultLockId}` : undefined,
                status: 'PENDING',
            },
        });
    } catch (dbErr) {
        if (vaultLockId) {
            try {
                await vaultService.refundBid(vaultLockId, buyerId, leadId);
                console.warn(`[BidService] DB bid write failed — compensating refund of vault lock #${vaultLockId} issued`);
            } catch (refundErr: any) {
                console.error(`[BidService] CRITICAL: orphaned vault lock #${vaultLockId} (refund failed: ${refundErr.message}) — needs reconciliation`);
            }
        }
        throw dbErr;
    }

    // ── Auction room bookkeeping (new bids only) ──
    let bidCount = lead.auctionRoom?.bidCount ?? 0;
    if (lead.auctionRoom && isNewBid) {
        bidCount += 1;
        await prisma.auctionRoom.update({
            where: { id: lead.auctionRoom.id },
            data: { bidCount: { increment: 1 } },
        });
    }

    await prisma.analyticsEvent.create({
        data: {
            eventType: perks.isHolder ? 'holder_bid_committed' : 'bid_committed',
            entityType: 'bid',
            entityId: bid.id,
            userId: buyerId,
            metadata: { leadId, vertical: lead.vertical, source },
        },
    });

    return {
        ok: true,
        bid: { id: bid.id, leadId: bid.leadId, status: bid.status, createdAt: bid.createdAt },
        isNewBid,
        isHolder: perks.isHolder,
        holderMultiplier: perks.multiplier,
        bidCount,
    };
}

// ── Reveal ────────────────────────────────────────────────────────────────

export async function revealSealedBid(opts: {
    bidId: string;
    buyerId: string;
    amount: number;
    salt: string;
}): Promise<RevealSealedBidResult> {
    const { bidId, buyerId, amount, salt } = opts;

    const bid = await prisma.bid.findUnique({
        where: { id: bidId },
        include: { lead: { include: { auctionRoom: true } }, buyer: { select: { walletAddress: true } } },
    });
    if (!bid) return { ok: false, statusCode: 404, error: 'Bid not found' };
    if (bid.buyerId !== buyerId) return { ok: false, statusCode: 403, error: 'Not your bid' };
    if (bid.status !== 'PENDING') {
        return { ok: false, statusCode: 400, error: 'Bid already revealed or processed' };
    }
    if (bid.lead.auctionEndAt && bid.lead.auctionEndAt > new Date()) {
        return { ok: false, statusCode: 400, error: 'Auction still active — reveals open after close' };
    }
    if (REVEAL_WINDOW_MS > 0 && bid.lead.auctionEndAt) {
        const revealDeadline = new Date(bid.lead.auctionEndAt).getTime() + REVEAL_WINDOW_MS;
        if (Date.now() > revealDeadline && bid.lead.status !== 'IN_AUCTION') {
            return { ok: false, statusCode: 400, error: 'Reveal window has closed' };
        }
    }

    // ── Verify commitment (domain-separated v1 + legacy fallback) ──
    if (!bid.commitment || !verifyBidCommitment(bid.commitment, {
        leadId: bid.leadId,
        buyerId,
        amount,
        salt,
    })) {
        return { ok: false, statusCode: 400, error: 'Invalid reveal — commitment mismatch' };
    }

    // ── Reserve price gate ──
    if (bid.lead.reservePrice && amount < Number(bid.lead.reservePrice)) {
        await prisma.bid.update({
            where: { id: bid.id },
            data: { status: 'REJECTED', amount, salt, revealedAt: new Date() },
        });
        return { ok: false, statusCode: 400, error: 'Bid below reserve price' };
    }

    // ── Vault lock at reveal ──
    // Sealed bids cannot lock at commit (amount unknown). Lock now so the
    // settlement pipeline (settle winner / refund losers via vaultLock:N)
    // works identically for sealed and server-custody bids.
    let vaultLockId: number | undefined;
    const walletAddress = bid.buyer?.walletAddress;
    const alreadyLocked = bid.escrowTxHash?.startsWith('vaultLock:');
    if (walletAddress && !alreadyLocked) {
        const lockResult = await vaultService.lockForBid(walletAddress, amount, buyerId, bid.leadId);
        if (!lockResult.success) {
            await prisma.bid.update({
                where: { id: bid.id },
                data: { status: 'REJECTED', amount, salt, revealedAt: new Date() },
            });
            return {
                ok: false,
                statusCode: 400,
                error: `Reveal rejected — vault lock failed: ${lockResult.error || 'insufficient funds'}`,
            };
        }
        vaultLockId = lockResult.lockId;
    }

    // ── Apply holder multiplier and mark revealed ──
    const perks = await applyHolderPerks(bid.lead.vertical, walletAddress ?? undefined);
    const effectiveBid = perks.isHolder ? applyMultiplier(amount, perks.multiplier) : amount;

    let updatedBid;
    try {
        updatedBid = await prisma.bid.update({
            where: { id: bid.id },
            data: {
                amount,
                salt,
                effectiveBid,
                isHolder: perks.isHolder,
                status: 'REVEALED',
                revealedAt: new Date(),
                escrowTxHash: vaultLockId ? `vaultLock:${vaultLockId}` : undefined,
            },
        });
    } catch (dbErr) {
        if (vaultLockId) {
            try {
                await vaultService.refundBid(vaultLockId, buyerId, bid.leadId);
            } catch (refundErr: any) {
                console.error(`[BidService] CRITICAL: orphaned vault lock #${vaultLockId} after reveal DB failure: ${refundErr.message}`);
            }
        }
        throw dbErr;
    }

    await prisma.analyticsEvent.create({
        data: {
            eventType: 'bid_revealed',
            entityType: 'bid',
            entityId: bid.id,
            userId: buyerId,
            metadata: { leadId: bid.leadId },
        },
    });

    return {
        ok: true,
        bid: {
            id: updatedBid.id,
            amount: Number(updatedBid.amount),
            effectiveBid: Number(updatedBid.effectiveBid ?? updatedBid.amount),
            status: updatedBid.status,
            revealedAt: updatedBid.revealedAt,
        },
    };
}

// ── Reveal-window helper for the auction resolver ─────────────────────────

/**
 * True when resolution must wait: at least one commit-only sealed bid is
 * still PENDING and the reveal window after auctionEndAt has not elapsed.
 */
export async function isAwaitingReveals(leadId: string, auctionEndAt: Date | null): Promise<boolean> {
    if (REVEAL_WINDOW_MS <= 0 || !auctionEndAt) return false;
    const windowEndsAt = new Date(auctionEndAt).getTime() + REVEAL_WINDOW_MS;
    if (Date.now() >= windowEndsAt) return false;
    // Only true 0x… hash commitments need a reveal; legacy base64 commitments
    // embed the amount and are auto-revealed by the resolver.
    const commitOnly = await prisma.bid.count({
        where: { leadId, status: 'PENDING', commitment: { startsWith: '0x' }, amount: null },
    });
    return commitOnly > 0;
}
