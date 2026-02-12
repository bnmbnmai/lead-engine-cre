/**
 * Vertical Routes
 *
 * CRUD + hierarchy endpoints for hierarchical verticals.
 *
 * Public:   GET /hierarchy, GET /flat, GET /:slug, GET /:slug/compliance
 * Auth:     POST / (creates as PROPOSED for non-admin, ACTIVE for admin)
 * Admin:    PUT /:id, DELETE /:id
 */

import { Router, Response } from 'express';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { generalLimiter } from '../middleware/rateLimit';
import { VerticalCreateSchema, VerticalUpdateSchema, VerticalQuerySchema } from '../utils/validation';
import * as verticalService from '../services/vertical.service';
import { suggestVertical, listSuggestions } from '../services/vertical-optimizer.service';
import * as verticalNFTService from '../services/vertical-nft.service';
import * as auctionService from '../services/auction.service';
import { z } from 'zod';
import { NFT_FEATURES_ENABLED } from '../config/perks.env';

const router = Router();

// NFT feature guard — returns 501 when NFT features are disabled
function requireNFT(_req: AuthenticatedRequest, res: Response, next: () => void) {
    if (!NFT_FEATURES_ENABLED) {
        res.status(501).json({
            error: 'NFT features are disabled',
            resolution: 'Set NFT_FEATURES_ENABLED=true in your environment to enable NFT minting, auctions, and resale.',
        });
        return;
    }
    next();
}

// ============================================
// GET /hierarchy — Full vertical tree (cached)
// ============================================

router.get('/hierarchy', generalLimiter, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const tree = await verticalService.getHierarchy();
        res.json({ tree });
    } catch (error) {
        console.error('Get hierarchy error:', error);
        res.status(500).json({
            error: 'Failed to fetch vertical hierarchy',
            ...(process.env.NODE_ENV !== 'production' && { detail: String(error) }),
        });
    }
});

// ============================================
// GET /flat — Flat list with optional filters
// ============================================

router.get('/flat', generalLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = VerticalQuerySchema.safeParse(req.query);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid query', details: validation.error.issues });
            return;
        }

        const verticals = await verticalService.listFlat(validation.data);
        res.json({ verticals, total: verticals.length });
    } catch (error) {
        console.error('List flat verticals error:', error);
        res.status(500).json({ error: 'Failed to list verticals' });
    }
});

// ============================================
// POST /suggest — AI-powered vertical suggestion
// ============================================

const SuggestSchema = z.object({
    description: z.string().min(5).max(2000),
    vertical: z.string().max(200).optional(),
    leadId: z.string().max(100).optional(),
});

router.post('/suggest', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required' });
            return;
        }

        const validation = SuggestSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }

        const result = await suggestVertical(validation.data);
        res.json({ suggestion: result });
    } catch (error) {
        console.error('Suggest vertical error:', error);
        res.status(500).json({ error: 'Failed to generate suggestion' });
    }
});

// ============================================
// GET /suggestions — List pending suggestions (Admin)
// ============================================

router.get('/suggestions', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const status = req.query.status as string | undefined;
        const minHits = req.query.minHits ? parseInt(req.query.minHits as string) : undefined;

        const suggestions = await listSuggestions({ status, minHits });
        res.json({ suggestions, total: suggestions.length });
    } catch (error) {
        console.error('List suggestions error:', error);
        res.status(500).json({ error: 'Failed to list suggestions' });
    }
});

// ============================================
// GET /:slug — Single vertical + children
// ============================================

router.get('/:slug', generalLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { slug } = req.params;

        // Prevent matching named routes
        if (['hierarchy', 'flat', 'suggest', 'suggestions'].includes(slug)) {
            res.status(400).json({ error: 'Invalid slug' });
            return;
        }

        const vertical = await verticalService.getSubtree(slug);
        if (!vertical) {
            // Try alias resolution
            const resolved = await verticalService.resolveSlug(slug);
            if (resolved) {
                const subtree = await verticalService.getSubtree(resolved.slug);
                res.json({ vertical: subtree, resolvedFrom: slug });
                return;
            }
            res.status(404).json({ error: 'Vertical not found' });
            return;
        }
        res.json({ vertical });
    } catch (error) {
        console.error('Get vertical error:', error);
        res.status(500).json({ error: 'Failed to fetch vertical' });
    }
});

// ============================================
// GET /:slug/compliance — Merged compliance flags
// ============================================

router.get('/:slug/compliance', generalLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const flags = await verticalService.getComplianceFlags(req.params.slug);
        if (!flags) {
            res.status(404).json({ error: 'Vertical not found' });
            return;
        }
        res.json({ compliance: flags });
    } catch (error) {
        console.error('Get compliance flags error:', error);
        res.status(500).json({ error: 'Failed to fetch compliance flags' });
    }
});

// ============================================
// POST / — Create vertical
// Admin → ACTIVE, Auth → PROPOSED
// ============================================

router.post('/', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Must be authenticated
        if (!req.user) {
            res.status(401).json({ error: 'Authentication required to propose verticals' });
            return;
        }

        const validation = VerticalCreateSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }

        const isAdmin = req.user.role === 'ADMIN';
        const result = await verticalService.createVertical(validation.data, isAdmin);

        if (result.error) {
            res.status(400).json({ error: result.error });
            return;
        }

        res.status(201).json({
            vertical: result.vertical,
            status: isAdmin ? 'Created as ACTIVE' : 'Submitted for review (PROPOSED)',
        });
    } catch (error) {
        console.error('Create vertical error:', error);
        res.status(500).json({ error: 'Failed to create vertical' });
    }
});

// ============================================
// PUT /:id — Update vertical (Admin only)
// ============================================

