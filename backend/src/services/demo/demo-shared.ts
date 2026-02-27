/**
 * demo-shared.ts — Shared constants, ABIs, types, and utility functions
 *
 * Internal module used by all demo sub-modules. Not part of the public API.
 * Centralises everything that would otherwise need to be duplicated or
 * cause circular imports between demo-lead-drip, demo-buyer-scheduler,
 * demo-vault-cycle, and demo-orchestrator.
 */

import { Server as SocketServer } from 'socket.io';
import { ethers } from 'ethers';
import { aceDevBus } from '../ace.service';
import {
    LEAD_AUCTION_DURATION_SECS,
    DEMO_LEAD_DRIP_INTERVAL_MS,
    DEMO_INITIAL_LEADS,
    DEMO_MIN_ACTIVE_LEADS,
} from '../../config/perks.env';

// Re-export perks constants so sub-modules import from one place
export { LEAD_AUCTION_DURATION_SECS, DEMO_LEAD_DRIP_INTERVAL_MS, DEMO_INITIAL_LEADS, DEMO_MIN_ACTIVE_LEADS };

// ── Config ─────────────────────────────────────────

export const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
export const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
export const _VAULT_ADDRESS_RAW = process.env.VAULT_ADDRESS_BASE_SEPOLIA || '';
export const VAULT_ADDRESS = _VAULT_ADDRESS_RAW;
export const USDC_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const DEMO_DEPLOYER_USDC_MIN_REQUIRED = 2500; // $2,500 — covers 10 buyers × $200 replenish target + $500 run buffer
export const MAX_CYCLES = 20; // hard upper-bound enforced in runFullDemo

export const BASESCAN_BASE = 'https://sepolia.basescan.org/tx/';

// Single canonical verticals list — do not duplicate
export const FALLBACK_VERTICALS = [
    'mortgage', 'solar', 'insurance', 'real_estate', 'roofing',
    'hvac', 'legal', 'financial_services',
];
/** @deprecated use FALLBACK_VERTICALS */
export const DEMO_VERTICALS = FALLBACK_VERTICALS;

export const GEOS: Array<{ country: string; state: string; city: string }> = [
    { country: 'US', state: 'CA', city: 'Los Angeles' },
    { country: 'US', state: 'TX', city: 'Houston' },
    { country: 'US', state: 'FL', city: 'Miami' },
    { country: 'US', state: 'NY', city: 'New York' },
    { country: 'US', state: 'IL', city: 'Chicago' },
    { country: 'US', state: 'AZ', city: 'Phoenix' },
    { country: 'US', state: 'WA', city: 'Seattle' },
    { country: 'US', state: 'CO', city: 'Denver' },
];

// Demo buyer wallets — 10 distinct faucet wallets (Wallets 1–10).
// None of these overlap with the seller wallet (Wallet 11).
export const DEMO_BUYER_WALLETS = [
    '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9', // Wallet 1
    '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC', // Wallet 2
    '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58', // Wallet 3
    '0x424CaC929939377f221348af52d4cb1247fE4379', // Wallet 4
    '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d', // Wallet 5
    '0x089B6Bdb4824628c5535acF60aBF80683452e862', // Wallet 6
    '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE', // Wallet 7
    '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C', // Wallet 8
    '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf', // Wallet 9
    '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad', // Wallet 10
];

// Demo seller wallet (Wallet 11 — dedicated, never overlaps with any buyer).
export const DEMO_SELLER_WALLET = '0x9Bb15F98982715E33a2113a35662036528eE0A36';
export const DEMO_SELLER_KEY = '0x618bee99ca60f5511dad533a998344f3a0a7b2339db5726ae33d56fd543294ce';

// Buyer persona wallet — used by /demo-login with role=BUYER (no connectedWallet).
// Must always match DEMO_WALLETS.BUYER in demo-panel.routes.ts.
export const BUYER_PERSONA_WALLET = DEMO_BUYER_WALLETS[3]; // 0x424CaC…

