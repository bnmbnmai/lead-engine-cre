# Mainnet + Audit Trigger Policy

**Status:** Binding until amended in writing  
**Product:** AgentRTB (leads vertical #1)

## Default posture

Stay on **Base Sepolia (testnet)** for Chainlink contracts, vault demos, and integrator pilots until a trigger below fires.

Do **not** schedule mainnet or an external audit because the stack “feels ready.”

---

## Mainnet — when justified

**Trigger (any one):**

1. A named counterparty will lock **real USDC** that cannot stay on testnet, **or**
2. You hold **customer balances** in production custody, **or**
3. A signed pilot explicitly requires mainnet settlement as a contractual deliverable

**Until then:** Prefer ACH/wire / off-chain invoice for lead GMV; use on-chain as attestation + optional testnet escrow.

### Mainnet scope (keep boring)

Deploy only the **minimum custody surface**:

- Personal escrow / vault path used by settlement
- USDC + pause / withdraw limits
- Env validation, secrets in a proper store, monitoring, Sentry

Do **not** redeploy the entire LeadRTB museum (demo contracts, bounty theater, unused NFTs) on day one.

### Pre-mainnet checklist (short)

- [ ] Pilot money or named partner trigger documented
- [ ] Threat model for vault + settlement only
- [ ] Invariant / settlement tests green
- [ ] Pause switch + key custody runbook
- [ ] Withdrawal limits and monitoring alerts
- [ ] Rollback plan for API (contracts are not roll-backable)

Full historical notes: [MAINNET_MIGRATION.md](MAINNET_MIGRATION.md) — treat as reference, not a day-one mandate.

---

## Audit — when justified

**Trigger (any one):**

1. Five-figure+ TVL in production vaults, **or**
2. Enterprise / regulated buyer requires third-party review, **or**
3. You publicly market “non-custodial audited escrow”

**Until then:** Internal threat model + invariant tests + limited blast radius.

### Audit scope

Audit **vault + settlement modules** only — not the whole marketplace UI, demo panel, or unused contracts.

---

## Decision log

| Date | Decision |
|------|----------|
| 2026-07-08 | Mainnet and audit deferred until triggers above; staging/testnet is the live path for AgentRTB v1 |
