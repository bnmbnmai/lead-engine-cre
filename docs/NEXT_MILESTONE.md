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

- [ ] Branch `agentrtb-remediation` pushed with logical commits
- [ ] All 7 new migrations applied on staging via `migrate deploy`
- [ ] Smoke: sealed bid → reveal → settlement saga → lead SOLD
- [ ] Smoke: create strategy → dry-run → activate → decision trace visible
- [ ] No double strategy execution when `CRE_WORKFLOW_ENABLED=false`

## After staging is green

Choose one narrative for the next **public** release:

- **Demo polish** — tighten hackathon story, video, judge checklist
- **AgentRTB launch** — strategy marketplace, developer guide, agent dashboard on production

Both can coexist in the repo; pick one for external messaging per release.
