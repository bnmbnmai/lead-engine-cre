/**
 * SupplySpec — declarative seller supply policy (mirror of StrategySpec).
 *
 * Seller agents declare vertical, geo, reserve bounds, auction timing,
 * required lead fields, daily listing caps, and TCPA evidence rules.
 * The ingest executor validates listing requests deterministically before
 * a lead is created.
 */
import { z } from 'zod';

export const supplySpecSchema = z.object({
    version: z.literal(1),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    vertical: z.string().min(1),
    geoCountries: z.array(z.string().length(2)).default(['US']),
    geoInclude: z.array(z.string().min(1).max(4)).default([]),
    geoExclude: z.array(z.string().min(1).max(4)).default([]),
    reservePrice: z.number().positive(),
    maxReservePrice: z.number().positive().optional(),
    auctionDurationSec: z.number().int().positive().default(60),
    dailyListingCap: z.number().int().positive().nullable().default(null),
    hourlyListingCap: z.number().int().positive().nullable().default(100),
    requiredFieldKeys: z.array(z.string().min(1)).default([]),
    minFieldCount: z.number().int().min(0).default(1),
    requireTcpaProof: z.boolean().default(true),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SupplySpec = z.infer<typeof supplySpecSchema>;

export function parseSupplySpec(input: unknown): SupplySpec {
    return supplySpecSchema.parse(input);
}

export interface SupplyListingRequest {
    vertical: string;
    geo?: { country?: string; state?: string; city?: string; zip?: string };
    fields: Record<string, unknown>;
    reservePrice?: number;
    tcpaConsentAt?: string;
    tcpaProof?: unknown;
    campaignId?: string;
}

export interface SupplyValidationContext {
    listingsToday: number;
    listingsThisHour: number;
}

export interface SupplyValidationResult {
    ok: boolean;
    reason?: string;
    gate?: string;
}

/** Pure validation — same spec + request + context → same result. */
export function validateSupplyListing(
    spec: SupplySpec,
    request: SupplyListingRequest,
    ctx: SupplyValidationContext,
): SupplyValidationResult {
    if (request.vertical !== spec.vertical) {
        return { ok: false, reason: `vertical mismatch: expected ${spec.vertical}`, gate: 'vertical' };
    }

    const country = (request.geo?.country || 'US').toUpperCase();
    if (!spec.geoCountries.includes(country)) {
        return { ok: false, reason: `geo country ${country} not allowed`, gate: 'geo' };
    }

    const region = request.geo?.state?.toUpperCase();
    if (region && spec.geoExclude.some((g) => g.toUpperCase() === region)) {
        return { ok: false, reason: `geo ${region} excluded`, gate: 'geo' };
    }
    if (spec.geoInclude.length > 0 && region && !spec.geoInclude.some((g) => g.toUpperCase() === region)) {
        return { ok: false, reason: `geo ${region} not in include list`, gate: 'geo' };
    }

    const reserve = request.reservePrice ?? spec.reservePrice;
    if (reserve < spec.reservePrice) {
        return { ok: false, reason: `reserve ${reserve} below spec minimum ${spec.reservePrice}`, gate: 'reserve' };
    }
    const maxReserve = spec.maxReservePrice ?? spec.reservePrice * 10;
    if (reserve > maxReserve) {
        return { ok: false, reason: `reserve ${reserve} exceeds max ${maxReserve}`, gate: 'reserve' };
    }

    const fieldKeys = Object.keys(request.fields || {});
    if (fieldKeys.length < spec.minFieldCount) {
        return { ok: false, reason: `need at least ${spec.minFieldCount} fields`, gate: 'fields' };
    }
    for (const key of spec.requiredFieldKeys) {
        const val = request.fields[key];
        if (val === undefined || val === null || String(val).trim() === '') {
            return { ok: false, reason: `missing required field: ${key}`, gate: 'fields' };
        }
    }

    if (spec.dailyListingCap != null && ctx.listingsToday >= spec.dailyListingCap) {
        return { ok: false, reason: `daily listing cap ${spec.dailyListingCap} reached`, gate: 'dailyCap' };
    }
    if (spec.hourlyListingCap != null && ctx.listingsThisHour >= spec.hourlyListingCap) {
        return { ok: false, reason: `hourly listing cap ${spec.hourlyListingCap} reached`, gate: 'hourlyCap' };
    }

    if (spec.requireTcpaProof) {
        if (!request.tcpaConsentAt) {
            return { ok: false, reason: 'tcpaConsentAt required by SupplySpec', gate: 'tcpa' };
        }
        if (!request.tcpaProof || (typeof request.tcpaProof === 'string' && !request.tcpaProof.trim())) {
            return { ok: false, reason: 'tcpaProof required by SupplySpec', gate: 'tcpa' };
        }
    }

    return { ok: true };
}