router.put('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const validation = VerticalUpdateSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }

        const result = await verticalService.updateVertical(req.params.id, validation.data);
        if (result.error) {
            res.status(400).json({ error: result.error });
            return;
        }

        res.json({ vertical: result.vertical });
    } catch (error) {
        console.error('Update vertical error:', error);
        res.status(500).json({ error: 'Failed to update vertical' });
    }
});

// ============================================
// DELETE /:id — Delete vertical (Admin only)
// Requires ?confirm=true for cascade
// ============================================

router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const confirm = req.query.confirm === 'true';
        const result = await verticalService.deleteVertical(req.params.id, confirm);

        if (result.error) {
            const status = result.childCount ? 409 : 404;
            res.status(status).json({
                error: result.error,
                childCount: result.childCount,
                hint: result.childCount ? 'Add ?confirm=true to cascade delete' : undefined,
            });
            return;
        }

        res.json({ deleted: true });
    } catch (error) {
        console.error('Delete vertical error:', error);
        res.status(500).json({ error: 'Failed to delete vertical' });
    }
});

// ============================================
// PUT /:slug/activate — Activate vertical + mint NFT to platform wallet (Admin only)
// Runs: CRE verification → ACE compliance → Mint VerticalNFT → Update Prisma
// ============================================

router.put('/:slug/activate', authMiddleware, requireNFT, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Admin only
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const { slug } = req.params;

        // Run full activation pipeline (mints to platform wallet)
        const result = await verticalNFTService.activateVertical(slug);

        if (!result.success) {
            const statusCode = result.step === 'uniqueness' ? 409
                : result.step === 'compliance' ? 403
                    : 500;

            res.status(statusCode).json({
                error: result.error,
                step: result.step,
                // If mint succeeded but Prisma failed, return the on-chain data
                ...(result.tokenId && { tokenId: result.tokenId, txHash: result.txHash }),
            });
            return;
        }

        res.json({
            activated: true,
            tokenId: result.tokenId,
            txHash: result.txHash,
            slug,
        });
    } catch (error) {
        console.error('Activate vertical error:', error);
        res.status(500).json({ error: 'Failed to activate vertical' });
    }
});

// ============================================
// POST /:slug/resale — Resale vertical NFT to buyer (Admin only)
// Runs: ownership check → Chainlink pricing → royalty calc → transfer → update Prisma
// ============================================

const ResaleSchema = z.object({
    buyerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
    salePrice: z.number().positive('Sale price must be positive'),
});

router.post('/:slug/resale', authMiddleware, requireNFT, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Admin only
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        // Validate input
        const validation = ResaleSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
            return;
        }

        const { slug } = req.params;
        const { buyerAddress, salePrice } = validation.data;

        // Run full resale pipeline
        const result = await verticalNFTService.resaleVertical(slug, buyerAddress, salePrice);

        if (!result.success) {
            const statusCode = result.step === 'ownership' ? 409
                : result.step === 'pricing' ? 502
                    : result.step === 'transfer' ? 500
                        : 500;

            res.status(statusCode).json({
                error: result.error,
                step: result.step,
                ...(result.tokenId && { tokenId: result.tokenId, txHash: result.txHash }),
            });
            return;
        }

        res.json({
            transferred: true,
            tokenId: result.tokenId,
            txHash: result.txHash,
            buyer: result.buyer,
            salePrice: result.salePrice,
            royalty: result.royalty,
            priceSource: result.priceSource,
            slug,
        });
    } catch (error) {
        console.error('Resale vertical error:', error);
        res.status(500).json({ error: 'Failed to resale vertical' });
    }
});

// ============================================
// POST /:slug/auction — Create auction for platform-owned NFT (Admin only)
// ============================================

const AuctionCreateSchema = z.object({
    reservePrice: z.number().positive('Reserve price must be positive'),
    durationSecs: z.number().int().min(60).max(604800), // 1 min to 7 days
});

router.post('/:slug/auction', authMiddleware, requireNFT, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const validation = AuctionCreateSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }

        const { slug } = req.params;
        const { reservePrice, durationSecs } = validation.data;
        const result = await auctionService.createAuction(slug, reservePrice, durationSecs);

        if (!result.success) {
            res.status(400).json(result);
            return;
        }

        res.status(201).json(result);
    } catch (error) {
        console.error('Create auction error:', error);
        res.status(500).json({ error: 'Failed to create auction' });
    }
});

// ============================================
// POST /auctions/:id/bid — Place bid on auction (Auth)
// ============================================

const BidSchema = z.object({
    bidderAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
    amount: z.number().positive('Bid amount must be positive'),
});

router.post('/auctions/:id/bid', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = BidSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }

        const { id } = req.params;
        const { bidderAddress, amount } = validation.data;
        const result = await auctionService.placeBid(id, bidderAddress, amount);

        if (!result.success) {
            res.status(400).json(result);
            return;
        }

        res.json(result);
    } catch (error) {
        console.error('Place bid error:', error);
        res.status(500).json({ error: 'Failed to place bid' });
    }
});

// ============================================
// POST /auctions/:id/settle — Settle completed auction (Admin only)
// ============================================

router.post('/auctions/:id/settle', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const { id } = req.params;
        const result = await auctionService.settleAuction(id);

        if (!result.success) {
            res.status(400).json(result);
            return;
        }

        res.json(result);
    } catch (error) {
        console.error('Settle auction error:', error);
        res.status(500).json({ error: 'Failed to settle auction' });
    }
});

// ============================================
// GET /auctions — List active auctions (Public)
// ============================================

router.get('/auctions', generalLimiter, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const auctions = await auctionService.getActiveAuctions();
        res.json({ auctions });
    } catch (error) {
        console.error('List auctions error:', error);
        res.status(500).json({ error: 'Failed to list auctions' });
    }
});

export default router;
