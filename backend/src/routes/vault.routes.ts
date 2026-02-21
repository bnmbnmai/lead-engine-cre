/**
 * Vault Routes — On-Chain PersonalEscrowVault
 *
 * GET  /api/buyer/vault             — Balance + transactions + PoR status
 * POST /api/buyer/vault/deposit     — Record on-chain deposit (txHash required)
 * GET  /api/buyer/vault/contract    — Contract address + ABI for frontend
 * GET  /api/buyer/vault/reserves    — Proof of Reserves status
 * POST /api/buyer/vault/verify-por  — Trigger manual PoR verification
 */

import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest, requireBuyer, requireAdmin } from '../middleware/auth';
import * as vaultService from '../services/vault.service';
import { reconcileAll } from '../services/vault-reconciliation.service';
import { prisma } from '../lib/prisma';

const router = Router();

// ── Get Vault Info ──────────────────────────

router.get('/', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const info = await vaultService.getVaultInfo(req.user!.id);
        res.json(info);
    } catch (error: any) {
        console.error('[VaultRoutes] getVaultInfo error:', error.message);
        res.status(500).json({ error: 'Failed to get vault info' });
    }
});

// ── Record Deposit (on-chain deposit already done via MetaMask) ──

router.post('/deposit', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { amount, txHash } = req.body;
        const numAmount = Number(amount);
        if (!numAmount || numAmount <= 0) {
            res.status(400).json({ error: 'Amount must be a positive number' });
            return;
        }
        if (!txHash) {
            res.status(400).json({ error: 'txHash required for on-chain deposit' });
            return;
        }

        const result = await vaultService.recordDeposit(req.user!.id, numAmount, txHash);
        res.json(result);
    } catch (error: any) {
        console.error('[VaultRoutes] deposit error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to record deposit' });
    }
});

// ── Withdraw (deduct from vault balance) ──────
// ⚠️  DB-ONLY: This records the withdrawal intent in the DB cache but does NOT
// call withdraw() on-chain. The user must sign and submit the on-chain tx
// from their wallet (wagmi/MetaMask). reconcileVaultBalance() runs in the
// background to detect drift and alert operators.

router.post('/withdraw', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { amount } = req.body;
        const numAmount = Number(amount || 0);
        if (numAmount < 0) {
            res.status(400).json({ error: 'Amount cannot be negative' });
            return;
        }

        // Use the explicit cache-withdraw function (not the deprecated alias)
        const result = await vaultService.recordCacheWithdraw(req.user!.id, numAmount);

        // Fire reconciliation async — don't block the response
        // This detects DB/on-chain drift caused by the DB-only write above
        const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
        if (user?.walletAddress) {
            vaultService.reconcileVaultBalance(user.walletAddress).catch((err: Error) =>
                console.warn('[VaultRoutes] reconcileVaultBalance failed (non-fatal):', err.message)
            );
        }

        res.json({
            ...result,
            warning: 'DB balance updated. Please sign and submit the on-chain withdraw() transaction from your wallet to sync on-chain state.',
        });
    } catch (error: any) {
        console.error('[VaultRoutes] withdraw error:', error.message);
        const status = error.message?.includes('Insufficient') ? 400 : 500;
        res.status(status).json({ error: error.message || 'Failed to withdraw' });
    }
});

// ── Contract Info (for frontend wagmi) ──────

router.get('/contract', async (_req, res: Response) => {
    try {
        res.json({
            address: vaultService.getContractAddress(),
            abi: vaultService.getContractAbi(),
        });
    } catch (_error: any) {
        res.status(500).json({ error: 'Failed to get contract info' });
    }
});

// ── Proof of Reserves ──────────────────────

router.get('/reserves', async (_req, res: Response) => {
    try {
        const { ethers } = await import('ethers');
        const address = vaultService.getContractAddress();
        if (!address) {
            res.status(503).json({ error: 'Vault contract not configured' });
            return;
        }
        const provider = new ethers.JsonRpcProvider(
            process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org'
        );
        const contract = new ethers.Contract(address, vaultService.getContractAbi(), provider);
        const [solvent, lastCheck, totalDep, totalWith] = await Promise.all([
            contract.lastPorSolvent(),
            contract.lastPorCheck(),
            contract.totalDeposited(),
            contract.totalWithdrawn(),
        ]);
        res.json({
            solvent,
            lastCheck: Number(lastCheck),
            totalDeposited: Number(totalDep) / 1e6,
            totalWithdrawn: Number(totalWith) / 1e6,
        });
    } catch (error: any) {
        console.error('[VaultRoutes] reserves error:', error.message);
        res.status(500).json({ error: 'Failed to get reserves' });
    }
});

router.post('/verify-por', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await vaultService.verifyReserves();
        // BUG-02 FIX: return 503 when solvent:false so callers get a clear HTTP error signal
        const status = result.solvent ? 200 : 503;
        res.status(status).json(result);
    } catch (error: any) {
        console.error('[VaultRoutes] verifyReserves error:', error.message);
        res.status(500).json({ error: 'Failed to verify reserves' });
    }
});

// ── Admin: Full Reconciliation (on-demand) ──────────
// POST /api/v1/vault/reconcile-all
// Requires ADMIN role. Scans all non-zero vault balances and reports drift.

router.post(
    '/reconcile-all',
    authMiddleware,
    requireAdmin,
    async (_req: AuthenticatedRequest, res: Response) => {
        try {
            const report = await reconcileAll();
            const status = report.drifted > 0 ? 207 : 200; // 207 Multi-Status if any drift
            res.status(status).json({
                success: true,
                report,
            });
        } catch (error: any) {
            console.error('[VaultRoutes] reconcile-all error:', error.message);
            res.status(500).json({ error: 'Reconciliation failed', detail: error.message });
        }
    }
);

export default router;
