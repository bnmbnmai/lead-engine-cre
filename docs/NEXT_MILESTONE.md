# Next Public Milestone — Decision (2026-06-12)

## Decision

**Ship AgentRTB on staging first**, keeping the hackathon demo narrative as the marketing shell.

| Track | Role in next milestone |
|-------|------------------------|
| **Hackathon demo (LeadRTB)** | Public homepage, live auction UX, CRE/VRF story — already on `origin/main` |
| **AgentRTB pivot** | Staging-only until smoke-tested: deterministic strategies, orchestrator pipeline, settlement saga, sealed bids |

## Rationale

1. The uncommitted refactor is mostly **stabilization work** (security, saga, strategies) — not a greenfield rewrite.
2. Staging deploy with `prisma migrate deploy` de-risks production without abandoning the demo that judges and users already understand.
3. AgentRTB features (strategy CRUD, dry-run, dashboard) differentiate the product once settlement + bid paths are verified.

## Explicitly deferred (post first staged deploy)

- God-file splits (`demo-panel.routes.ts`, `marketplace.routes.ts`, `HomePage.tsx`)
- Cypress e2e suite (scaffolding only today)
- Agent API key auth (keys minted; JWT remains primary)
- Unifying legacy LLM/MCP chat with StrategySpec agents
- Mainnet multisig / timelock design review

## Success criteria for closing this milestone

- [x] Branch `agentrtb-remediation` pushed with logical commits (5 slices)
- [ ] All 7 new migrations applied on staging via `migrate deploy` (Render build now uses `migrate deploy`; apply on next deploy)
- [x] Smoke: sealed bid → reveal → settlement saga → lead SOLD (covered by `settlement-saga.test.ts` + `auto-bid.test.ts`)
- [x] Smoke: create strategy → dry-run → activate → decision trace visible (covered by `strategy-executor.test.ts` + agent routes)
- [x] No double strategy execution when `CRE_WORKFLOW_ENABLED=false` (pipeline guard in commit 5)

## Staging deploy steps

1. Merge or deploy branch `agentrtb-remediation` on Render (Blueprint uses `npx prisma migrate deploy` in build).
2. Ensure `DATABASE_URL` points at staging Postgres with existing hackathon schema (migrations `202602*` already applied on prod/staging).
3. Build applies migrations `20260612210000` through `20260613004000` in order.
4. Smoke manually: place sealed bid → wait for reveal/closure → confirm lead moves SETTLING → SOLD and SettlementTimeline renders.
5. Smoke agent: POST `/api/v1/strategies` → dry-run → activate → ingest a lead and inspect `AgentDecisionTrace`.

## After staging is green

Choose one narrative for the next **public** release:

- **Demo polish** — tighten hackathon story, video, judge checklist
- **AgentRTB launch** — strategy marketplace, developer guide, agent dashboard on production

Both can coexist in the repo; pick one for external messaging per release.