// ── Buyer private keys (Wallets 1–10, mirror of DEMO_BUYER_WALLETS order) ─────
// Source of truth: faucet-wallets.txt (gitignored, never committed).
// Deployer key is separate — loaded exclusively from process.env.DEPLOYER_PRIVATE_KEY.
export const DEMO_BUYER_KEYS: string[] = [
    '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439', // Wallet 1
    '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618', // Wallet 2
    '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e', // Wallet 3
    '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7', // Wallet 4
    '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7', // Wallet 5
    '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75', // Wallet 6
    '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510', // Wallet 7
    '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd', // Wallet 8
    '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c', // Wallet 9
    '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382', // Wallet 10
];

// ── ABIs ──────────────────────────────────────────

export const VAULT_ABI = [
    'function deposit(uint256 amount) external',
    'function withdraw(uint256 amount) external',
    'function balanceOf(address user) view returns (uint256)',
    'function lockedBalances(address user) view returns (uint256)',
    'function totalObligations() view returns (uint256)',
    'function lockForBid(address user, uint256 bidAmount) returns (uint256)',
    'function settleBid(uint256 lockId, address seller) external',
    'function refundBid(uint256 lockId) external',
    'function verifyReserves() returns (bool)',
    'function lastPorSolvent() view returns (bool)',
    'event BidLocked(uint256 indexed lockId, address indexed user, uint256 amount, uint256 fee)',
    'event BidSettled(uint256 indexed lockId, address indexed winner, address indexed seller, uint256 sellerAmount, uint256 platformCut, uint256 convenienceFee)',
    'event BidRefunded(uint256 indexed lockId, address indexed user, uint256 totalRefunded)',
    'event ReservesVerified(uint256 contractBalance, uint256 claimedTotal, bool solvent, uint256 timestamp)',
];

export const USDC_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
];

// ── Types ──────────────────────────────────────────

export interface DemoLogEntry {
    ts: string;
    level: 'info' | 'success' | 'warn' | 'error' | 'step';
    message: string;
    txHash?: string;
    basescanLink?: string;
    data?: Record<string, any>;
    cycle?: number;
    totalCycles?: number;
}

export interface CycleResult {
    cycle: number;           // sequential 1-based index within this run
    leadId?: string;         // lead UUID (for quality score lookup)
    vertical: string;
    buyerWallet: string;     // winner's wallet (kept for backward compat)
    buyerWallets: string[];  // all distinct bidder wallets
    bidAmount: number;
    lockIds: number[];
    winnerLockId: number;
    settleTxHash: string;
    refundTxHashes: string[];
    porSolvent: boolean;
    porTxHash: string;
    gasUsed: string;         // stored as string — BigInt not JSON-serialisable
    platformIncome?: number;   // (winningBid * 0.05) + $1 winner-only convenience fee
    hadTiebreaker?: boolean;   // true if 2+ buyers tied on highest bid
    vrfTxHash?: string;        // settle tx hash used as VRF-equivalent proof link
    nftTokenId?: number;       // LeadNFT token ID (for Basescan link)
    mintTxHash?: string;       // NFT mint tx hash
    txStatus?: string;         // 'confirmed' | 'pending'
}

export interface DemoResult {
    runId: string;
    startedAt: string;
    completedAt: string;
    cycles: CycleResult[];
    totalGas: string;
    totalSettled: number;
    status: 'completed' | 'aborted' | 'failed';
    error?: string;
    totalPlatformIncome?: number;
    totalTiebreakers?: number;
    vrfProofLinks?: string[];
    creQualityScores?: Record<number, number>; // cycle → real CRE quality score (0-100)
}

// ── Shared Deployer Provider + Nonce Queue ─────────

let _sharedProvider: ethers.JsonRpcProvider | null = null;
let _nonceChain: Promise<number> = Promise.resolve(-1);

export function getSharedProvider(): ethers.JsonRpcProvider {
    if (!_sharedProvider) {
        _sharedProvider = new ethers.JsonRpcProvider(RPC_URL);
    }
    return _sharedProvider;
}

