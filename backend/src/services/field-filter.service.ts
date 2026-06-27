/**
 * Field Filter Evaluation Service — Lead Engine CRE
 *
 * THIN WRAPPER around the canonical implementation in
 * @lead-engine/rules-engine (packages/rules-engine). The same code runs
 * inside the Chainlink DON workflow and the backend, so filter semantics
 * can never diverge again.
 *
 * Used by:
 *   1. auto-bid.service.ts — field-level autobid rules
 *   2. marketplace.routes.ts — POST /leads/search endpoint
 *
 * Security rules (enforced by callers at the DB query level):
 *   - Only VerticalField records with isFilterable=true can appear in search filters
 *   - Only VerticalField records with isBiddable=true can appear in autobid rules
 *   - isPii=true fields are never evaluated
 */

export {
    evaluateFieldFilters,
    evaluateSingleRule,
} from '@lead-engine/rules-engine';

export type {
    FilterOperator,
    FilterEvalResult,
} from '@lead-engine/rules-engine';

// Back-compat alias: backend callers historically used `FieldFilterRule`
export type { FieldFilter as FieldFilterRule } from '@lead-engine/rules-engine';
