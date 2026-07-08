import { keccak256, encodeAbiParameters, stringToBytes, toHex } from 'viem';
import { formatCurrency } from '@/lib/utils';
import api from '@/lib/api';

/**
 * Sealed-bid salt storage + commitment computation.
 *
 * SECURITY: salts + amounts are stored in sessionStorage (tab-scoped,
 * cleared when the tab closes) instead of localStorage. Anything in
 * localStorage persists across sessions/personas and is readable by any
 * script on the origin, which would let an XSS or a shared machine
 * recover bid amounts before reveal.
 *
 * A legacy localStorage fallback read (with migration) keeps bids placed
 * before this change revealable; new writes never touch localStorage.
 */

const keyFor = (commitment: string) => `bid_salt_${commitment}`;

export interface SealedBidRecord {
    amount: number;
    salt: string;
    /** Lead binding — enables auto-reveal lookups when the reveal phase opens. */
    leadId?: string;
}

// ── Commitment scheme (v1, domain-separated) ─────────────────────────────
// MUST stay byte-identical with backend/src/services/bid.service.ts:
//   keccak256(abi.encode(bytes32 DOMAIN, bytes32 keccak256(leadId),
//             bytes32 keccak256(buyerId), uint96 amount*1e6, bytes32 salt))
// Binding leadId + buyerId prevents commitment replay across bidders/listings.

const SEALED_BID_DOMAIN = keccak256(stringToBytes('LEAD_ENGINE_SEALED_BID_V1'));

export function generateBidSalt(): `0x${string}` {
    return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function computeSealedBidCommitment(opts: {
    leadId: string;
    buyerId: string;
    amount: number; // USDC display units
    salt: `0x${string}`;
}): `0x${string}` {
    return keccak256(
        encodeAbiParameters(
            [
                { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' },
                { type: 'uint96' }, { type: 'bytes32' },
            ],
            [
                SEALED_BID_DOMAIN,
                keccak256(stringToBytes(opts.leadId)),
                keccak256(stringToBytes(opts.buyerId)),
                BigInt(Math.round(opts.amount * 1e6)),
                opts.salt,
            ],
        ),
    );
}

/**
 * Auto-reveal all of this tab's sealed bids for a lead once the reveal
 * phase opens. Looks up the buyer's PENDING bid for the lead, matches it to
 * a locally stored commitment record, and POSTs the reveal. Safe to call
 * multiple times — already-revealed bids are skipped server-side.
 */
export async function autoRevealSealedBids(leadId: string): Promise<void> {
    try {
        const { data } = await api.getMyBids();
        const pending = (data?.bids ?? []).filter(
            (b: any) => b.leadId === leadId && b.status === 'PENDING' && b.commitment,
        );
        for (const bid of pending) {
            const record = getSealedBidRecord(bid.commitment);
            if (!record) continue; // committed from another tab/device — manual reveal
            try {
                await api.revealBid(bid.id, record.amount, record.salt);
                console.log(`[SealedBid] Auto-revealed bid ${bid.id} for lead ${leadId}`);
            } catch (err) {
                console.warn(`[SealedBid] Auto-reveal failed for bid ${bid.id}:`, err);
            }
        }
    } catch { /* network failure — user can reveal manually from the bid panel */ }
}

/** Persist the amount + salt for a sealed bid, keyed by commitment hash. */
export function storeSealedBid(commitment: string, record: SealedBidRecord): void {
    try {
        sessionStorage.setItem(keyFor(commitment), JSON.stringify(record));
    } catch { /* storage full / unavailable — bid still placed, reveal needs manual amount */ }
}

/** Retrieve the stored record for a commitment (sessionStorage, then legacy localStorage). */
export function getSealedBidRecord(commitment: string | undefined | null): SealedBidRecord | null {
    if (!commitment) return null;
    try {
        const fresh = sessionStorage.getItem(keyFor(commitment));
        if (fresh) {
            const parsed = JSON.parse(fresh);
            return typeof parsed?.amount === 'number' ? parsed : null;
        }
        // Legacy migration: move any pre-existing localStorage entry into
        // sessionStorage and delete the persistent copy.
        const legacy = localStorage.getItem(keyFor(commitment));
        if (legacy) {
            const parsed = JSON.parse(legacy);
            if (typeof parsed?.amount === 'number') {
                sessionStorage.setItem(keyFor(commitment), legacy);
                localStorage.removeItem(keyFor(commitment));
                return parsed;
            }
        }
        return null;
    } catch {
        return null;
    }
}

/** Remove all sealed-bid salts (call on logout / persona switch). */
export function clearSealedBidSalts(): void {
    try {
        for (const storage of [sessionStorage, localStorage]) {
            const stale: string[] = [];
            for (let i = 0; i < storage.length; i++) {
                const k = storage.key(i);
                if (k?.startsWith('bid_salt_')) stale.push(k);
            }
            stale.forEach((k) => storage.removeItem(k));
        }
    } catch { /* ignore */ }
}

/**
 * Retrieve the amount of a sealed bid. Returns null if not found.
 */
export function getSealedBidAmount(commitment: string | undefined | null): number | null {
    return getSealedBidRecord(commitment)?.amount ?? null;
}

/**
 * Format a sealed bid amount for display.
 * Returns a formatted string with 🔒 prefix, or 'Hidden' if amount unavailable.
 */
export function formatSealedBid(commitment: string | undefined | null): {
    display: string;
    amount: number | null;
    isRevealed: boolean;
} {
    const amount = getSealedBidAmount(commitment);
    if (amount !== null) {
        return { display: `🔒 ${formatCurrency(amount)}`, amount, isRevealed: true };
    }
    return { display: 'Hidden', amount: null, isRevealed: false };
}
