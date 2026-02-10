import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { prisma } from '../lib/prisma';
import {
    generateToken,
    verifySiweSignature,
    generateSiweMessage,
    authMiddleware,
    AuthenticatedRequest
} from '../middleware/auth';
import { WalletAuthSchema, KycInitSchema } from '../utils/validation';
import { authLimiter } from '../middleware/rateLimit';
import { aceService } from '../services/ace.service';

const router = Router();

// ============================================
// Get Nonce for SIWE
// ============================================

router.get('/nonce/:address', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            res.status(400).json({ error: 'Invalid wallet address' });
            return;
        }

        // Get or create user with nonce
        let user = await prisma.user.findUnique({
            where: { walletAddress: address.toLowerCase() },
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    walletAddress: address.toLowerCase(),
                    nonce: uuid(),
                },
            });
        } else {
            // Refresh nonce for security
            user = await prisma.user.update({
                where: { id: user.id },
                data: { nonce: uuid() },
            });
        }

        const domain = req.get('host') || 'localhost:3001';
        const message = generateSiweMessage(address, user.nonce, domain);

        res.json({ nonce: user.nonce, message });
    } catch (error) {
        console.error('Nonce generation error:', error);
        res.status(500).json({ error: 'Failed to generate nonce' });
    }
});

// ============================================
// Wallet Authentication (SIWE)
// ============================================

router.post('/wallet', authLimiter, async (req: Request, res: Response) => {
    try {
        const validation = WalletAuthSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }

        const { address, message, signature } = validation.data;

        // Verify signature
        const isValid = await verifySiweSignature(message, signature, address);
        if (!isValid) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
        }

        // Get user and verify nonce
        const user = await prisma.user.findUnique({
            where: { walletAddress: address.toLowerCase() },
            include: { buyerProfile: true, sellerProfile: true },
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Check nonce is in message
        if (!message.includes(user.nonce)) {
            res.status(401).json({ error: 'Invalid nonce' });
            return;
        }

        // Rotate nonce after successful auth
        await prisma.user.update({
            where: { id: user.id },
            data: { nonce: uuid() },
        });

        // Generate JWT
        const token = generateToken({
            userId: user.id,
            walletAddress: user.walletAddress,
            role: user.role,
        });

        // Create session
        const session = await prisma.session.create({
            data: {
                userId: user.id,
                token,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                userAgent: req.get('user-agent'),
                ipAddress: req.ip,
            },
        });

        res.json({
            token,
            expiresAt: session.expiresAt,
            user: {
                id: user.id,
                walletAddress: user.walletAddress,
                role: user.role,
                kycStatus: user.buyerProfile?.kycStatus || user.sellerProfile?.kycStatus || 'PENDING',
            },
        });
    } catch (error) {
        console.error('Wallet auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// ============================================
// Get Current User
// ============================================

router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            include: {
                buyerProfile: true,
                sellerProfile: true,
            },
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        const kycValid = await aceService.isKYCValid(user.walletAddress);
        const reputation = await aceService.getReputationScore(user.walletAddress);

        res.json({
            id: user.id,
            walletAddress: user.walletAddress,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
            buyerProfile: user.buyerProfile,
            sellerProfile: user.sellerProfile,
            compliance: {
                kycValid,
                reputation,
            },
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// ============================================
// Initialize KYC
// ============================================

router.post('/kyc/init', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const validation = KycInitSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({ error: 'Invalid request', details: validation.error.issues });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            include: { buyerProfile: true, sellerProfile: true },
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Update KYC status to in-progress
        if (user.buyerProfile) {
            await prisma.buyerProfile.update({
                where: { id: user.buyerProfile.id },
                data: { kycStatus: 'IN_PROGRESS' },
            });
        }

        if (user.sellerProfile) {
            await prisma.sellerProfile.update({
                where: { id: user.sellerProfile.id },
                data: { kycStatus: 'IN_PROGRESS' },
            });
        }

        // Log compliance check
        await prisma.complianceCheck.create({
            data: {
                entityType: 'user',
                entityId: user.id,
                checkType: 'KYC',
                status: 'PENDING',
            },
        });

        // In production, this would integrate with Synaps/Persona/Jumio
        // For now, return a mock verification URL
        const verificationUrl = `https://verify.leadengine.io/kyc/${user.id}?redirect=${validation.data.redirectUrl || ''}`;

        res.json({
            verificationUrl,
            status: 'IN_PROGRESS',
            message: 'KYC verification initiated',
        });
    } catch (error) {
        console.error('KYC init error:', error);
        res.status(500).json({ error: 'Failed to initialize KYC' });
    }
});

// ============================================
// KYC Callback (Webhook)
// ============================================

router.post('/kyc/callback', async (req: Request, res: Response) => {
    try {
        // In production, verify webhook signature
        const { userId, status, verificationId } = req.body;

        if (!userId || !status) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        const kycStatus = status === 'approved' ? 'VERIFIED' : status === 'rejected' ? 'REJECTED' : 'PENDING';

        // Update user profiles
        await prisma.$transaction([
            prisma.buyerProfile.updateMany({
                where: { userId },
                data: {
                    kycStatus,
                    kycVerifiedAt: kycStatus === 'VERIFIED' ? new Date() : null,
                },
            }),
            prisma.sellerProfile.updateMany({
                where: { userId },
                data: {
                    kycStatus,
                    kycVerifiedAt: kycStatus === 'VERIFIED' ? new Date() : null,
                },
            }),
            prisma.complianceCheck.create({
                data: {
                    entityType: 'user',
                    entityId: userId,
                    checkType: 'KYC',
                    status: kycStatus === 'VERIFIED' ? 'PASSED' : 'FAILED',
                    checkedAt: new Date(),
                    result: { verificationId },
                },
            }),
        ]);

        res.json({ success: true });
    } catch (error) {
        console.error('KYC callback error:', error);
        res.status(500).json({ error: 'Failed to process KYC callback' });
    }
});

// ============================================
// Logout
// ============================================

router.post('/logout', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const token = req.headers.authorization?.slice(7);

        if (token) {
            await prisma.session.deleteMany({
                where: { token },
            });
        }

        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// ============================================
// Create/Update Profile
// ============================================

router.post('/profile', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { role, companyName, verticals } = req.body;

        const user = await prisma.user.update({
            where: { id: req.user!.id },
            data: { role: role || undefined },
        });

        if (role === 'BUYER' || user.role === 'BUYER') {
            await prisma.buyerProfile.upsert({
                where: { userId: user.id },
                create: {
                    userId: user.id,
                    companyName,
                    verticals: verticals || [],
                },
                update: {
                    companyName,
                    verticals: verticals || undefined,
                },
            });
        }

        if (role === 'SELLER' || user.role === 'SELLER') {
            await prisma.sellerProfile.upsert({
                where: { userId: user.id },
                create: {
                    userId: user.id,
                    companyName,
                    verticals: verticals || [],
                },
                update: {
                    companyName,
                    verticals: verticals || undefined,
                },
            });
        }

        res.json({ success: true, message: 'Profile updated' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

export default router;
