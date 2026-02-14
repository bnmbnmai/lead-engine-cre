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
import { prisma } from '../lib/prisma';
import { verticalHierarchyCache } from '../lib/cache';
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
// Supports: ?status=, ?minHits=, ?search=, ?page=, ?limit=
// ============================================

router.get('/suggestions', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const status = req.query.status as string | undefined;
        const minHits = req.query.minHits ? parseInt(req.query.minHits as string) : undefined;
        const search = req.query.search as string | undefined;
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

        const allSuggestions = await listSuggestions({ status, minHits });

        // Apply search filter
        const filtered = search
            ? allSuggestions.filter((s: any) =>
                s.suggestedName.toLowerCase().includes(search.toLowerCase()) ||
                s.suggestedSlug.toLowerCase().includes(search.toLowerCase())
            )
            : allSuggestions;

        // Paginate
        const total = filtered.length;
        const start = (page - 1) * limit;
        const suggestions = filtered.slice(start, start + limit);

        res.json({
            suggestions,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error('List suggestions error:', error);
        res.status(500).json({ error: 'Failed to list suggestions' });
    }
});

// ============================================
// PUT /suggestions/:id/approve — Promote suggestion to Vertical
// Optionally mints NFT when NFT_FEATURES_ENABLED=true
// ============================================

router.put('/suggestions/:id/approve', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const { id } = req.params;
        const { mintNft } = req.body || {};

        // Find the suggestion
        const suggestion = await prisma.verticalSuggestion.findUnique({ where: { id } });
        if (!suggestion) {
            res.status(404).json({ error: 'Suggestion not found' });
            return;
        }
        if (suggestion.status !== 'PROPOSED') {
            res.status(400).json({ error: `Suggestion already ${suggestion.status.toLowerCase()}` });
            return;
        }

        // Create the vertical (or activate existing PROPOSED one)
        let vertical = await prisma.vertical.findUnique({ where: { slug: suggestion.suggestedSlug } });

        if (vertical) {
            vertical = await prisma.vertical.update({
                where: { id: vertical.id },
                data: { status: 'ACTIVE', name: suggestion.suggestedName },
            });
        } else {
            vertical = await prisma.vertical.create({
                data: {
                    slug: suggestion.suggestedSlug,
                    name: suggestion.suggestedName,
                    status: 'ACTIVE',
                    depth: suggestion.parentSlug ? 1 : 0,
                    attributes: suggestion.attributes as any,
                    parent: suggestion.parentSlug
                        ? { connect: { slug: suggestion.parentSlug } }
                        : undefined,
                },
            });
        }

        // Update suggestion status
        await prisma.verticalSuggestion.update({
            where: { id },
            data: { status: 'ACTIVE' },
        });

        // Optionally mint NFT
        let nftResult = null;
        if (mintNft && NFT_FEATURES_ENABLED) {
            try {
                nftResult = await verticalNFTService.activateVertical(vertical.slug);
            } catch (nftErr) {
                console.warn(`[vertical] NFT mint failed for ${vertical.slug}:`, nftErr);
            }
        }

        res.json({
            message: `Vertical '${vertical.name}' approved and activated`,
            vertical,
            nft: nftResult,
        });
    } catch (error) {
        console.error('Approve suggestion error:', error);
        res.status(500).json({ error: 'Failed to approve suggestion' });
    }
});

// ============================================
// PUT /suggestions/:id/reject — Reject a suggestion
// ============================================

router.put('/suggestions/:id/reject', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const { id } = req.params;
        const { reason } = req.body || {};

        const suggestion = await prisma.verticalSuggestion.findUnique({ where: { id } });
        if (!suggestion) {
            res.status(404).json({ error: 'Suggestion not found' });
            return;
        }
        if (suggestion.status !== 'PROPOSED') {
            res.status(400).json({ error: `Suggestion already ${suggestion.status.toLowerCase()}` });
            return;
        }

        const updated = await prisma.verticalSuggestion.update({
            where: { id },
            data: {
                status: 'REJECTED',
                reasoning: reason || suggestion.reasoning,
            },
        });

        res.json({
            message: `Suggestion '${updated.suggestedName}' rejected`,
            suggestion: updated,
        });
    } catch (error) {
        console.error('Reject suggestion error:', error);
        res.status(500).json({ error: 'Failed to reject suggestion' });
    }
});

// ============================================
// PATCH /suggestions/:id/status — Update vertical status (pause/reactivate/delete)
// ============================================

