/**
 * Vault Routes
 *
 * GET  /api/buyer/vault           — Get balance + recent transactions
 * POST /api/buyer/vault/deposit   — Record a vault deposit
 * POST /api/buyer/vault/withdraw  — Withdraw from vault
 */

import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest, requireBuyer } from '../middleware/auth';
import * as vaultService from '../services/vault.service';

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

// ── Deposit ──────────────────────────────

router.post('/deposit', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { amount, txHash } = req.body;
        const numAmount = Number(amount);
        if (!numAmount || numAmount <= 0) {
            res.status(400).json({ error: 'Amount must be a positive number' });
            return;
        }

        const result = await vaultService.deposit(req.user!.id, numAmount, txHash);
        res.json(result);
    } catch (error: any) {
        console.error('[VaultRoutes] deposit error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to deposit' });
    }
});

// ── Withdraw ──────────────────────────────

router.post('/withdraw', authMiddleware, requireBuyer, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { amount } = req.body;
        const numAmount = Number(amount);
        if (!numAmount || numAmount <= 0) {
            res.status(400).json({ error: 'Amount must be a positive number' });
            return;
        }

        const result = await vaultService.withdraw(req.user!.id, numAmount);
        if (!result.success) {
            res.status(400).json({ error: result.error });
            return;
        }
        res.json(result);
    } catch (error: any) {
        console.error('[VaultRoutes] withdraw error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to withdraw' });
    }
});

export default router;
