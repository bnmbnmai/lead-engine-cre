import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyMessage } from 'ethers';
import { prisma } from '../lib/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        walletAddress: string;
        role: string;
    };
}

// ============================================
// JWT Token Functions
// ============================================

export function generateToken(payload: { userId: string; walletAddress: string; role: string }): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): { userId: string; walletAddress: string; role: string } | null {
    try {
        return jwt.verify(token, JWT_SECRET) as any;
    } catch {
        return null;
    }
}

// ============================================
// SIWE Message Generation
// ============================================

export function generateSiweMessage(address: string, nonce: string, domain: string): string {
    const now = new Date().toISOString();
    return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to Lead Engine CRE

URI: https://${domain}
Version: 1
Chain ID: 1
Nonce: ${nonce}
Issued At: ${now}`;
}

// ============================================
// Signature Verification
// ============================================

export async function verifySiweSignature(
    message: string,
    signature: string,
    expectedAddress: string
): Promise<boolean> {
    try {
        const recoveredAddress = verifyMessage(message, signature);
        return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
        console.error('Signature verification failed:', error);
        return false;
    }
}

// ============================================
// Auth Middleware
// ============================================

export async function authMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid authorization header' });
        return;
    }

    const token = authHeader.slice(7);
    const decoded = verifyToken(token);

    if (!decoded) {
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
    }

    // Verify session exists and is active
    const session = await prisma.session.findFirst({
        where: {
            userId: decoded.userId,
            token,
            expiresAt: { gt: new Date() },
        },
    });

    if (!session) {
        res.status(401).json({ error: 'Session expired or invalid' });
        return;
    }

    // Update last active
    await prisma.session.update({
        where: { id: session.id },
        data: { lastActiveAt: new Date() },
    });

    req.user = {
        id: decoded.userId,
        walletAddress: decoded.walletAddress,
        role: decoded.role,
    };

    next();
}

// ============================================
// Optional Auth Middleware (public endpoints)
// Attaches user if valid token present, but
// proceeds without error if no token / invalid.
// ============================================

export async function optionalAuthMiddleware(
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            const decoded = verifyToken(token);
            if (decoded) {
                const session = await prisma.session.findFirst({
                    where: {
                        userId: decoded.userId,
                        token,
                        expiresAt: { gt: new Date() },
                    },
                });
                if (session) {
                    req.user = {
                        id: decoded.userId,
                        walletAddress: decoded.walletAddress,
                        role: decoded.role,
                    };
                }
            }
        }
    } catch {
        // Silently proceed without user
    }
    next();
}

// ============================================
// API Key Middleware
// ============================================

export async function apiKeyMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
        // Fall through to JWT auth
        return authMiddleware(req, res, next);
    }

    const crypto = await import('crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const apiKeyRecord = await prisma.apiKey.findUnique({
        where: { keyHash },
        include: { user: true },
    });

    if (!apiKeyRecord || !apiKeyRecord.isActive) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
    }

    if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
        res.status(401).json({ error: 'API key expired' });
        return;
    }

    // Update last used
    await prisma.apiKey.update({
        where: { id: apiKeyRecord.id },
        data: { lastUsedAt: new Date() },
    });

    req.user = {
        id: apiKeyRecord.userId,
        walletAddress: apiKeyRecord.user.walletAddress,
        role: apiKeyRecord.user.role,
    };

    next();
}

// ============================================
// Role-Based Access Control
// ============================================

export function requireRole(...roles: string[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED',
                resolution: 'Connect your wallet and sign in to access this resource.',
            });
            return;
        }

        if (!roles.includes(req.user.role)) {
            const roleLabels: Record<string, string> = {
                SELLER: 'seller',
                BUYER: 'buyer',
                ADMIN: 'admin',
            };
            const needed = roles.map((r) => roleLabels[r] || r).join(' or ');
            res.status(403).json({
                error: `This action requires a ${needed} account.`,
                code: 'ROLE_REQUIRED',
                currentRole: req.user.role,
                requiredRoles: roles,
                resolution: `Your account is registered as "${req.user.role}". To access this feature, switch to a ${needed} account or register a new one at /auth/register.`,
            });
            return;
        }

        next();
    };
}

export function requireSeller(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    return requireRole('SELLER', 'ADMIN')(req, res, next);
}

export function requireBuyer(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    return requireRole('BUYER', 'ADMIN')(req, res, next);
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    return requireRole('ADMIN')(req, res, next);
}
