/**
 * Agent Orchestration Pipeline (Phase C2)
 * ---------------------------------------
 * Composable stages over a lead, executed deterministically:
 *   Scout      → lead exists + auction-open gate
 *   Evaluator  → CRE match ingestion (DON/local rules)
 *   Compliance → ACE wallet check for strategy owners
 *   Bidder     → ACTIVE strategy execution
 *
 * NOT free-form LLM agents — each stage is a typed function with
 * per-stage tracing persisted to AgentDecisionTrace (Phase C6).
 */

import { prisma } from '../../lib/prisma';
import type { LeadData } from '@lead-engine/rules-engine';
import type { PipelineInput, PipelineResult, StageTrace } from './types';

async function traceStage<T>(
    stage: StageTrace['stage'],
    fn: () => Promise<{ ok: boolean; detail: string; data?: Record<string, unknown>; value?: T }>,
): Promise<{ trace: StageTrace; value?: T }> {
    const start = Date.now();
    try {
        const out = await fn();
        return {
            trace: {
                stage,
                ok: out.ok,
                durationMs: Date.now() - start,
                detail: out.detail,
                data: out.data,
            },
            value: out.value,
        };
    } catch (err: any) {
        return {
            trace: {
                stage,
                ok: false,
                durationMs: Date.now() - start,
                detail: err.message || 'stage failed',
            },
        };
    }
}

function toLeadData(lead: {
    id: string;
    vertical: string;
    geo: unknown;
    source: string | null;
    qualityScore?: number | null;
    isVerified: boolean;
    reservePrice: unknown;
    parameters?: unknown;
}): LeadData {
    const geo = lead.geo as any;
    return {
        id: lead.id,
        vertical: lead.vertical,
        geo: {
            country: geo?.country || 'US',
            state: geo?.state || geo?.region,
            city: geo?.city,
            zip: geo?.zip,
        },
        source: (lead.source as string) || 'DIRECT',
        qualityScore: (lead as any).qualityScore ?? null,
        isVerified: lead.isVerified ?? false,
        reservePrice: Number(lead.reservePrice ?? 0),
        parameters: (lead as any).parameters ?? null,
    };
}

/**
 * Run the full scout → evaluator → compliance → bidder pipeline for one lead.
 */
export async function runAgentPipeline(input: PipelineInput): Promise<PipelineResult> {
    const traces: StageTrace[] = [];
    const { leadId, ownerId, trigger = 'manual' } = input;

    // ── Scout: lead discovery + auction-state gate ──
    const scout = await traceStage('scout', async () => {
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (!lead) return { ok: false, detail: 'lead not found' };
        if (!['PENDING_AUCTION', 'IN_AUCTION'].includes(lead.status)) {
            return { ok: false, detail: `lead status ${lead.status} — not actionable` };
        }
        return {
            ok: true,
            detail: `lead ${lead.vertical} in ${lead.status}`,
            data: { vertical: lead.vertical, status: lead.status, trigger },
            value: lead,
        };
    });
    traces.push(scout.trace);
    if (!scout.trace.ok || !scout.value) {
        return { leadId, completed: false, traces, bidsPlaced: 0, error: scout.trace.detail };
    }

    const lead = scout.value;

    // ── Evaluator: rules + CRE workflow (idempotent ingest path) ──
    const evaluator = await traceStage('evaluator', async () => {
        const { creService } = await import('../../services/cre.service');
        const result = await creService.triggerBuyerRulesWorkflow(leadId);
        return {
            ok: true,
            detail: `${result.matchedSets} matched, ${result.bidsPlaced} bids from rules`,
            data: {
                workflowEnabled: result.workflowEnabled,
                matchedSets: result.matchedSets,
                bidsPlaced: result.bidsPlaced,
            },
            value: result.bidsPlaced,
        };
    });
    traces.push(evaluator.trace);
    let bidsPlaced = evaluator.value ?? 0;
    const evaluatorRanStrategiesLocally =
        evaluator.trace.data?.workflowEnabled === false;

    // ── Compliance: ACE check for ACTIVE strategy owners ──
    const compliance = await traceStage('compliance', async () => {
        const strategies = await prisma.agentStrategy.findMany({
            where: { status: 'ACTIVE', ...(ownerId ? { ownerId } : {}) },
            select: { ownerId: true },
        });
        if (strategies.length === 0) {
            return { ok: true, detail: 'no active strategies — compliance skipped' };
        }

        const ownerIds = [...new Set(strategies.map((s) => s.ownerId))];
        const users = await prisma.user.findMany({
            where: { id: { in: ownerIds } },
            select: { id: true, walletAddress: true },
        });

        const { aceService } = await import('../../services/ace.service');
        const leadGeo = lead.geo as any;
        const geoHash = leadGeo?.geoHash || '';
        const blocked: string[] = [];
        for (const u of users) {
            if (!u.walletAddress) continue;
            const kycOk = await aceService.isKYCValid(u.walletAddress);
            const can = await aceService.canTransact(u.walletAddress, lead.vertical, geoHash);
            if (!kycOk || !can.allowed) blocked.push(u.id);
        }

        if (blocked.length > 0) {
            return {
                ok: false,
                detail: `ACE blocked ${blocked.length} owner(s)`,
                data: { blockedOwnerIds: blocked },
            };
        }
        return { ok: true, detail: `${ownerIds.length} owner(s) ACE-compliant` };
    });
    traces.push(compliance.trace);
    if (!compliance.trace.ok) {
        return { leadId, completed: false, traces, bidsPlaced, error: compliance.trace.detail };
    }

    // ── Bidder: deterministic strategy executor ──
    const bidder = await traceStage('bidder', async () => {
        if (evaluatorRanStrategiesLocally) {
            return {
                ok: true,
                detail: 'strategies already executed via local auto-bid path (CRE off)',
                value: 0,
            };
        }
        const { runStrategiesForLead } = await import('../strategy/runner');
        const leadData = toLeadData(lead);
        const outcomes = await runStrategiesForLead(leadData);
        const placed = outcomes.filter((o) => o.bidPlaced).length;
        return {
            ok: true,
            detail: `${outcomes.length} strategies evaluated, ${placed} bids placed`,
            data: { outcomes: outcomes.map((o) => ({
                strategyId: o.strategyId,
                shouldBid: o.shouldBid,
                bidPlaced: o.bidPlaced,
                reason: o.reason,
            })) },
            value: placed,
        };
    });
    traces.push(bidder.trace);
    bidsPlaced += bidder.value ?? 0;

    // Persist decision trace (Phase C6)
    try {
        const { persistDecisionTrace } = await import('../../services/agent-trace.service');
        await persistDecisionTrace({
            leadId,
            trigger,
            traces,
            bidsPlaced,
            ownerId,
        });
    } catch (err: any) {
        console.warn(`[Orchestrator] trace persist failed: ${err.message}`);
    }

    return { leadId, completed: true, traces, bidsPlaced };
}
