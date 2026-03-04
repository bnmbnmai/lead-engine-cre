/**
 * Chainlink Automation Service — Lead Engine CRE
 *
 * Monitors Chainlink Automation upkeep registration for PersonalEscrowVault.
 * The vault contract already implements AutomationCompatibleInterface
 * (checkUpkeep / performUpkeep) for:
 *   - Proof-of-Reserves checks every 24 hours
 *   - Expired bid lock refunds after 7 days
 *
 * This service:
 *   1. Detects if an upkeep is registered (via AUTOMATION_UPKEEP_ID env var)
 *   2. Reports status to the console and ace:dev-log
 *   3. Allows vault-reconciliation to adjust its cron interval accordingly
 *      (5 min off-chain only → 30 min safety net when Automation is active)
 *
 * @see contracts/PersonalEscrowVault.sol (lines 348-395)
 */

import { ethers } from 'ethers';
import { aceDevBus } from './ace.service';

// ── Config ────────────────────────────────────────────

const AUTOMATION_UPKEEP_ID = process.env.AUTOMATION_UPKEEP_ID || '';
const VAULT_ADDRESS = process.env.VAULT_ADDRESS_BASE_SEPOLIA || process.env.PERSONAL_ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';

// Minimal ABI for on-chain status reads
const VAULT_AUTOMATION_ABI = [
    'function lastPorCheck() view returns (uint256)',
    'function lastPorSolvent() view returns (bool)',
    'function activeLockCount() view returns (uint256)',
];

// ── State ─────────────────────────────────────────────

let _automationActive = false;
let _initialized = false;

// ── Public API ────────────────────────────────────────

/**
 * Returns true if Chainlink Automation upkeep is registered.
 */
export function isAutomationActive(): boolean {
    return _automationActive;
}

/**
 * Returns the upkeep ID if configured, or empty string.
 */
export function getUpkeepId(): string {
    return AUTOMATION_UPKEEP_ID;
}

/**
 * Initialize automation detection.
 * Call once at server startup (before vault reconciliation starts).
 */
export async function initAutomationService(): Promise<void> {
    if (_initialized) return;
    _initialized = true;

    if (!AUTOMATION_UPKEEP_ID) {
        console.log('[Automation] ℹ️ No AUTOMATION_UPKEEP_ID configured — Chainlink Automation NOT active');
        console.log('[Automation] ℹ️ Vault PoR and expired-bid refunds will run via off-chain cron (5 min interval)');
        aceDevBus.emit('ace:dev-log', {
            ts: new Date().toISOString(),
            action: 'automation:status',
            active: false,
            message: 'Chainlink Automation not configured — using off-chain cron for PoR + refunds',
        });
        return;
    }

    _automationActive = true;
    console.log(`[Automation] ✅ Chainlink Automation ACTIVE — upkeep ID: ${AUTOMATION_UPKEEP_ID}`);
    console.log(`[Automation] ✅ PersonalEscrowVault (${VAULT_ADDRESS}) monitored for PoR + expired lock refunds`);
    console.log('[Automation] ✅ Off-chain vault reconciliation will run at reduced 30-min interval as safety net');

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'automation:status',
        active: true,
        upkeepId: AUTOMATION_UPKEEP_ID,
        vaultAddress: VAULT_ADDRESS,
        message: `✅ Chainlink Automation active — upkeep ${AUTOMATION_UPKEEP_ID} monitors PoR + refunds`,
    });

    // Read last PoR status from contract for startup log
    if (VAULT_ADDRESS && RPC_URL) {
        try {
            const provider = new ethers.JsonRpcProvider(RPC_URL);
            const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_AUTOMATION_ABI, provider);
            const [lastPorCheck, lastPorSolvent, activeLocks] = await Promise.all([
                vault.lastPorCheck(),
                vault.lastPorSolvent(),
                vault.activeLockCount(),
            ]);

            const lastCheckDate = Number(lastPorCheck) > 0
                ? new Date(Number(lastPorCheck) * 1000).toISOString()
                : 'never';
            console.log(
                `[Automation] 📊 Last PoR: ${lastCheckDate}, solvent: ${lastPorSolvent}, `
                + `active locks: ${activeLocks.toString()}`
            );
        } catch (err: any) {
            console.warn('[Automation] ⚠️ Could not read vault status:', err.message?.slice(0, 100));
        }
    }
}

/**
 * Get automation status for health/debug endpoints.
 */
export function getAutomationStatus(): {
    active: boolean;
    upkeepId: string;
    vaultAddress: string;
    mode: string;
} {
    return {
        active: _automationActive,
        upkeepId: AUTOMATION_UPKEEP_ID,
        vaultAddress: VAULT_ADDRESS,
        mode: _automationActive ? 'chainlink-automation' : 'off-chain-cron',
    };
}
