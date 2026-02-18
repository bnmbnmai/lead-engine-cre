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

// ── Contract Info (for frontend wagmi) ──────

router.get('/contract', async (_req, res: Response) => {
    try {
        res.json({
            address: vaultService.getContractAddress(),
            abi: vaultService.getContractAbi(),
        });
    } catch (error: any) {
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

router.post('/verify-por', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await vaultService.verifyReserves();
        res.json(result);
    } catch (error: any) {
        console.error('[VaultRoutes] verifyReserves error:', error.message);
        res.status(500).json({ error: 'Failed to verify reserves' });
    }
});

export default router;
