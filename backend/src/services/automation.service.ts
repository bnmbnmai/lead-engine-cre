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
 * IMPORTANT: All env var reads are deferred to initAutomationService() to avoid
 * the dotenv race condition (this module is imported before dotenv.config() runs).
 *
 * @see contracts/PersonalEscrowVault.sol (lines 348-395)
 * @see contracts/PersonalEscrowVaultUpkeep.sol (dedicated upkeep contract)
 */

import { ethers } from 'ethers';
import { aceDevBus } from './ace.service';

// ── Minimal ABIs for on-chain reads ──────────────────

const VAULT_AUTOMATION_ABI = [
    'function lastPorCheck() view returns (uint256)',
    'function lastPorSolvent() view returns (bool)',
    'function activeLockCount() view returns (uint256)',
];

const UPKEEP_ABI = [
    'function lastUpkeepRun() view returns (uint256)',
    'function upkeepCount() view returns (uint256)',
    'function vault() view returns (address)',
];

// ── State ─────────────────────────────────────────────

let _automationActive = false;
let _initialized = false;
let _upkeepId = '';
let _upkeepContractAddress = '';
let _vaultAddress = '';

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
    return _upkeepId;
}

/**
 * Initialize automation detection.
 * Call once at server startup (AFTER dotenv.config() has run).
 *
 * Reads env vars at call time to avoid the dotenv race condition.
 */
export async function initAutomationService(): Promise<void> {
    if (_initialized) return;
    _initialized = true;

    // ── Read env vars NOW (after dotenv.config) ───────
    _upkeepId = process.env.AUTOMATION_UPKEEP_ID || '';
    _upkeepContractAddress = process.env.AUTOMATION_UPKEEP_CONTRACT_ADDRESS || '';
    _vaultAddress = process.env.VAULT_ADDRESS_BASE_SEPOLIA
        || process.env.PERSONAL_ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA || '';
    const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA
        || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';

    // ── Verbose startup logging ───────────────────────
    console.log('[Automation] ── Chainlink Automation Init ──────────────────');
    console.log(`[Automation]   AUTOMATION_UPKEEP_ID:              ${_upkeepId ? _upkeepId.slice(0, 12) + '…' + _upkeepId.slice(-4) : '(not set)'}`);
    console.log(`[Automation]   AUTOMATION_UPKEEP_CONTRACT_ADDRESS: ${_upkeepContractAddress || '(not set)'}`);
    console.log(`[Automation]   VAULT_ADDRESS:                      ${_vaultAddress || '(not set)'}`);
    console.log(`[Automation]   RPC_URL:                            ${rpcUrl.slice(0, 30)}…`);

    if (!_upkeepId) {
        console.log('[Automation] ℹ️  No AUTOMATION_UPKEEP_ID — Chainlink Automation NOT active');
        console.log('[Automation] ℹ️  Vault PoR and expired-bid refunds will run via off-chain cron (5 min interval)');
        aceDevBus.emit('ace:dev-log', {
            ts: new Date().toISOString(),
            action: 'automation:status',
            active: false,
            message: 'Chainlink Automation not configured — using off-chain cron for PoR + refunds',
        });
        return;
    }

    _automationActive = true;
    console.log(`[Automation] ✅ Chainlink Automation ACTIVE — upkeep ID: ${_upkeepId.slice(0, 16)}…`);
    console.log(`[Automation] ✅ PersonalEscrowVault (${_vaultAddress.slice(0, 10)}…) monitored for PoR + expired lock refunds`);
    console.log(`[Automation] ✅ Upkeep contract: ${_upkeepContractAddress || 'N/A'}`);
    console.log('[Automation] ✅ Off-chain vault reconciliation → reduced 30-min safety net');

    aceDevBus.emit('ace:dev-log', {
        ts: new Date().toISOString(),
        action: 'automation:status',
        active: true,
        upkeepId: _upkeepId,
        vaultAddress: _vaultAddress,
        upkeepContract: _upkeepContractAddress,
        message: `✅ Chainlink Automation active — upkeep monitors PoR + refunds`,
    });

    // ── Read on-chain state for startup diagnostics ───
    if (_vaultAddress && rpcUrl) {
        try {
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const vault = new ethers.Contract(_vaultAddress, VAULT_AUTOMATION_ABI, provider);
            const [lastPorCheck, lastPorSolvent, activeLocks] = await Promise.all([
                vault.lastPorCheck(),
                vault.lastPorSolvent(),
                vault.activeLockCount(),
            ]);

            const lastCheckDate = Number(lastPorCheck) > 0
                ? new Date(Number(lastPorCheck) * 1000).toISOString()
                : 'never';
            console.log(
                `[Automation] 📊 Vault PoR — last: ${lastCheckDate}, solvent: ${lastPorSolvent}, `
                + `active locks: ${activeLocks.toString()}`
            );
        } catch (err: any) {
            console.warn('[Automation] ⚠️  Could not read vault status:', err.message?.slice(0, 100));
        }
    }

    // ── Read upkeep contract state ────────────────────
    if (_upkeepContractAddress && rpcUrl) {
        try {
            const provider = new ethers.JsonRpcProvider(rpcUrl);
            const upkeep = new ethers.Contract(_upkeepContractAddress, UPKEEP_ABI, provider);
            const [lastRun, count, targetVault] = await Promise.all([
                upkeep.lastUpkeepRun(),
                upkeep.upkeepCount(),
                upkeep.vault(),
            ]);
            const lastRunDate = Number(lastRun) > 0
                ? new Date(Number(lastRun) * 1000).toISOString()
                : 'never';
            console.log(
                `[Automation] 📊 Upkeep stats — last run: ${lastRunDate}, `
                + `total runs: ${count.toString()}, target vault: ${targetVault}`
            );
        } catch (err: any) {
            console.warn('[Automation] ⚠️  Could not read upkeep contract:', err.message?.slice(0, 100));
        }
    }

    console.log('[Automation] ── Init complete ──────────────────────────────');
}

/**
 * Get automation status for health/debug endpoints.
 */
export function getAutomationStatus(): {
    active: boolean;
    upkeepId: string;
    upkeepContract: string;
    vaultAddress: string;
    mode: string;
} {
    return {
        active: _automationActive,
        upkeepId: _upkeepId,
        upkeepContract: _upkeepContractAddress,
        vaultAddress: _vaultAddress,
        mode: _automationActive ? 'chainlink-automation' : 'off-chain-cron',
    };
}
