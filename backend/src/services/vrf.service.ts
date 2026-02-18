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
