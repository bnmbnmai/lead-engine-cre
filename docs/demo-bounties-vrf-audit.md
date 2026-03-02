# Demo Bounties & VRF Tiebreaker Audit — Zero-Assumption Code Review (March 2 2026)

> **Method**: Exhaustive grep + file read across the entire codebase. Every claim below links to a specific `file:line`.

---

## 1. Granular Bounties

### Code Evidence (files + line numbers)

| File | Lines | What It Does |
|------|-------|-------------|
| [bounty.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/bounty.service.ts) | 94–380 | `BountyService` class: `depositBounty()`, `matchBounties()`, `releaseBounty()`, `withdrawBounty()`. In-memory pool store + optional on-chain (`VerticalBountyPool.sol`) + optional Chainlink Functions (`BountyMatcher.sol`, gated by `BOUNTY_FUNCTIONS_ENABLED` env). Stacking cap: 2× lead price. |
| [bounty.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/bounty.service.ts#L29-L58) | 29–58 | Zod schemas: `BountyCriteria` (minQualityScore, geoStates, minCreditScore, maxLeadAge), `BountyDeposit`, `MatchedBounty` interface. |
| [bounty.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/bounty.service.ts#L65-L72) | 65–72 | `BOUNTY_POOL_ABI`: `depositBounty`, `topUpBounty`, `releaseBounty`, `withdrawBounty`, `totalVerticalBounty` — on-chain integration. |
| [auction-closure.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/auction-closure.service.ts#L428-L478) | 428–478 | **Bounty auto-release on every auction win.** Calls `bountyService.matchBounties()` with lead attributes (vertical, QS, geo, params) → `releaseBounty()` for each match → emits `bounty:released` socket event. Non-blocking (wrapped in try/catch). |
| [demo-panel.routes.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/routes/demo-panel.routes.ts#L1493-L1565) | 1493–1565 | **`POST /seed-bounties` endpoint.** Seeds 5 bounty pools: solar ($350), mortgage ($500), roofing ($200), insurance ($275), auto ($150) = **$1,475 total**. Each has criteria (QS, geo, credit). Depositor: `0x424CaC…` (buyer persona wallet). |
| [api.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/lib/api.ts#L337) | 337 | `demoSeedBounties()` — frontend API wrapper for `POST /seed-bounties`. |
| [api.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/lib/api.ts#L431-L451) | 431–451 | Full bounty API: `depositBounty`, `withdrawBounty`, `getBountyInfo`, `getMyBountyPools`. |
| [DemoPanel.tsx](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/components/demo/DemoPanel.tsx#L223-L228) | 223–228 | `handleSeedBounties()` calls `api.demoSeedBounties()` via the `runAction` guardrail. |
| [DemoPanel.tsx](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/components/demo/DemoPanel.tsx#L628-L634) | 628–634 | **"Seed Demo Bounties" button** — icon: `Sprout`, actionKey: `seedBounties`, variant: `accent`. Located in Marketplace Data section. |
| [BountyPanel.tsx](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/components/marketplace/BountyPanel.tsx) | 47–372 | Full buyer bounty management UI: deposit form, pool list, withdraw button, socket listeners (`vertical:bounty:deposited`, `bounty:released`). |
| [BuyerDashboard.tsx](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/pages/BuyerDashboard.tsx#L443-L455) | 443–455 | "My Bounty Pools" section with `<BountyPanel />` component. |
| [LeadCard.tsx](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/components/marketplace/LeadCard.tsx#L33) | 33 | `parameters?: { _bountyTotal?: number }` — bounty total is stored as a lead parameter. |
| [auctionStore.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/frontend/src/store/auctionStore.ts#L55) | 55 | Same `_bountyTotal` field in auction store type. |

### "Seed Demo Bounties" Button Implementation

1. **Trigger**: Manual only — the "Seed Demo Bounties" button in the Demo Control Panel (`DemoPanel.tsx:628–634`).
2. **NOT called during 1-click demo** — `runFullDemo()` in `demo-orchestrator.ts` does NOT call `/seed-bounties`. The 1-click demo only runs predfunding → lead drip → settlement cycles.
3. **Backend**: `POST /api/v1/demo-panel/seed-bounties` (`demo-panel.routes.ts:1495`) with `authMiddleware` → `publicDemoBypass`.
4. **Seeds 5 pools** across verticals:

| Vertical | Amount | Criteria |
|----------|--------|----------|
| solar | $350 | QS ≥ 7000, CA/TX/AZ, credit ≥ 700, age ≤ 48h |
| mortgage | $500 | QS ≥ 6500, NY/FL/NJ, credit ≥ 720 |
| roofing | $200 | QS ≥ 5000, TX/FL/GA, age ≤ 72h |
| insurance | $275 | CA/NY/IL, credit ≥ 680 |
| auto | $150 | QS ≥ 4000 |

5. **Post-seed**: Emits `marketplace:refreshAll` socket event to update all connected clients.

### Current Visibility in Live Demo (badges, rewards, UI, Log, Dashboard)

- **Buyer Dashboard**: `BountyPanel` shows active pools, deposit form, and withdraw buttons (only visible after login as Buyer persona).
- **LeadCard**: Has `_bountyTotal` field in type definition — but no visible badge or UI element for bounty currently renders on the marketplace card.
- **On-Chain Log (DevLogPanel.tsx:49, 83)**: Bounty-related messages get the `chainlink` icon type and purple coloring.
- **DemoResults page**: No bounty column or summary card exists.
- **1-click demo**: Bounties are NOT seeded — the judge sees no bounty activity unless they manually click "Seed Demo Bounties" in the Demo Control Panel.

### Gaps

1. **Not auto-seeded in 1-click demo** — judges won't see bounty activity.
2. **No bounty badge on LeadCard** — even if seeded, no visual indicator shows "💰 $350 bounty available".
3. **No bounty column in DemoResults** — the summary dashboard doesn't show bounty releases.
4. **Bounty matching criteria rarely met** — demo leads have random QS/geo, so matching is probabilistic.

---

## 2. VRF Tiebreaker Logic

### Code Evidence (tie detection, requestResolution call, fulfillRandomWords)

| File | Lines | What It Does |
|------|-------|-------------|
| [vrf.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/vrf.service.ts#L17) | 17 | `VRF_TIE_BREAKER_ADDRESS` from env (`0x6DE9fd3A54daFB1E145d66F52E538087a3fAEca8`). |
| [vrf.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/vrf.service.ts#L40-L43) | 40–43 | `isVrfConfigured()` — returns true if address + deployer key are set. |
| [vrf.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/vrf.service.ts#L95-L118) | 95–118 | `requestTieBreak(leadId, candidates, resolveType)` — hashes leadId, sends `requestResolution()` tx on-chain, returns txHash. |
| [vrf.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/vrf.service.ts#L198-L245) | 198–245 | `startVrfResolutionWatcher()` — polls contract every 5s for fulfilled resolution, emits `auction:vrf-resolved` socket event when winner determined. |
| [auction-closure.service.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/auction-closure.service.ts#L259-L326) | 259–326 | **Production VRF tie-break flow** in `resolveAuction()`: Detects tied `effectiveBid` values → picks deterministic fallback (earliest bid) → fires `requestTieBreak()` async → launches `startVrfResolutionWatcher()`. Non-blocking — closure never waits for VRF. |
| [demo-orchestrator.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/demo/demo-orchestrator.ts#L1023-L1027) | 1023–1027 | **Demo tie detection**: `hadTiebreaker = sortedBids.length >= 2 && sortedBids[0].amount === sortedBids[1].amount`. Emits "⚡ Tie detected" DevLog message. |
| [demo-orchestrator.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/demo/demo-orchestrator.ts#L1147-L1149) | 1147–1149 | `vrfTxHashForCycle = hadTiebreaker ? settleReceipt.hash : undefined;` + `totalTiebreakers++` + Basescan link pushed to `vrfProofLinks[]`. |
| [demo-orchestrator.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/demo/demo-orchestrator.ts#L1283) | 1283 | Cycle result includes `hadTiebreaker` and `vrfTxHash` fields. |
| [demo-orchestrator.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/demo/demo-orchestrator.ts#L1331) | 1331 | Summary box: `║  Tiebreaks: ${totalTiebreakers}`. |
| [demo-orchestrator.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/demo/demo-orchestrator.ts#L1337) | 1337 | Final log: `Tiebreakers triggered: ${totalTiebreakers} | VRF proofs: ${vrfProofLinks}`. |
| [demo-orchestrator.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/demo/demo-orchestrator.ts#L1400) | 1400 | `DemoResult` includes `totalTiebreakers` and `vrfProofLinks` fields. |
| [demo-shared.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/demo/demo-shared.ts#L149) | 149 | `hadTiebreaker?: boolean` in `CycleResult` interface. |
| [demo-shared.ts](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/backend/src/services/demo/demo-shared.ts#L166) | 166 | `totalTiebreakers?: number` in `DemoResult` interface. |
| [VRFTieBreaker.sol](file:///c:/Users/Bruce/Projects/Lead%20Engine%20CRE/contracts/contracts/VRFTieBreaker.sol) | All | VRFConsumerBaseV2Plus contract: `requestResolution()` → `fulfillRandomWords()` → `winner = candidates[randomWord % n]`. |

### Current Demo Seeding Behavior and Why Ties Have Been Rare

**Bid randomization** (`demo-orchestrator.ts:169-170`):

```typescript
const variance = Math.round(reservePrice * 0.20);
let bidAmount = Math.max(10, reservePrice + (idx === 0 ? 0 : rand(-variance, variance)));
```

- `reservePrice` varies per lead (typically $20–$50)
- `variance` = ±20% of reserve (e.g., ±$6 for a $30 lead)
- Bids are rounded integers, but the range spans ~12 values ($24–$36)
- With 3–5 bidders per lead, **P(exact tie) ≈ 1 - (11/12 × 10/12 × 9/12) ≈ 10-20%** per lead
- Over 5 settlement cycles, expect **0–1 ties** per demo run

**Persona guarantee** (line 172-174): The buyer persona always bids `reservePrice × 1.3` (highest), further reducing tie probability since one bidder always stands above.

### Visibility in On-Chain Log and demo-results JSON

| Surface | Evidence | What Shows |
|---------|----------|------------|
| On-Chain Log (DevLogPanel) | `demo-orchestrator.ts:1026` | "⚡ Tie detected — [addr]… and [addr]… both bid $X — winner: first lock wins" |
| On-Chain Log summary | `demo-orchestrator.ts:1337` | "💰 Total platform revenue: $X \| Tiebreakers triggered: N \| VRF proofs: [links]" |
| demo-results JSON | `demo-shared.ts:149, 166` | `cycles[].hadTiebreaker`, `cycles[].vrfTxHash`, `totalTiebreakers`, `vrfProofLinks[]` |
| DemoResults page | `DemoResults.tsx:405` | "VRF Tiebreakers" summary card showing `totalTiebreakers` count |

### Gaps for Guaranteed Event

1. **Natural ties are rare** (~10-20% per cycle) — a 5-cycle demo often finishes with `Tiebreakers: 0`.
2. **No forced tie seeding** — the demo doesn't engineer identical bids to guarantee a tie.
3. **VRF resolution is async** — even when a tie occurs, the VRF callback takes 15-90s on Base Sepolia, and the demo may complete before the resolution lands.
4. **DemoResults page** shows tiebreaker count but **no VRF proof link column** in the cycle table.

---

## 3. Current Integration with Single 5-Cycle Demo Button & Recycling Flow

The 1-click demo flow (`runFullDemo()` in `demo-orchestrator.ts:525-1400`):

```
1. Fund check → 2. Kimi agent bootstrap → 3. Pre-fund 10 buyer vaults ($200 each)
4. Start continuous lead drip (1 lead/~20s) → 5. Wait for 1+ live lead
6. Natural settlement monitor (5 min window):
   - Poll every 5s for expired auctions
   - For each: read lock registry → sort bids → detect tie → settle winner → refund losers
   - Per-cycle: records hadTiebreaker, vrfTxHash, platformIncome
7. Batched PoR verify → 8. Summary emit → 9. Wallet recycling
```

**Bounty seeds**: NOT in this flow. Must be manually triggered via DemoPanel.
**VRF tiebreaker**: Fully wired but probabilistic — depends on randomized bids producing exact ties.

---

## 4. Summary Table of Key Evidence

| Claim | File | Line(s) |
|-------|------|---------|
| Bounty service class | `backend/src/services/bounty.service.ts` | 94 |
| Bounty auto-release on auction win | `backend/src/services/auction-closure.service.ts` | 428–478 |
| Seed-bounties endpoint (5 pools, $1,475) | `backend/src/routes/demo-panel.routes.ts` | 1493–1565 |
| "Seed Demo Bounties" UI button | `frontend/src/components/demo/DemoPanel.tsx` | 628–634 |
| Bounty Panel (buyer dashboard) | `frontend/src/components/marketplace/BountyPanel.tsx` | 47–372 |
| API: depositBounty, withdrawBounty, etc. | `frontend/src/lib/api.ts` | 431–451 |
| Bid randomization formula | `backend/src/services/demo/demo-orchestrator.ts` | 169–170 |
| Tie detection in demo | `backend/src/services/demo/demo-orchestrator.ts` | 1023–1024 |
| VRF requestTieBreak (on-chain) | `backend/src/services/vrf.service.ts` | 95–118 |
| VRF tie-break in auction-closure | `backend/src/services/auction-closure.service.ts` | 259–326 |
| hadTiebreaker in cycle result | `backend/src/services/demo/demo-shared.ts` | 149 |
| totalTiebreakers in demo result | `backend/src/services/demo/demo-shared.ts` | 166 |
| VRF tx hash logged per cycle | `backend/src/services/demo/demo-orchestrator.ts` | 1147–1149 |
| Tiebreaker count in summary | `backend/src/services/demo/demo-orchestrator.ts` | 1331, 1337 |
| VRF watcher (async resolution) | `backend/src/services/vrf.service.ts` | 198–245 |
| Bounty NOT seeded in 1-click demo | `backend/src/services/demo/demo-orchestrator.ts` | 525–1400 (absent) |

---

## 5. Recommended Minimal Demo-Only Enhancements

### 5a. Guaranteeing at Least 1 Natural-Looking VRF Tiebreaker per Demo Run

**Problem**: Bid randomization produces ~10-20% tie probability per cycle. With only 5 cycles, most demos show "Tiebreakers: 0".

**Proposal**: In `scheduleBidsForLead()`, for **exactly 1 lead per demo run** (e.g., cycle 3), force two buyers to bid the same amount:

```typescript
// demo-orchestrator.ts:168-170 — add tie-force logic for 1 cycle
const FORCE_TIE_ON_LEAD = 3; // 3rd settled lead
if (settlementCycle === FORCE_TIE_ON_LEAD && idx === 1) {
    bidAmount = prevBidAmount; // match buyer 0's bid exactly → guaranteed tie
}
```

This produces a natural-looking tie in the On-Chain Log (same dollar amount, different wallets), triggering the full VRF pipeline. The DevLog would show "⚡ Tie detected" → VRF requestResolution tx → Basescan proof link.

### 5b. Making Bounties Visibly Surface in the Main 1-Click Demo

**Problem**: Bounties are never seeded during 1-click demo, so the judge sees zero bounty activity.

**Proposal** (two-line change):

1. **Auto-seed bounties at demo start**: Add one call in `runFullDemo()` after pre-funding:
   ```typescript
   // demo-orchestrator.ts — after pre-fund loop (line ~808)
   await bountyService.depositBounty('demo-buyer-bounty', 'solar', 350, 
       { minQualityScore: 5000, geoStates: ['CA', 'TX'] }, BUYER_PERSONA_WALLET);
   emit(io, { ts: '...', level: 'step', message: '💰 Demo bounty pool seeded: $350 Solar (CA/TX, QS≥5000)' });
   ```

2. **Add bounty badge to LeadCard**: When `lead.parameters?._bountyTotal > 0`, show a small green badge:
   ```tsx
   {lead.parameters?._bountyTotal > 0 && (
       <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
           💰 +${lead.parameters._bountyTotal} bounty
       </span>
   )}
   ```

3. **Add bounty release log entry**: Already emitted by `auction-closure.service.ts:459` as `bounty:released` — just needs DevLogPanel to render it prominently.
