/**
 * Multi-agent orchestration types (Phase C2).
 * Typed pipeline stages — not free-form LLM agents.
 */

export type PipelineStage = 'scout' | 'evaluator' | 'compliance' | 'bidder';

export interface StageTrace {
    stage: PipelineStage;
    ok: boolean;
    durationMs: number;
    detail: string;
    data?: Record<string, unknown>;
}

export interface PipelineInput {
    leadId: string;
    /** Optional owner scope — when set, only that buyer's strategies run. */
    ownerId?: string;
    /** Who triggered the pipeline (ingest, socket, manual). */
    trigger?: string;
}

export interface PipelineResult {
    leadId: string;
    completed: boolean;
    traces: StageTrace[];
    bidsPlaced: number;
    error?: string;
}
