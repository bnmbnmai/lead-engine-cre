/**
 * Functions Service — Lead Engine CRE
 *
 * Wraps ethers.js interaction with the BountyMatcher contract for
 * on-chain attested bounty criteria matching via Chainlink Functions.
 *
 * Gracefully degrades when BOUNTY_MATCHER_ADDRESS is not configured
 * (returns null, caller falls back to in-memory matching).
 */

import { ethers } from 'ethers';

// ============================================
// Config
// ============================================

const BOUNTY_MATCHER_ADDRESS = process.env.BOUNTY_MATCHER_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

// Minimal ABI for BountyMatcher
const BOUNTY_MATCHER_ABI = [
    'function requestBountyMatch(bytes32 leadIdHash, string[] args) external returns (bytes32)',
    'function isMatchVerified(bytes32 leadIdHash) external view returns (bool)',
    'function getMatchResult(bytes32 leadIdHash) external view returns (tuple(bytes32 requestId, string[] matchedPoolIds, bool matchFound, uint8 status, uint40 requestedAt, uint40 fulfilledAt))',
    'function getMatchStatus(bytes32 leadIdHash) external view returns (uint8)',
    'event BountyMatchCompleted(bytes32 indexed leadIdHash, bytes32 indexed requestId, bool matchFound, uint256 matchedCount)',
];

// ============================================
// Service
// ============================================

/**
 * Check if Functions-based bounty matching is available.
 */
export function isFunctionsConfigured(): boolean {
    return !!(BOUNTY_MATCHER_ADDRESS && DEPLOYER_KEY);
}

/**
 * Request Chainlink Functions to evaluate bounty criteria for a lead.
 *
 * @param leadId       Platform lead ID
 * @param leadAttrs    Lead attributes for matching
 * @param criteria     Array of pool criteria objects
 * @returns Transaction hash, or null if Functions not configured
 */
export async function requestBountyMatch(
    leadId: string,
    leadAttrs: {
        qualityScore: number;
        creditScore: number;
        geoState: string;
        geoCountry: string;
        leadAgeHours: number;
    },
    criteria: Array<{
        poolId: string;
        minQualityScore?: number;
        geoStates?: string[];
        geoCountries?: string[];
        minCreditScore?: number;
        maxLeadAge?: number;
    }>
): Promise<string | null> {
    if (!isFunctionsConfigured()) {
        console.warn('[Functions] Not configured — skipping bounty match request');
        return null;
    }

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const signer = new ethers.Wallet(DEPLOYER_KEY, provider);
        const contract = new ethers.Contract(BOUNTY_MATCHER_ADDRESS, BOUNTY_MATCHER_ABI, signer);

        const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes(leadId));

        // Build args array matching BountyMatcher contract spec
        const args = [
            leadId,
            String(leadAttrs.qualityScore),
            String(leadAttrs.creditScore),
            leadAttrs.geoState || '',
            leadAttrs.geoCountry || '',
            String(Math.round(leadAttrs.leadAgeHours)),
            JSON.stringify(criteria),
        ];

        const tx = await contract.requestBountyMatch(leadIdHash, args);
        const receipt = await tx.wait();

        console.log(`[Functions] Bounty match requested for ${leadId} (${criteria.length} pools), tx: ${receipt.hash}`);
        return receipt.hash;
    } catch (err: any) {
        console.error(`[Functions] requestBountyMatch failed for ${leadId}:`, err.message);
        return null;
    }
}

/**
 * Wait for Functions match result with polling.
 *
 * @param leadId     Platform lead ID
 * @param timeoutMs  Max wait time (default 30s)
 * @param pollMs     Poll interval (default 2s)
 * @returns Match result, or null if timeout/error
 */
export async function waitForMatchResult(
    leadId: string,
    timeoutMs: number = 30_000,
    pollMs: number = 2_000
): Promise<{ matchedPoolIds: string[]; matchFound: boolean } | null> {
    if (!isFunctionsConfigured()) return null;

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(BOUNTY_MATCHER_ADDRESS, BOUNTY_MATCHER_ABI, provider);
        const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes(leadId));

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const status = await contract.getMatchStatus(leadIdHash);

            // FULFILLED (2) — return results
            if (Number(status) === 2) {
                const result = await contract.getMatchResult(leadIdHash);
                console.log(`[Functions] Match result for ${leadId}: found=${result.matchFound}, pools=${result.matchedPoolIds.length}`);
                return {
                    matchedPoolIds: result.matchedPoolIds as string[],
                    matchFound: result.matchFound as boolean,
                };
            }

            // FAILED (3) — DON error, return immediately instead of polling
            if (Number(status) === 3) {
                console.warn(`[Functions] DON returned error for ${leadId}, falling back`);
                return null;
            }

            await new Promise(r => setTimeout(r, pollMs));
        }

        console.warn(`[Functions] Timeout waiting for match result of ${leadId} after ${timeoutMs}ms`);
        return null;
    } catch (err: any) {
        console.error(`[Functions] waitForMatchResult failed for ${leadId}:`, err.message);
        return null;
    }
}

/**
 * Read existing match result (non-blocking).
 */
export async function getMatchResult(leadId: string): Promise<{
    matchedPoolIds: string[];
    matchFound: boolean;
} | null> {
    if (!isFunctionsConfigured()) return null;

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(BOUNTY_MATCHER_ADDRESS, BOUNTY_MATCHER_ABI, provider);
        const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes(leadId));

        const result = await contract.getMatchResult(leadIdHash);
        if (result.status !== 2) return null; // Not FULFILLED (0=NONE, 1=PENDING, 2=FULFILLED, 3=FAILED)

        return {
            matchedPoolIds: result.matchedPoolIds as string[],
            matchFound: result.matchFound as boolean,
        };
    } catch (err: any) {
        console.error(`[Functions] getMatchResult failed for ${leadId}:`, err.message);
        return null;
    }
}
