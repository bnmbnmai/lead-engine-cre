/**
 * Supply executor — deterministic SupplySpec validation at ingest.
 */

import {
    parseSupplySpec,
    validateSupplyListing,
    type SupplySpec,
    type SupplyListingRequest,
    type SupplyValidationContext,
} from '@lead-engine/rules-engine';

export function executeSupplyValidation(
    specInput: unknown,
    request: SupplyListingRequest,
    ctx: SupplyValidationContext,
): { ok: boolean; reason?: string; gate?: string; spec?: SupplySpec } {
    const spec = parseSupplySpec(specInput);
    const result = validateSupplyListing(spec, request, ctx);
    return { ...result, spec };
}
