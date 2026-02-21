/**
 * VRF Service — Lead Engine CRE
 *
 * Wraps ethers.js interaction with the VRFTieBreaker contract
 * for on-chain auction tie-breaking and bounty allocation.
 *
 * Gracefully degrades when VRF_TIE_BREAKER_ADDRESS is not configured
 * (returns null, caller falls back to deterministic ordering).
 */

import { ethers } from 'ethers';

// ============================================
// Config
// ============================================

const VRF_TIE_BREAKER_ADDRESS = process.env.VRF_TIE_BREAKER_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

// Minimal ABI for the functions we call
const VRF_TIE_BREAKER_ABI = [
    'function requestResolution(bytes32 leadIdHash, address[] candidates, uint8 resolveType) external returns (uint256)',
    'function getResolution(bytes32 leadIdHash) external view returns (tuple(uint256 requestId, uint8 resolveType, address[] candidates, address winner, uint256 randomWord, uint8 status))',
    'function isResolved(bytes32 leadIdHash) external view returns (bool)',
    'event TieResolved(bytes32 indexed leadIdHash, address indexed winner, uint256 indexed requestId, uint8 resolveType, uint256 randomWord)',
];

// Resolve types (must match Solidity enum)
export enum ResolveType {
    AUCTION_TIE = 0,
    BOUNTY_ALLOCATION = 1,
}

// ============================================
// Service
// ============================================

/**
 * Check if VRF tie-breaking is available.
 */
export function isVrfConfigured(): boolean {
    return !!(VRF_TIE_BREAKER_ADDRESS && DEPLOYER_KEY);
}

/**
 * Request VRF tie-break for a lead.
 *
 * @param leadId      Platform lead ID (will be hashed)
 * @param candidates  Array of wallet addresses (tied bidders or bounty pool owners)
 * @param resolveType AUCTION_TIE or BOUNTY_ALLOCATION
 * @returns Transaction hash, or null if VRF not configured
 */
export async function requestTieBreak(
    leadId: string,
    candidates: string[],
    resolveType: ResolveType
): Promise<string | null> {
    if (!isVrfConfigured()) {
        console.warn('[VRF] VRF not configured — skipping tie-break request');
        return null;
    }

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const signer = new ethers.Wallet(DEPLOYER_KEY, provider);
        const contract = new ethers.Contract(VRF_TIE_BREAKER_ADDRESS, VRF_TIE_BREAKER_ABI, signer);

        const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes(leadId));
        const tx = await contract.requestResolution(leadIdHash, candidates, resolveType);
        const receipt = await tx.wait();

        console.log(`[VRF] Tie-break requested for ${leadId} (${candidates.length} candidates), tx: ${receipt.hash}`);
        return receipt.hash;
    } catch (err: any) {
        console.error(`[VRF] requestTieBreak failed for ${leadId}:`, err.message);
        return null;
    }
}

/**
 * Wait for VRF resolution with polling.
 *
 * @param leadId     Platform lead ID
 * @param timeoutMs  Max wait time (default 30s)
 * @param pollMs     Poll interval (default 2s)
 * @returns Winner address, or null if timeout/error
 */
export async function waitForResolution(
    leadId: string,
    timeoutMs: number = 30_000,
    pollMs: number = 2_000
): Promise<string | null> {
    if (!isVrfConfigured()) return null;

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(VRF_TIE_BREAKER_ADDRESS, VRF_TIE_BREAKER_ABI, provider);
        const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes(leadId));

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const resolved = await contract.isResolved(leadIdHash);
            if (resolved) {
                const resolution = await contract.getResolution(leadIdHash);
                console.log(`[VRF] Resolution for ${leadId}: winner=${resolution.winner}, randomWord=${resolution.randomWord}`);
                return resolution.winner;
            }
            await new Promise(r => setTimeout(r, pollMs));
        }

        console.warn(`[VRF] Timeout waiting for resolution of ${leadId} after ${timeoutMs}ms`);
        return null;
    } catch (err: any) {
        console.error(`[VRF] waitForResolution failed for ${leadId}:`, err.message);
        return null;
    }
}

