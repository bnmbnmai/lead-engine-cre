/**
 * demo-e2e.service.ts — Thin re-export facade (P2 Refactor)
 *
 * This file is now a thin facade that re-exports the public API from the
 * refactored sub-modules under src/services/demo/.
 *
 * DO NOT add business logic here.  All implementation lives in:
 *   - demo/demo-shared.ts         — constants, ABIs, types, shared utils
 *   - demo/demo-lead-drip.ts      — lead injection & continuous drip
 *   - demo/demo-buyer-scheduler.ts — buyer profiles, bid scheduling, sweeps
 *   - demo/demo-vault-cycle.ts    — vault lock/settle/refund, token recycling
 *   - demo/demo-orchestrator.ts   — main runFullDemo, results store, control
 */

// ── Public types ───────────────────────────────────
export type { DemoLogEntry, CycleResult, DemoResult } from './demo/demo-orchestrator';

// ── Public functions (consumed by demo-panel.routes.ts and external callers) ──
export {
    initResultsStore,
    runFullDemo,
    stopDemo,
    isDemoRunning,
    isDemoRecycling,
    getResults,
    getLatestResult,
    getAllResults,
    cleanupLockedFundsForDemoBuyers,
} from './demo/demo-orchestrator';

// ── Exported for unit tests only ──────────────────
export {
    countActiveLeads,
    checkActiveLeadsAndTopUp,
} from './demo/demo-lead-drip';