export function getProvider() {
    return getSharedProvider();
}

export function getSigner() {
    if (!DEPLOYER_KEY) throw new Error('DEPLOYER_PRIVATE_KEY not set');
    return new ethers.Wallet(DEPLOYER_KEY, getSharedProvider());
}

/**
 * getNextNonce — serialises deployer nonce allocation.
 * Each caller awaits the previous call's promise before reading the
 * pending transaction count, so sequential increments are guaranteed.
 */
export async function getNextNonce(): Promise<number> {
    _nonceChain = _nonceChain.then(async () => {
        const provider = getSharedProvider();
        return provider.getTransactionCount(
            new ethers.Wallet(DEPLOYER_KEY).address, 'pending',
        );
    });
    return _nonceChain;
}

export function getVault(signer: ethers.Wallet) {
    if (!_VAULT_ADDRESS_RAW) {
        throw new Error('VAULT_ADDRESS_BASE_SEPOLIA environment variable not set. Add it to Render env vars before running the demo.');
    }
    return new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
}

export function getUSDC(signer: ethers.Wallet) {
    return new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
}

// ── Utility helpers ────────────────────────────────

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function rand(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Socket helpers ─────────────────────────────────

export function emit(io: SocketServer, entry: DemoLogEntry) {
    // Add basescan link if txHash present
    if (entry.txHash && !entry.basescanLink) {
        entry.basescanLink = `${BASESCAN_BASE}${entry.txHash}`;
    }

    // Emit to both channels so DevLogPanel shows it natively
    io.emit('demo:log', entry);

    // Also emit as ace:dev-log so it appears in the Chainlink Dev Log
    aceDevBus.emit('ace:dev-log', {
        ts: entry.ts,
        action: `demo:${entry.level}`,
        message: entry.message,
        txHash: entry.txHash,
        basescanLink: entry.basescanLink,
        source: 'demo-e2e',
        ...(entry.data || {}),
    });
}

/**
 * safeEmit — BigInt-safe Socket.IO emit.
 *
 * JSON.stringify throws on native BigInt values. Socket.IO calls JSON.stringify
 * internally, bypassing the global res.json() Express middleware.
 */
export function safeEmit(io: SocketServer, event: string, payload: unknown): void {
    try {
        const safe = JSON.parse(
            JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
        );
        io.emit(event, safe);
    } catch (err: any) {
        console.error(`[DEMO] safeEmit('${event}') fallback:`, err.message);
        try { io.emit(event, { error: `serialization failed: ${err.message}` }); } catch { /* give up */ }
    }
}

export function emitStatus(
    io: SocketServer,
    payload: {
        running: boolean;
        recycling?: boolean;
        currentCycle?: number;
        totalCycles?: number;
        percent?: number;
        phase?: string;
        runId?: string;
    },
) {
    io.emit('demo:status', {
        ...payload,
        recycling: payload.recycling ?? false,
        currentCycle: payload.currentCycle ?? 0,
        totalCycles: payload.totalCycles ?? 0,
        percent: payload.percent ?? 0,
        phase: payload.phase ?? (payload.running ? 'running' : 'idle'),
        ts: new Date().toISOString(),
    });
}

// ── Transaction Helper (with retry) ────────────────

export async function sendTx(
    io: SocketServer,
    label: string,
    txFn: () => Promise<any>,
    cycle?: number,
    totalCycles?: number,
    retries = 3,
): Promise<{ receipt: any; gasUsed: bigint }> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const tx = await txFn();
            const receipt = await tx.wait();

            emit(io, {
                ts: new Date().toISOString(),
                level: 'success',
                message: `✅ ${label} — tx: ${receipt.hash.slice(0, 22)}… (gas: ${receipt.gasUsed.toString()})`,
                txHash: receipt.hash,
                cycle,
                totalCycles,
                data: { gasUsed: receipt.gasUsed.toString() },
            });

            return { receipt, gasUsed: receipt.gasUsed };
        } catch (err: any) {
            const msg = err?.shortMessage || err?.message || String(err);
            const isNoisyRpcError = msg.includes('replacement fee too low') || msg.includes('nonce has already been used');

            // [DEMO-REVERT] — decode full revert reason for Render log visibility
            if (!isNoisyRpcError) {
                const revertReason = err?.reason || err?.revert?.name || '';
                const revertData = err?.data || err?.error?.data || '';
                const errCode = err?.code || '';
                // Attempt to decode via ethers if raw hex revert data is present
                let decoded = revertReason;
                if (!decoded && revertData && typeof revertData === 'string' && revertData.startsWith('0x')) {
                    try {
                        const iface = new ethers.Interface(['error Error(string)', 'error Panic(uint256)']);
                        const parsed = iface.parseError(revertData);
                        decoded = parsed ? `${parsed.name}(${parsed.args.join(', ')})` : revertData;
                    } catch { decoded = revertData; }
                }
                console.error(
                    `[DEMO-REVERT] ${label} attempt ${attempt}/${retries} | ` +
                    `reason="${decoded || '(no revert data)'}" | ` +
                    `code=${errCode} | raw="${msg.slice(0, 160)}"`
                );
            }

            emit(io, {
                ts: new Date().toISOString(),
                level: isNoisyRpcError ? 'info' : 'warn',
                message: `${isNoisyRpcError ? 'ℹ️' : '⚠️'} ${label} attempt ${attempt}/${retries}: ${msg.slice(0, 120)}`,
                cycle,
                totalCycles,
            });
            if (attempt === retries) throw err;
            await sleep(2000 * attempt);
        }
    }
    throw new Error(`${label} failed after ${retries} attempts`);
}

