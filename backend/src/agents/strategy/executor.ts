/**
 * Strategy Executor (Phase C1)
 * ----------------------------
 * Pure, deterministic interpreter for StrategySpec documents.
 *
 * INVARIANT: same spec + same lead + same context → same decision, always.
 * No I/O, no clocks, no randomness. This is what makes strategies
 * backtestable (Phase C4) and their decision traces auditable (Phase C6).
 *
 * The LLM never executes — it only drafts/explains specs (see advisor.ts).
 * Money limits are enforced twice: here (declarative budget envelope) and
 * again in bid.service (server-side caps), so a bug in one layer cannot
 * overspend.
 */

import {
    evaluatePreferenceSet,
    computeBidAmount,
    type StrategySpec,
    type LeadData,
    type PreferenceSet,
    type MatchResult,
} from '@lead-engine/rules-engine';

export interface StrategyExecutionContext {
    /** Chainlink Data Feeds floor (required for floorPlus curves). */
    dataFeedFloor?: number | null;
    /** Owner's spend today in USDC (for dailyBudget enforcement). */
    spentTodayUsd?: number;
    /** Lifetime spend attributed to this strategy in USDC. */
    totalSpentUsd?: number;
    /** Currently open (unresolved) bids placed by this strategy. */
    activeBidCount?: number;
}

export type BudgetBlock =
    | 'budget:maxBidPerLead'
    | 'budget:dailyBudget'
    | 'budget:totalBudget'
    | 'budget:maxConcurrentBids';

export interface StrategyDecision {
    /** True when all gates passed AND the budget envelope allows the bid. */
    shouldBid: boolean;
    /** Bid amount in USDC when shouldBid; null otherwise. */
    bidAmount: number | null;
    /** Human-readable single-line explanation of the decision. */
    reason: string;
    /** 'gates' | BudgetBlock | null (null when shouldBid). */
    blockedBy: 'gates' | BudgetBlock | null;
    /** Full gate-by-gate result from the shared rules engine. */
    gateResult: MatchResult;
}

/** Adapt StrategySpec gates to the rules-engine PreferenceSet contract. */
export function strategyToPreferenceSet(spec: StrategySpec, strategyId = 'strategy'): PreferenceSet {
    return {
        id: strategyId,
        buyerId: 'strategy-owner',
        vertical: spec.gates.vertical,
        label: spec.name,
        geoCountries: spec.gates.geoCountries,
        geoInclude: spec.gates.geoInclude,
        geoExclude: spec.gates.geoExclude,
        minQualityScore: spec.gates.minQualityScore,
        acceptOffSite: spec.gates.acceptOffSite,
        requireVerified: spec.gates.requireVerified,
        // autoBidAmount is unused by gate evaluation — bid sizing comes from
        // the bid curve. Use 1 to satisfy the contract.
        autoBidAmount: 1,
        maxBidPerLead: spec.budget.maxBidPerLead,
        fieldFilters: spec.gates.fieldFilters,
    };
}

/**
 * Execute a strategy against a lead. Pure + deterministic.
 */
export function executeStrategy(
    spec: StrategySpec,
    lead: LeadData,
    ctx: StrategyExecutionContext = {},
): StrategyDecision {
    // ── Gates 1–7 (shared rules engine — same code as DON + auto-bid) ──
    const gateResult = evaluatePreferenceSet(lead, strategyToPreferenceSet(spec));
    if (!gateResult.matched) {
        return {
            shouldBid: false,
            bidAmount: null,
            reason: gateResult.reason,
            blockedBy: 'gates',
            gateResult,
        };
    }

    // ── Bid sizing (declarative curve) ──
    const rawAmount = computeBidAmount(spec.bidCurve, lead.qualityScore, ctx.dataFeedFloor);

    // Reserve price is a hard floor for any auction bid.
    const amount = Math.max(rawAmount, lead.reservePrice);

    // ── Budget envelope (declarative, deterministic) ──
    const b = spec.budget;
    if (amount > b.maxBidPerLead) {
        return decisionBlocked(gateResult, 'budget:maxBidPerLead',
            `bid $${amount} exceeds maxBidPerLead $${b.maxBidPerLead}`);
    }
    if (b.dailyBudget != null && (ctx.spentTodayUsd ?? 0) + amount > b.dailyBudget) {
        return decisionBlocked(gateResult, 'budget:dailyBudget',
            `daily budget $${b.dailyBudget} would be exceeded (spent $${ctx.spentTodayUsd ?? 0} + bid $${amount})`);
    }
    if (b.totalBudget != null && (ctx.totalSpentUsd ?? 0) + amount > b.totalBudget) {
        return decisionBlocked(gateResult, 'budget:totalBudget',
            `total budget $${b.totalBudget} would be exceeded (spent $${ctx.totalSpentUsd ?? 0} + bid $${amount})`);
    }
    if (b.maxConcurrentBids != null && (ctx.activeBidCount ?? 0) >= b.maxConcurrentBids) {
        return decisionBlocked(gateResult, 'budget:maxConcurrentBids',
            `max concurrent bids reached (${ctx.activeBidCount}/${b.maxConcurrentBids})`);
    }

    return {
        shouldBid: true,
        bidAmount: amount,
        reason: `matched — bidding $${amount} (curve: ${spec.bidCurve.type})`,
        blockedBy: null,
        gateResult,
    };
}

function decisionBlocked(gateResult: MatchResult, blockedBy: BudgetBlock, reason: string): StrategyDecision {
    return { shouldBid: false, bidAmount: null, reason, blockedBy, gateResult };
}
