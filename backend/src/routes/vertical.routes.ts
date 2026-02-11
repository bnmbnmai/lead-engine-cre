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
import { z } from 'zod';

const router = Router();

// ============================================
// GET /hierarchy — Full vertical tree (cached)
// ============================================

router.get('/hierarchy', generalLimiter, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const tree = await verticalService.getHierarchy();
        res.json({ tree });
    } catch (error) {
        console.error('Get hierarchy error:', error);
        res.status(500).json({ error: 'Failed to fetch vertical hierarchy' });
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
// PUT /:slug/activate — Activate vertical + mint NFT (Admin only)
// Runs: CRE verification → ACE compliance → Mint VerticalNFT → Update Prisma
// ============================================

const ActivateSchema = z.object({
    recipientAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
});

router.put('/:slug/activate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Admin only
        if (req.user!.role !== 'ADMIN') {
            res.status(403).json({ error: 'Admin access required' });
            return;
        }

        // Validate input
        const validation = ActivateSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid input', details: validation.error.flatten() });
            return;
        }

        const { slug } = req.params;
        const { recipientAddress } = validation.data;

        // Run full activation pipeline
        const result = await verticalNFTService.activateVertical(slug, recipientAddress);

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

export default router;
