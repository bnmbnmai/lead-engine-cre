# LeadRTB / AgentRTB fail-fast hunt (2026-09-03, apollo)

Hunt only. No merge, deploy, restart, Redbubble, Dryland, or Bruce ping. No local checkouts of either repo on this machine. Sources: GitHub `bnmbnmai/lead-engine-cre` + `bnmbnmai/agentrtb`, live HTTP, Base Sepolia `eth_getCode`.

## What the code does today (buyer / traffic / rail)

**Live (`main`, last commit 2026-03-07):** hackathon LeadRTB — sellers POST leads (API / webhook / demo / drip) → CRE quality score → 60s sealed auction → optional VRF tiebreak → USDC lock/release in `PersonalEscrowVault` / `RTBEscrow` → winner-only PII decrypt. Buyer side is wallet + preference sets + auto-bid, not a StrategySpec agent. Traffic ingest (`POST /api/v1/ingest/traffic-platform`) is a demo webhook that accepts any truthy `x-api-key` and sample Google/Meta/TikTok/TTD payloads.

**Unmerged rail (PR #1 `agentrtb-remediation`, last push 2026-07-08, 8 commits, 159 files, still open):** two-sided programmatic exchange on the same core. Seller agent `lsa_` + SupplySpec + `POST /ingest/traffic-platform` (TCPA proof / dedup / quality floor sit on the ingest door; they are gates, not the product). Buyer agent `lea_` + StrategySpec → orchestrator → sealed bid → vault settlement saga. Shared `@lead-engine/rules-engine`. Scripts already exist: `npm run smoke:agentrtb`, `npm run bot:integrator`. Thesis is locked: leads vertical only; no marketplace-brand rewrite; no nine-contract rebuild.

**`bnmbnmai/agentrtb` (private, 2 commits, last push 2026-02-13):** Feb fork that stripped LeadRTB and sketched a generic A2A marketplace (TASK / PRODUCT / SUPPLY_OFFER / DEMAND_REQUEST) plus undeployed `AgentRegistry` / `ListingEscrow` / `AgentMarketplace`. Dead end relative to the July rail, which lives on the LeadRTB PR.

## Chain / token / mainnet

| | Fact |
|---|---|
| Network | **Base Sepolia only** (84532). Wagmi also lists ETH Sepolia (11155111). Hardhat networks: `hardhat`, `sepolia`, `baseSepolia`. **No `base` / 8453 mainnet network is wired.** |
| Pay token | Circle **USDC** `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Base Sepolia). 6 decimals. |
| Mainnet | Docs only (`MAINNET_MIGRATION.md`). PR policy `MAINNET_TRIGGER.md` (2026-07-08): stay on testnet until a named counterparty must lock real USDC. Pilots = invoice / ACH / prepaid credits. |
| On-chain | All 9 CONTRACTS.md addresses still have bytecode, plus vault v2 `0x11bb8AFe…26B4` and escrow `0x80fA1d07…6507` used by the live UI. |

## Live vs parked vs broken

| Surface | Status (verified 2026-09-03) |
|---|---|
| `leadrtb.com` / `www` | **UI up** (Cloudflare → Vercel SPA, vite.svg, LeadRTB meta). SPA catch-all: `/.well-known/x402` and `/api/*` return `index.html`. |
| `api.leadrtb.com` | **API up** → Render `lead-engine-api-0jdu` v1.1.0, DB connected. `GET /api/v1/leads` = **0 in auction**. Demo panel: 868 seeded historical leads, 17 Demo Seller rows. `/.well-known/agent.json` **404**. CRE: `creWorkflowEnabled: false`, bounty Functions off. This is **`main`, not PR #1**. |
| `lead-engine-mcp.onrender.com` | `/health` 200 (tools listed); `/rpc` timed out. |
| Vercel homepage / PR preview | Production = March demo. PR #1 Vercel bot deployed a preview 2026-07-08 (`mergeable_state: unstable`; only Vercel status, success). |
| `agentrtb.com` | **Parked.** Apex `162.255.119.156` times out. `www` → Namecheap / `parking.d.parity.domains`. NS: `dns1.registrar-servers.com`. |
| HTTP **x402** (`/.well-known/x402`) | **Does not exist.** Code “x402” is a **log label** for on-chain USDC escrow (`createEscrow` → fund → release). There is no `x402.service.ts` and no facilitator. Not the ticks.bnm.farm 402 rail. |
| AgentRTB contracts | Written, **never deployed** (README: addresses TBD). |

Aug 2026 notes hold: last push ~July 8, open PR unmerged, Base Sepolia only, leadrtb.com is a dead marketplace UI (shell up, no live inventory), agentrtb.com is a parking page.

## Smallest spike (days, already specified — do not invent)

Not a merge-to-main, not a new brand, not a contract museum.

1. Point a **staging** Render service at `agentrtb-remediation` (`prisma migrate deploy`; migrations `20260613005000`, `20260613006000`).
2. Env: `DEDUP_PEPPER`, `MIN_AUCTION_QUALITY_SCORE=0`, `VITE_AGENTRTB_MODE=true`, `VITE_DEMO_MODE=false`. Leave production `leadrtb.com` on `main`.
3. `API_URL=… npm run smoke:agentrtb` then `npm run bot:integrator` (owned seller traffic). Exit: `/.well-known/agent.json` serves; ingest → IN_AUCTION; StrategySpec activates. Full vault settle may need testnet USDC — smoke already says so.
4. Stop. Pilot money stays off-chain per `PILOT_COMMERCIAL.md`. No mainnet, no audit, no second vertical, no Kimi hero UI.

No one-file fix in progress. Do not start the spike from this worker.

## Blockers only Bruce can do

- **Key / secrets:** Render `JWT_SECRET`, `PRIVACY_ENCRYPTION_KEY` (must not rotate), `DEDUP_PEPPER`, optional `DEPLOYER_PRIVATE_KEY`; Vercel `VITE_AGENTRTB_MODE` if a frontend host is wanted.
- **Fund:** Base Sepolia ETH + test USDC on the deployer / buyer vault **only if** the smoke must close an on-chain settle (not required for Rung 1 API). LINK on the existing Automation upkeep if that path is touched.
- **Domain:** `agentrtb.com` is Namecheap-parked; DNS is his. Not required for a Render staging hostname. Do not point production `leadrtb.com` at the PR until smoke is green.
- **Merge:** PR #1 is his call (`unstable`). Hunt does not merge it.
