/**
 * vault-reconciliation.service.ts
 *
 * EscrowVault DB ↔ on-chain reconciliation job (P2-EscrowReconciliation).
 *
 * Runs every 5 minutes in production via node-cron (falls back to setInterval).
 * For each user with a non-zero DB vault balance, calls vault.service.ts's
 * reconcileVaultBalance() and emits an ace:dev-log alert for any drift > $0.01.
 *
 * Exports:
 *   - reconcileAll()                — full scan of all active vault holders
 *   - startVaultReconciliationJob() — start the 5-minute cron (idempotent)
 *   - stopVaultReconciliationJob()  — stop the job (for clean teardown in tests)
 */

import { prisma } from '../lib/prisma';
import { aceDevBus } from './ace.service';
import { reconcileVaultBalance } from './vault.service';

// ── Constants ─────────────────────────────────────────

export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const DRIFT_THRESHOLD_USD = 0.01;             // alert if drift > $0.01
const CRON_EXPRESSION = '*/5 * * * *';               // every 5 minutes

// ── Types ─────────────────────────────────────────────

export interface ReconcileReport {
    scanned: number;
    synced: number;
    drifted: number;
    errors: number;
    driftDetails: DriftRecord[];
    durationMs: number;
    completedAt: string;
}

export interface DriftRecord {
    userAddress: string;
    dbBalance: number;
    onChainBalance: number;
    drift: number;
    driftUsd: string;
}

// ── Core Logic ────────────────────────────────────────

/**
 * Reconcile all users that have a non-zero EscrowVault.balance.
 * For each, calls reconcileVaultBalance(walletAddress) and aggregates results.
 * Emits a 'ace:dev-log' ALERT event for each drifted address and a summary
 * event on completion.
 */
export async function reconcileAll(): Promise<ReconcileReport> {
    const startedAt = Date.now();

    const report: ReconcileReport = {
        scanned: 0,
        synced: 0,
        drifted: 0,
        errors: 0,
        driftDetails: [],
        durationMs: 0,
        completedAt: '',
    };

    // Fetch all users that have a vault record with balance > 0
    let vaults: Array<{ userId: string; balance: any }> = [];
    try {
        vaults = await prisma.escrowVault.findMany({
            where: { balance: { gt: 0 } },
            select: { userId: true, balance: true },
        });
    } catch (err: any) {
        console.error('[VaultRecon] DB query failed during reconcileAll:', err.message);
        report.errors++;
        report.durationMs = Date.now() - startedAt;
        report.completedAt = new Date().toISOString();
        return report;
    }

    // Fetch wallet addresses for all vaulted users in one query
    const userIds = vaults.map((v) => v.userId);
    let users: Array<{ id: string; walletAddress: string | null }> = [];
    try {
        users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, walletAddress: true },
        });
    } catch (err: any) {
        console.error('[VaultRecon] User lookup failed during reconcileAll:', err.message);
        report.errors++;
        report.durationMs = Date.now() - startedAt;
        report.completedAt = new Date().toISOString();
        return report;
    }

    const walletById = new Map(users.map((u) => [u.id, u.walletAddress]));

    // Process each vault holder sequentially (RPC-safe — no burst)
    for (const vault of vaults) {
        const wallet = walletById.get(vault.userId);
        if (!wallet) continue; // no wallet, skip

        report.scanned++;

        try {
            const result = await reconcileVaultBalance(wallet);

            if (result.error && result.error !== 'VAULT_ADDRESS not configured') {
                report.errors++;
                continue;
            }

            if (result.synced) {
                report.synced++;
            } else if (result.drift >= DRIFT_THRESHOLD_USD) {
                report.drifted++;
                const record: DriftRecord = {
                    userAddress: wallet,
                    dbBalance: result.dbBalance,
                    onChainBalance: result.onChainBalance,
                    drift: result.drift,
                    driftUsd: result.driftUsd,
                };
                report.driftDetails.push(record);

                // Alert on ace:dev-log bus
                aceDevBus.emit('ace:dev-log', {
                    ts: new Date().toISOString(),
                    action: 'vault:reconcile-drift-alert',
                    severity: 'ALERT',
                    userAddress: wallet,
                    dbBalance: result.dbBalance,
                    onChainBalance: result.onChainBalance,
                    drift: result.drift,
                    driftUsd: result.driftUsd,
                    message: `⚠️ EscrowVault balance drift detected for ${wallet}: DB=$${result.dbBalance.toFixed(2)}, on-chain=$${result.onChainBalance.toFixed(2)}, drift=${result.driftUsd}`,
                });
            } else {
                report.synced++; // drift < threshold — treat as synced
            }
        } catch (err: any) {
            console.error(`[VaultRecon] reconcileVaultBalance failed for ${wallet}:`, err.message);
            report.errors++;
        }
    }

    report.durationMs = Date.now() - startedAt;
    report.completedAt = new Date().toISOString();

    // Emit summary
    aceDevBus.emit('ace:dev-log', {
        ts: report.completedAt,
        action: 'vault:reconcile-summary',
        severity: report.drifted > 0 ? 'WARNING' : 'INFO',
        scanned: report.scanned,
        synced: report.synced,
        drifted: report.drifted,
        errors: report.errors,
        durationMs: report.durationMs,
        message: `[VaultRecon] Scan complete — ${report.scanned} scanned, ${report.synced} synced, ${report.drifted} drifted, ${report.errors} errors (${report.durationMs}ms)`,
    });

    console.log(
        `[VaultRecon] ${report.completedAt} — scanned=${report.scanned} synced=${report.synced} drifted=${report.drifted} errors=${report.errors} (${report.durationMs}ms)`
    );

    return report;
}

// ── Cron / Interval Scheduling ────────────────────────

let cronTask: { stop: () => void } | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let jobInitialized = false;

/**
 * Start the 5-minute vault reconciliation job.
 * Tries node-cron first; falls back to setInterval.
 * Idempotent — safe to call multiple times.
 * Only starts if NODE_ENV !== 'test'.
 */
export function startVaultReconciliationJob(): void {
    if (jobInitialized) return;
    if (process.env.NODE_ENV === 'test') return;

    let started = false;

    try {
        const cron = require('node-cron');
        cronTask = cron.schedule(CRON_EXPRESSION, async () => {
            console.log('[VaultRecon] Running scheduled reconciliation job...');
            await reconcileAll().catch((err: Error) =>
                console.error('[VaultRecon] Scheduled job error (non-fatal):', err.message)
            );
        });
        started = true;
        console.log('[VaultRecon] Scheduled vault reconciliation job (every 5 min via node-cron)');
    } catch {
        // node-cron not available — fall back to setInterval
    }

    if (!started) {
        intervalHandle = setInterval(async () => {
            console.log('[VaultRecon] Running scheduled reconciliation job (setInterval)...');
            await reconcileAll().catch((err: Error) =>
                console.error('[VaultRecon] Scheduled job error (non-fatal):', err.message)
            );
        }, RECONCILE_INTERVAL_MS);
        console.log('[VaultRecon] Scheduled vault reconciliation job (every 5 min via setInterval)');
    }

    jobInitialized = true;
}

/**
 * Stop the vault reconciliation job.
 * Used for clean shutdown in tests and graceful server teardown.
 */
export function stopVaultReconciliationJob(): void {
    if (cronTask) {
        cronTask.stop();
        cronTask = null;
    }
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
    jobInitialized = false;
}

/**
 * Returns true if the reconciliation job is currently scheduled.
 * Exported for test assertions.
 */
export function isVaultReconciliationJobRunning(): boolean {
    return jobInitialized;
}
