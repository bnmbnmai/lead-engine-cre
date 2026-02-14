/**
 * Conversion Tracking Service
 * ────────────────────────────
 * Fires seller-configured conversion events on successful lead sale.
 *
 *   • Pixel:   GET request (1×1 image) — fire-and-forget
 *   • Webhook: POST with JSON payload — fire-and-forget
 *
 * Both are non-blocking; errors are logged but never propagate.
 */

import { prisma } from '../lib/prisma';

export interface ConversionPayload {
    event: 'lead_sold';
    lead_id: string;
    sale_amount: number;
    platform_fee: number;
    vertical: string;
    geo: string;
    quality_score: number;
    transaction_id: string;
    sold_at: string;
}

const TIMEOUT_MS = 5_000;

/**
 * Look up the seller's conversion config and fire pixel + webhook if configured.
 * Safe to call fire-and-forget: `.catch(console.error)`
 */
export async function fireConversionEvents(
    sellerId: string,
    payload: ConversionPayload,
): Promise<{ pixelFired: boolean; webhookFired: boolean }> {
    const seller = await prisma.sellerProfile.findUnique({
        where: { id: sellerId },
        select: { conversionPixelUrl: true, conversionWebhookUrl: true },
    });

    if (!seller) {
        return { pixelFired: false, webhookFired: false };
    }

    const results = { pixelFired: false, webhookFired: false };

    // ── Pixel (GET, fire-and-forget) ────────────────────
    if (seller.conversionPixelUrl) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
            await fetch(seller.conversionPixelUrl, {
                method: 'GET',
                signal: controller.signal,
            });
            clearTimeout(timer);
            results.pixelFired = true;
            console.log(`[CONVERSION] Pixel fired for seller ${sellerId}`);
        } catch (err: any) {
            console.warn(`[CONVERSION] Pixel failed for seller ${sellerId}:`, err.message);
        }
    }

    // ── Webhook (POST with JSON payload) ────────────────
    if (seller.conversionWebhookUrl) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
            const res = await fetch(seller.conversionWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            clearTimeout(timer);
            results.webhookFired = true;
            console.log(`[CONVERSION] Webhook fired for seller ${sellerId} → ${res.status}`);
        } catch (err: any) {
            console.warn(`[CONVERSION] Webhook failed for seller ${sellerId}:`, err.message);
        }
    }

    return results;
}
