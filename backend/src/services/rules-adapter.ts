/**
 * Adapter: Prisma BuyerPreferenceSet (with includes) → rules-engine PreferenceSet.
 *
 * Centralizes the security gate that only biddable, non-PII vertical fields
 * may participate in rule evaluation, and normalizes Prisma Decimal/JSON
 * columns into the plain types the shared rules engine expects.
 */
import type { FieldFilter, FilterOperator, PreferenceSet } from '@lead-engine/rules-engine';

interface PrismaFieldFilter {
    operator: string;
    value: string;
    verticalField: { key: string; isBiddable: boolean; isPii: boolean };
}

interface PrismaPreferenceSetLike {
    id: string;
    vertical: string;
    label?: string | null;
    geoCountries: unknown;
    geoInclude?: string[] | null;
    geoExclude?: string[] | null;
    minQualityScore?: number | null;
    acceptOffSite?: boolean | null;
    requireVerified?: boolean | null;
    autoBidAmount?: unknown;
    maxBidPerLead?: unknown;
    fieldFilters?: PrismaFieldFilter[] | null;
    buyerProfile?: { userId: string } | null;
}

export function toRulesPreferenceSet(prefSet: PrismaPreferenceSetLike): PreferenceSet {
    // Security gate: only biddable, non-PII fields are ever evaluated
    const fieldFilters: FieldFilter[] = (prefSet.fieldFilters ?? [])
        .filter((f) => f.verticalField?.isBiddable && !f.verticalField?.isPii)
        .map((f) => ({
            fieldKey: f.verticalField.key,
            operator: f.operator as FilterOperator,
            value: f.value,
        }));

    const geoCountries = Array.isArray(prefSet.geoCountries)
        ? (prefSet.geoCountries as string[])
        : prefSet.geoCountries
            ? [String(prefSet.geoCountries)]
            : [];

    return {
        id: prefSet.id,
        buyerId: prefSet.buyerProfile?.userId ?? '',
        vertical: prefSet.vertical,
        label: prefSet.label ?? '',
        geoCountries,
        geoInclude: prefSet.geoInclude ?? [],
        geoExclude: prefSet.geoExclude ?? [],
        minQualityScore: prefSet.minQualityScore != null ? Number(prefSet.minQualityScore) : null,
        acceptOffSite: prefSet.acceptOffSite ?? true,
        requireVerified: prefSet.requireVerified ?? false,
        autoBidAmount: Number(prefSet.autoBidAmount ?? 0),
        maxBidPerLead: prefSet.maxBidPerLead != null ? Number(prefSet.maxBidPerLead) : null,
        fieldFilters,
    };
}