// ── Gas Escalation Fix ─────────────────────────────

export interface TxRequest extends ethers.TransactionRequest {
    nonce?: number;
}

/**
 * sendWithGasEscalation — wraps signer.sendTransaction with EIP-1559 retry logic.
 */
export async function sendWithGasEscalation(
    signer: ethers.Wallet,
    txReq: TxRequest,
    label: string,
    log: (msg: string) => void,
    maxRetries = 2,
): Promise<ethers.TransactionResponse> {
    const provider = signer.provider as ethers.JsonRpcProvider;
    const PRIORITY_FEE = ethers.parseUnits('2', 'gwei');
    const BASE_MULTIPLIER = 1.1;
    const ESCALATION = 1.5;

    let multiplier = BASE_MULTIPLIER;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const pendingBlock = await provider.getBlock('pending');
        const feeData = await provider.getFeeData();
        const baseFee = pendingBlock?.baseFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits('1', 'gwei');
        const maxFee = BigInt(Math.ceil(Number(baseFee) * multiplier)) + PRIORITY_FEE;

        log(
            `Attempt ${attempt}/${maxRetries} — baseFee=${ethers.formatUnits(baseFee, 'gwei').slice(0, 6)} gwei, ` +
            `maxFee=${ethers.formatUnits(maxFee, 'gwei').slice(0, 6)} gwei [${label}]`,
        );

        try {
            return await signer.sendTransaction({
                ...txReq,
                maxPriorityFeePerGas: PRIORITY_FEE,
                maxFeePerGas: maxFee,
                type: 2,  // EIP-1559
            });
        } catch (err: any) {
            const msg: string = err.message ?? '';
            const isReplaceable = (
                msg.includes('replacement fee too low') ||
                msg.includes('already known') ||
                msg.includes('nonce too low') ||
                msg.includes('underpriced')
            );
            if (isReplaceable && attempt < maxRetries) {
                log(`⚠️ Gas too low on attempt ${attempt} (${msg.slice(0, 60)}) — escalating…`);
                multiplier = multiplier * ESCALATION;
                await new Promise(r => setTimeout(r, 400 * attempt));
                continue;
            }
            throw err;
        }
    }
    throw new Error(`sendWithGasEscalation: all ${maxRetries} attempts failed [${label}]`);
}