router.patch('/suggestions/:id/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const { id } = req.params;
        const { status } = req.body as { status?: string };

        const ALLOWED_STATUSES = ['ACTIVE', 'DEPRECATED', 'REJECTED'] as const;
        if (!status || !ALLOWED_STATUSES.includes(status as any)) {
            res.status(400).json({ error: `Invalid status. Must be one of: ${ALLOWED_STATUSES.join(', ')}` });
            return;
        }

        const suggestion = await prisma.verticalSuggestion.findUnique({ where: { id } });
        if (!suggestion) {
            res.status(404).json({ error: 'Suggestion not found' });
            return;
        }

        // Update suggestion status
        const updated = await prisma.verticalSuggestion.update({
            where: { id },
            data: { status: status as any },
        });

        // Also update the corresponding Vertical entry (created on approve)
        const vertical = await prisma.vertical.findUnique({ where: { slug: suggestion.suggestedSlug } });
        if (vertical) {
            await prisma.vertical.update({
                where: { id: vertical.id },
                data: { status: status as any },
            });
        }

        // Invalidate hierarchy cache so changes reflect immediately
        verticalHierarchyCache.clear();

        const actionMap: Record<string, string> = { ACTIVE: 'reactivated', DEPRECATED: 'paused', REJECTED: 'deleted' };
        res.json({
            message: `Vertical '${updated.suggestedName}' ${actionMap[status] || 'updated'}`,
            suggestion: updated,
        });
    } catch (error) {
        console.error('Update suggestion status error:', error);
        res.status(500).json({ error: 'Failed to update suggestion status' });
    }
});

// ============================================
// GET /:slug/form-config — Get saved form builder config for a vertical
// ============================================

router.get('/:slug/form-config', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { slug } = req.params;
        const vertical = await prisma.vertical.findUnique({
            where: { slug },
            select: { formConfig: true, slug: true, name: true },
        });
        if (!vertical) {
            res.status(404).json({ error: 'Vertical not found' });
            return;
        }
        res.json({ formConfig: vertical.formConfig || null, vertical: { slug: vertical.slug, name: vertical.name } });
    } catch (error) {
        console.error('Get form config error:', error);
        res.status(500).json({ error: 'Failed to fetch form config' });
    }
});

// ============================================
// GET /public/:slug/form-config — Public endpoint for hosted forms (no auth)
// ============================================

router.get('/public/:slug/form-config', generalLimiter, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { slug } = req.params;
        const vertical = await prisma.vertical.findUnique({
            where: { slug },
            select: { formConfig: true, slug: true, name: true },
        });
        if (!vertical) {
            res.status(404).json({ error: 'Form not found' });
            return;
        }

        // Use saved formConfig or generate a sensible default
        const formConfig = vertical.formConfig || {
            fields: [
                { id: 'f_name', key: 'name', label: 'Full Name', type: 'text', required: true, placeholder: 'John Doe' },
                { id: 'f_email', key: 'email', label: 'Email', type: 'email', required: true, placeholder: 'john@example.com' },
                { id: 'f_phone', key: 'phone', label: 'Phone', type: 'phone', required: true, placeholder: '(555) 123-4567' },
                { id: 'f_state', key: 'state', label: 'State', type: 'text', required: false, placeholder: 'CA' },
                { id: 'f_zip', key: 'zip', label: 'Zip Code', type: 'text', required: false, placeholder: '90210' },
                { id: 'f_notes', key: 'notes', label: 'Additional Details', type: 'textarea', required: false, placeholder: 'Tell us more about what you need...' },
            ],
            steps: [
                { id: 's_info', label: 'Your Info', fieldIds: ['f_name', 'f_email', 'f_phone'] },
                { id: 's_details', label: 'Details', fieldIds: ['f_state', 'f_zip', 'f_notes'] },
            ],
            gamification: { showProgress: true, showNudges: true, confetti: true },
        };

        res.json({ formConfig, vertical: { slug: vertical.slug, name: vertical.name } });
    } catch (error) {
        console.error('Public form config error:', error);
        res.status(500).json({ error: 'Failed to fetch form config' });
    }
});

// ============================================
// PUT /:slug/form-config — Save form builder config (Admin only)
// ============================================

const FormConfigSchema = z.object({
    fields: z.array(z.object({
        id: z.string(),
        key: z.string(),
        label: z.string(),
        type: z.enum(['text', 'select', 'boolean', 'number', 'textarea', 'email', 'phone']),
        required: z.boolean(),
        placeholder: z.string().optional(),
        options: z.array(z.string()).optional(),
    })),
    steps: z.array(z.object({
        id: z.string(),
        label: z.string(),
        fieldIds: z.array(z.string()),
    })),
    gamification: z.object({
        showProgress: z.boolean(),
        showNudges: z.boolean(),
        confetti: z.boolean(),
    }).optional(),
});

router.put('/:slug/form-config', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        const { slug } = req.params;
        const validation = FormConfigSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid form config', details: validation.error.issues });
            return;
        }

        const vertical = await prisma.vertical.findUnique({ where: { slug } });
        if (!vertical) {
            res.status(404).json({ error: 'Vertical not found' });
            return;
        }

        const updated = await prisma.vertical.update({
            where: { slug },
            data: { formConfig: validation.data as any },
        });

        res.json({
            message: `Form config saved for '${updated.name}'`,
            formConfig: updated.formConfig,
        });
    } catch (error) {
        console.error('Save form config error:', error);
        res.status(500).json({ error: 'Failed to save form config' });
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
    durationSecs: z.number().int().min(60).max(600).optional(), // 1 min to 10 min; defaults to 300s
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
