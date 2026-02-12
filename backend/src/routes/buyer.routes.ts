/**
 * Buyer Routes
 *
 * Authenticated buyer-facing endpoints for perks, preferences, and stats.
 */

import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { getPerksOverview } from '../services/perks-engine';

const router = Router();

// ============================================
// GET /perks-overview — holder perks + stats
// ============================================
router.get('/perks-overview', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const walletAddress = req.user?.walletAddress;

        const overview = await getPerksOverview(userId, walletAddress);
        res.json(overview);
    } catch (error) {
        console.error('[BUYER] perks-overview error:', error);
        res.status(500).json({ error: 'Failed to load perks overview' });
    }
});

export default router;
