/**
 * Ingest fraud defenses — TCPA proof, contact dedup, quality floor.
 */

import crypto from 'crypto';
import { prisma } from '../lib/prisma';

const DEFAULT_DEDUP_WINDOW_HOURS = 72;
const DEFAULT_TCPA_MAX_AGE_DAYS = 30;
const DEFAULT_MIN_QUALITY_SCORE = 0;

function dedupPepper(): string {
    return process.env.DEDUP_PEPPER || process.env.JWT_SECRET || 'dev-dedup-pepper-change-in-production';
}

export function hashContactValue(raw: string, hashType: 'phone' | 'email'): string {
    const normalized = hashType === 'phone'
        ? raw.replace(/\D/g, '')
        : raw.trim().toLowerCase();
    if (!normalized) return '';
    return crypto
        .createHmac('sha256', dedupPepper())
        .update(`${hashType}:${normalized}`)
        .digest('hex');
}

export function extractContactHashes(fields: Record<string, unknown>): { phoneHash?: string; emailHash?: string } {
    const phone = String(fields.phone || fields.phoneNumber || fields.mobile || '').trim();
    const email = String(fields.email || fields.emailAddress || '').trim();
    const phoneHash = phone ? hashContactValue(phone, 'phone') : undefined;
    const emailHash = email ? hashContactValue(email, 'email') : undefined;
    return { phoneHash, emailHash };
}

export interface TcpaValidationResult {
    ok: boolean;
    reason?: string;
    consentAt?: Date;
}

export function validateTcpaProof(body: {
    tcpaConsentAt?: string;
    tcpaProof?: unknown;
}): TcpaValidationResult {
    if (!body.tcpaConsentAt) {
        return { ok: false, reason: 'tcpaConsentAt is required for API ingest' };
    }
    const consentAt = new Date(body.tcpaConsentAt);
    if (Number.isNaN(consentAt.getTime())) {
        return { ok: false, reason: 'tcpaConsentAt must be a valid ISO timestamp' };
    }
    const maxAgeDays = Number(process.env.TCPA_MAX_AGE_DAYS || DEFAULT_TCPA_MAX_AGE_DAYS);
    const ageMs = Date.now() - consentAt.getTime();
    if (ageMs < 0) {
        return { ok: false, reason: 'tcpaConsentAt cannot be in the future' };
    }
    if (ageMs > maxAgeDays * 86400000) {
        return { ok: false, reason: `tcpaConsentAt older than ${maxAgeDays} days` };
    }

    const proof = body.tcpaProof;
    if (proof === undefined || proof === null) {
        return { ok: false, reason: 'tcpaProof is required (consent token, signature, or consent ID)' };
    }
    if (typeof proof === 'string' && !proof.trim()) {
        return { ok: false, reason: 'tcpaProof cannot be empty' };
    }
    if (typeof proof === 'object' && Object.keys(proof as object).length === 0) {
        return { ok: false, reason: 'tcpaProof object must include consent evidence' };
    }

    return { ok: true, consentAt };
}

export function getMinAuctionQualityScore(): number {
    const raw = process.env.MIN_AUCTION_QUALITY_SCORE;
    if (raw === undefined || raw === '') return DEFAULT_MIN_QUALITY_SCORE;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(10000, Math.floor(n))) : DEFAULT_MIN_QUALITY_SCORE;
}

export function passesQualityFloor(score: number | null | undefined): boolean {
    const floor = getMinAuctionQualityScore();
    if (floor <= 0) return true;
    if (score == null) return false;
    return score >= floor;
}

export async function findDuplicateContact(
    hashes: { phoneHash?: string; emailHash?: string },
    vertical?: string,
): Promise<{ duplicate: boolean; hashType?: string; leadId?: string }> {
    const windowHours = Number(process.env.DEDUP_WINDOW_HOURS || DEFAULT_DEDUP_WINDOW_HOURS);
    const since = new Date(Date.now() - windowHours * 3600000);

    for (const [hashType, hash] of [
        ['phone', hashes.phoneHash],
        ['email', hashes.emailHash],
    ] as const) {
        if (!hash) continue;
        const row = await prisma.leadContactDedup.findFirst({
            where: {
                hashType,
                hash,
                createdAt: { gte: since },
                ...(vertical ? { vertical } : {}),
            },
            orderBy: { createdAt: 'desc' },
        });
        if (row) {
            return { duplicate: true, hashType, leadId: row.leadId };
        }
    }
    return { duplicate: false };
}

export async function recordContactDedup(
    leadId: string,
    vertical: string,
    hashes: { phoneHash?: string; emailHash?: string },
): Promise<void> {
    const rows: { hashType: string; hash: string; vertical: string; leadId: string }[] = [];
    if (hashes.phoneHash) rows.push({ hashType: 'phone', hash: hashes.phoneHash, vertical, leadId });
    if (hashes.emailHash) rows.push({ hashType: 'email', hash: hashes.emailHash, vertical, leadId });
    if (rows.length === 0) return;
    await prisma.leadContactDedup.createMany({ data: rows });
}

export async function countSellerListings(sellerId: string): Promise<{ today: number; thisHour: number }> {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfHour = new Date(now);
    startOfHour.setMinutes(0, 0, 0);

    const [today, thisHour] = await Promise.all([
        prisma.lead.count({ where: { sellerId, createdAt: { gte: startOfDay } } }),
        prisma.lead.count({ where: { sellerId, createdAt: { gte: startOfHour } } }),
    ]);
    return { today, thisHour };
}

export function isChttRequiredForIngest(): boolean {
    return process.env.NODE_ENV === 'production' && process.env.USE_CONFIDENTIAL_HTTP === 'true';
}