/**
 * Read existing resolution (non-blocking).
 *
 * @param leadId Platform lead ID
 * @returns Resolution data or null
 */
export async function getResolution(leadId: string): Promise<{
    winner: string;
    randomWord: bigint;
    resolveType: ResolveType;
} | null> {
    if (!isVrfConfigured()) return null;

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(VRF_TIE_BREAKER_ADDRESS, VRF_TIE_BREAKER_ABI, provider);
        const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes(leadId));

        const res = await contract.getResolution(leadIdHash);
        if (res.status !== 2) return null; // Not FULFILLED (0=NONE, 1=PENDING, 2=FULFILLED)

        return {
            winner: res.winner,
            randomWord: BigInt(res.randomWord),
            resolveType: res.resolveType as ResolveType,
        };
    } catch (err: any) {
        console.error(`[VRF] getResolution failed for ${leadId}:`, err.message);
        return null;
    }
}

// ============================================
// Non-Blocking Watcher (BUG-09)
// ============================================

/**
 * Start a background watcher for VRF resolution after a tie-break is requested.
 *
 * Design (BUG-09 fix):
 *   - Called AFTER requestTieBreak() returns (fire-and-forget).
 *   - Does NOT block auction closure — the closure loop already picked a
 *     deterministic fallback winner via createdAt ordering.
 *   - Polls `isResolved()` every pollMs until fulfilled or timeout.
 *   - On fulfillment: updates AuctionRoom.vrfWinner, emits
 *     'auction:vrf-resolved' so Judge View / demo display can refresh.
 *
 * @param leadId     Platform lead ID
 * @param tiedBidIds Bid DB IDs involved in the tie (for AuctionRoom update)
 * @param io         Socket.IO server instance (may be undefined in tests)
 * @param timeoutMs  Max wait time (default 90s — 3 VRF block confirmations)
 * @param pollMs     Poll interval (default 3s)
 */
export async function startVrfResolutionWatcher(
    leadId: string,
    io: { emit: (event: string, data: unknown) => void } | undefined,
    timeoutMs = 90_000,
    pollMs = 3_000,
): Promise<void> {
    if (!isVrfConfigured()) return;

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(VRF_TIE_BREAKER_ADDRESS, VRF_TIE_BREAKER_ABI, provider);
        const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes(leadId));
        const { prisma } = await import('../lib/prisma');

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, pollMs));

            const resolved = await contract.isResolved(leadIdHash);
            if (resolved) {
                const res = await contract.getResolution(leadIdHash);
                const vrfWinner: string = res.winner;
                const randomWord: bigint = BigInt(res.randomWord);
                const requestId: bigint = BigInt(res.requestId);

                console.log(
                    `[VRF] 🎲 BUG-09 watcher — lead=${leadId} VRF resolved.` +
                    ` winner=${vrfWinner} randomWord=${randomWord} requestId=${requestId}`
                );

                // Persist vrfWinner to AuctionRoom
                try {
                    await prisma.auctionRoom.updateMany({
                        where: { leadId },
                        data: { vrfWinner },
                    });
                } catch (dbErr: any) {
                    console.warn(`[VRF] Failed to persist vrfWinner for lead=${leadId}:`, dbErr.message);
                }

                // Emit socket event so Judge View / demo panel can display VRF provenance
                if (io) {
                    io.emit('auction:vrf-resolved', {
                        leadId,
                        vrfWinner,
                        requestId: requestId.toString(),
                        randomWord: randomWord.toString(),
                    });
                }

                return;
            }
        }

        console.warn(`[VRF] startVrfResolutionWatcher: timeout after ${timeoutMs}ms for lead=${leadId}`);
    } catch (err: any) {
        // Non-blocking — never propagate errors to the caller
        console.error(`[VRF] startVrfResolutionWatcher error for lead=${leadId}:`, err.message);
    }
}

