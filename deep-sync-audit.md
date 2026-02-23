# Deep Sync & Lead Injection Audit — Lead Engine CRE (04fa05c)

Deep audit started — I have read all requested files and absorbed the latest screenshot + full dev logs.

---

## 1. Files Read

| File | Why It Matters |
|---|---|
| `backend/src/config/perks.env.ts` | Source of truth for all demo tuning knobs: `DEMO_INITIAL_LEADS=12`, `DEMO_MIN_ACTIVE_LEADS=8`, `DEMO_LEAD_DRIP_INTERVAL_MS=4500ms` |
| `backend/src/services/demo/demo-orchestrator.ts` | Main entry point. Contains the hardcoded 3-lead burst (line 447–453), the per-cycle lead-injection loop (lines 588–608), and the vault-depletion skip logic (lines 648–651) |
| `backend/src/services/demo/demo-lead-drip.ts` | Defines `injectOneLead`, `startLeadDrip`, `checkActiveLeadsAndTopUp`. **`startLeadDrip` is never called from `runFullDemo`** — the function exists but is dead code in the main flow |
| `backend/src/services/demo/demo-shared.ts` | Constants (`DEMO_INITIAL_LEADS`, `DEMO_MIN_ACTIVE_LEADS`, `LEAD_AUCTION_DURATION_SECS`, `DEMO_LEAD_DRIP_INTERVAL_MS`), shared utilities |
| `backend/src/services/demo/demo-buyer-scheduler.ts` | `BUYER_PROFILES` (10 personas), `scheduleBuyerBids`, post-fix cumulative `bidCount`. LegalEagle `minScore=8000`, FinancePilot `minScore=7500` — still high, causing zero bids on legal/financial leads |
| `backend/src/services/auction-closure.service.ts` | Auction closure, `resolveExpiredAuctions` (now 5s gate), `resolveStuckAuctions` (now `lead:status-changed`) |
| `frontend/src/store/auctionStore.ts` | Zustand store. `addLead` now seeds `liveBidCount` from `_count.bids`. `updateBid` uses `serverTs` for drift correction |
| `frontend/src/components/marketplace/LeadCard.tsx` | Renders per-lead card, shows bid count, handles grey-out/fade logic |

---

## 2. Executive Summary

### Three Remaining Issues (post-04fa05c)

| Issue | Root Cause | Severity |
|---|---|---|
| **3 leads appear at demo start** (not 0) | Hardcoded `for (si < 3)` burst at line 447–453 runs before buyer wallets are funded, before `startLeadDrip` (which is never actually called anyway) | Critical |
| **"0 bids" shown despite successful `lockForBid` txs** | Cascading skip: 15% cold-auction rate + high `minScore` floors filter out ALL eligible buyers on many leads, leaving them with 0 scheduled bids | High |
| **Active leads drop to 2–3 (target ≥8)** | `startLeadDrip` is dead code in `runFullDemo`. The per-cycle loop only creates `cycles` (=5) leads staggered 10–15s apart. After all 5 cycle-leads close (~60s), the watchdog only warns — it does not inject | High |

---

## 3. Full Lead Lifecycle Map

```
runFullDemo()
  │
  ├── [Hardcoded] for (si = 0; si < 3)          ← BUG: 3-lead burst before buyer wallets funded
  │     └── injectOneLead()
  │           ├── prisma.lead.create()
  │           ├── io.emit('marketplace:lead:new', {..., _count: { bids: 0 }})
  │           ├── io.emit('auction:updated', { bidCount: 0, serverTs: Date.now() })
  │           └── scheduleBuyerBids()             ← called but vault not funded yet → all vault.balanceOf checks fail
  │
  ├── [Serialized] Pre-fund 10 buyer vaults to $200 each (~2 min on testnet)
  │
  ├── replenishInterval(15s)                      ← warns "drip will replenish shortly" but does NOT inject
  │
  ├── [Per-cycle loop] for (pi = 0; pi < cycles)  ← creates exactly `cycles` leads (default 5)
  │     └── prisma.lead.create + io.emit          ← no scheduleBuyerBids() here — these leads get 0 bids
  │                                                  from drip scheduler (bidding handled in the cycle block)
  │
  ├── [Auction Cycles] for (cycle = 1; cycle <= cycles)
  │     ├── Select 3–6 buyers from round-robin
  │     ├── Check vault balance → skip if depleted  ← vault depletion skip
  │     ├── lockForBid (on-chain)
  │     ├── io.emit('auction:updated', { bidCount: b+1, serverTs: Date.now() }) ← now correct
  │     └── resolveAuction / BuyItNow
  │
  └── [startLeadDrip] never called                 ← dead code in this flow
```

**Frontend side (for any lead that arrives via `marketplace:lead:new`):**
```
socketBridge.ts onLeadNew
  └── auctionStore.addLead(lead)
       ├── liveBidCount = lead._count?.bids ?? null   ← BUG-5 fixed
       ├── liveRemainingMs computed
       └── LeadCard renders with phase='live'

socketBridge.ts onAuctionUpdated
  └── auctionStore.updateBid({ bidCount, serverTs })
       ├── clockDrift = Date.now() - serverTs        ← now correct (serverTs is ms, not ISO string)
       └── liveBidCount = Math.max(current, bidCount) ← monotonic guard

auction-closure.service.ts (every 2s)
  └── resolveExpiredAuctions
       ├── ageMs < 5_000 → skip                      ← now 5s (was 58s)
       └── io.emit('auction:closed', { serverTs: Date.now() })
            └── auctionStore.closeLead()
                 └── LeadCard fades out after 8s grace
```

---

## 4. Exact Code Paths for the 3-Lead Burst

### Where `DEMO_INITIAL_LEADS` is defined

**`backend/src/config/perks.env.ts:111`:**
```typescript
export const DEMO_INITIAL_LEADS = parseInt(process.env.DEMO_INITIAL_LEADS || '12', 10);
```

### The 3-lead burst (the actual culprit)

**`backend/src/services/demo/demo-orchestrator.ts:446–454`:**
```typescript
// Step 0b: Seed 3 leads immediately
emit(io, { ts: new Date().toISOString(), level: 'step', message: `🌱 Seeding 3 initial leads into marketplace — visible immediately while we fund buyer wallets...` });
{
    const seedSellerId = await ensureDemoSeller(DEMO_SELLER_WALLET);
    for (let si = 0; si < 3 && !signal.aborted; si++) {    // ← HARDCODED 3, ignores DEMO_INITIAL_LEADS
        try { await injectOneLead(io, seedSellerId, si); } catch { /* non-fatal */ }
        await sleep(200);
    }
}
```

**Problem 1:** `DEMO_INITIAL_LEADS=12` is defined but never used in `runFullDemo`. The constant only lives in `startLeadDrip` (which is never called).

**Problem 2:** The 3 leads are injected BEFORE `Pre-fund ALL buyer vaults to $200` (line 456–557). When `scheduleBuyerBids` fires for these 3 seeds, all vault balance checks (`vault.balanceOf`) return ~$0 or close to $0, causing every buyer to be skipped. Result: 3 leads with 0 bids.

**`startLeadDrip` is NEVER called from `runFullDemo`** — confirmed via `grep_search`:
```
No results found for 'startLeadDrip' in demo-orchestrator.ts
```

The `startLeadDrip` function in `demo-lead-drip.ts` (with its `DEMO_INITIAL_LEADS` burst + continuous while loop) is completely disconnected from the main demo flow.

### Per-cycle leads (lines 588–608)

```typescript
for (let pi = 0; pi < cycles && !signal.aborted; pi++) {
    // ... creates 1 lead per cycle, no scheduleBuyerBids call here
    // bidding handled separately in the Auction Cycles block
    if (pi < cycles - 1) await sleep(rand(10000, 15000));  // 10–15s between leads
}
```

These leads DO get bids (from the Auction Cycles block), but they are `cycles` leads total (default=5), not a living drip.

---

## 5. Bid Visibility & Sync Gaps Post-Fixes

### Why cards still show "0 bids" despite confirmed `lockForBid` txs

**Path A — 3 seed leads burst before vault funding:**
- `injectOneLead` → `scheduleBuyerBids` → checks `vault.balanceOf(buyerAddr)` (line 191–200 in scheduler)
- Buyer vaults are empty at this point (funding happens after the burst)
- All 10 buyers fail the `freeBalance < bidAmount` guard → `return` without bidding
- These leads finish their 60s with 0 bids; no `auction:updated` ever emitted for them with `bidCount > 0`

**Path B — High `minScore` floor cascading skips:**
- `LegalEagle` minScore=8000, `FinancePilot` minScore=7500 (unchanged from audit fixes)
- Most drip leads use `computeCREQualityScore` with no `encryptedData`, `zipMatchesState=false`, limited params → typical score ~4000–6000
- Result: For `legal` vertical, only `LegalEagle` is eligible, but minScore=8000 eliminates it too
- For `financial_services`, only `FinancePilot` is eligible, but minScore=7500 often eliminates it
- 15% cold-auction skip (line 121) fires before any buyer loop → these leads get 0 bids guaranteed
- The remaining 85% still face per-buyer 10% skip + vertical mismatch filters

**Path C — Race condition between `marketplace:lead:new` and `auction:updated`:**
- `injectOneLead` emits `marketplace:lead:new` then immediately emits `auction:updated` (lines 209–237)
- These are two separate socket events; `socketBridge` processes them in order
- `addLead` runs first (seeds `liveBidCount` from `_count.bids = 0`), then `updateBid` runs with `bidCount: 0`
- This is correct behaviour — no race. But first visible bid requires the **first** scheduler bid to fire, which takes at minimum 10s after `auctionEndAt - delaySec`
- If all buyers are skipped (paths A+B), no update ever arrives → card stays at 0 bids for its entire 60s life

### The DeLog vs UI discrepancy

DevLog shows "✅ X bid confirmed: $Y locked" because those are from the **Auction Cycles block** (lines 686–770), which uses the orchestrator's own lockForBid logic directly, not the scheduler. These cycle bids DO emit `auction:updated` with the correct `serverTs: Date.now()`, but they only target the `drippedLeads[cycle-1].leadId` — the specific per-cycle leads. The 3 seed leads never receive these updates.

---

## 6. Vault & Drip Health Analysis

### Why "Active leads: 3 (target ≥8)"

The replenishment watchdog (lines 568–577):
```typescript
replenishInterval = setInterval(async () => {
    const activeCount = await prisma.lead.count({ where: { source: 'DEMO', status: 'IN_AUCTION' } });
    if (activeCount < DEMO_MIN_ACTIVE_LEADS) {
        emit(io, { ..., message: `⚠️ Active leads: ${activeCount} (target ≥${DEMO_MIN_ACTIVE_LEADS}) — drip will replenish shortly` });
        io.emit('leads:updated', { activeCount, source: 'watchdog' });
    }
}, 15_000);
```

**This only warns — it never calls `injectOneLead`**. The "drip will replenish shortly" message is misleading. There is no automatic injection.

With `cycles=5`: 3 seed leads + 5 per-cycle leads = 8 leads total created. But:
- 3 seed leads open right away and expire (with 0 bids) within 60s
- 5 per-cycle leads open every 10–15s and expire within 60s of creation
- Since leads only last 60s and drip is ~10–15s between them, at any point in time only 4–6 are live
- After all 5 cycles complete, 0 new leads are ever created → count drops to 0

### Vault depletion skips

The Auction Cycles block uses round-robin buyer selection (lines 621–651). After several cycles, buyers' vault balances deplete from successful bids (the lock is not refunded until the settle step). If the demo runs multiple times without recycling, buyers' vaults hit $0 and all become "vault-depleted" → entire cycle skipped. This explains the "skipped cycles 4 & 5" and "All 3 selected buyers vault-depleted" log lines.

### `DEMO_INITIAL_LEADS=12` is unused

The constant is imported in `demo-lead-drip.ts` and used on line 351 of `startLeadDrip`:
```typescript
for (let i = 0; i < DEMO_INITIAL_LEADS && !stopped && !signal.aborted; i++) {
```
But since `startLeadDrip` is never called from `runFullDemo`, the constant has zero effect on the running demo.

---

## 7. Proposed Clean Changes

### Goal: `marketplace starts empty → smooth natural staggered drip → real-time visible bid activity on every card → clean grey-out/fade exactly when auctions end`

### Change 1 — Remove the 3-lead burst entirely

**File:** `backend/src/services/demo/demo-orchestrator.ts:446–454`

The burst leads are seeded before buyer wallets are funded. Remove the entire `Step 0b` block.

```diff
- // Step 0b: Seed 3 leads immediately
- emit(io, { ts: new Date().toISOString(), level: 'step', message: `🌱 Seeding 3 initial leads into marketplace — visible immediately while we fund buyer wallets...` });
- {
-     const seedSellerId = await ensureDemoSeller(DEMO_SELLER_WALLET);
-     for (let si = 0; si < 3 && !signal.aborted; si++) {
-         try { await injectOneLead(io, seedSellerId, si); } catch { /* non-fatal */ }
-         await sleep(200);
-     }
- }
```

### Change 2 — Wire `startLeadDrip` as the live drip engine

After buyer pre-funding completes (line ~563), replace the per-cycle lead creation loop with `startLeadDrip`. The drip loop handles:
- Initial burst of `DEMO_INITIAL_LEADS=12` leads (staggered 300ms apart — fast enough to feel immediate but not a wall)
- Continuous drip at 4.5s average interval
- `checkActiveLeadsAndTopUp` enforcement of the 8-lead minimum

**File:** `backend/src/services/demo/demo-orchestrator.ts` — add import at top and wire in after pre-fund:

```diff
 import {
     buildDemoParams,
     ensureDemoSeller,
     injectOneLead,
     checkActiveLeadsAndTopUp,
+    startLeadDrip,
 } from './demo-lead-drip';
```

After pre-fund summary (line ~563), before the `for (pi = 0; pi < cycles)` block:

```diff
+ // Step 2a: Start continuous lead drip (runs in background, parallel to cycles)
+ emit(io, { ts: new Date().toISOString(), level: 'step', message: `🌱 Starting marketplace drip — ${DEMO_INITIAL_LEADS} leads seeding now, then 1 every ~${Math.round(DEMO_LEAD_DRIP_INTERVAL_MS / 1000)}s…` });
+ const leadDrip = startLeadDrip(io, signal, 0, 30);
```

Remove the old per-cycle lead creation loop (lines 588–609) since the orchestrator's cycle block already fetches the lead from `drippedLeads`. Replace drippedLeads population with a DB query per cycle that picks the oldest active lead not yet processed.

**But** — this requires rethinking how cycles pick their lead. The simplest clean approach:

**Each auction cycle picks the oldest `IN_AUCTION` lead from the DB that hasn't had its vault cycle run yet.** This decouples lead injection from cycle execution entirely.

### Change 3 — Fix per-cycle lead selection (decouple drip from cycles)

**File:** `backend/src/services/demo/demo-orchestrator.ts:588–609`

Instead of the per-cycle lead creation loop, each cycle fetches the next un-cycled lead from the DB:

```diff
- interface DrippedLead { leadId: string; vertical: string; baseBid: number; }
- const drippedLeads: DrippedLead[] = [];
- for (let pi = 0; pi < cycles && !signal.aborted; pi++) {
-     // ... create lead, sleep 10–15s ...
- }
```

Replace with a processed-lead Set and per-cycle DB fetch:

```typescript
const processedLeadIds = new Set<string>();

// (inside cycle loop, replace drippedLeads[cycle-1] references)
const nextLead = await prisma.lead.findFirst({
    where: {
        source: 'DEMO',
        status: 'IN_AUCTION',
        auctionEndAt: { gt: new Date() },
        id: { notIn: Array.from(processedLeadIds) },
    },
    orderBy: { createdAt: 'asc' },
});
if (!nextLead) {
    emit(io, { ..., message: `⚠️ No available lead for cycle ${cycle} yet — waiting 3s for drip...` });
    await sleep(3000);
    continue; // retry this cycle
}
processedLeadIds.add(nextLead.id);
const demoLeadId = nextLead.id;
const vertical = nextLead.vertical;
const baseBid = nextLead.reservePrice;
```

### Change 4 — Make replenishment watchdog actually inject

**File:** `backend/src/services/demo/demo-orchestrator.ts:568–577`

```diff
 replenishInterval = setInterval(async () => {
     try {
         const activeCount = await prisma.lead.count({ where: { source: 'DEMO', status: 'IN_AUCTION' } });
         if (activeCount < DEMO_MIN_ACTIVE_LEADS) {
             emit(io, { ..., message: `⚠️ Active leads: ${activeCount} (target ≥${DEMO_MIN_ACTIVE_LEADS}) — drip will replenish shortly` });
             io.emit('leads:updated', { activeCount, source: 'watchdog' });
         }
     } catch { /* non-fatal */ }
 }, 15_000);
```

This is now fine — `startLeadDrip` handles replenishment automatically via `checkActiveLeadsAndTopUp` after each drip.

### Change 5 — Lower minScore floors for LegalEagle and FinancePilot

**File:** `backend/src/services/demo/demo-buyer-scheduler.ts:48–49`

```diff
- { index: 4, name: 'LegalEagle',    tag: 'legal-premium',  verticals: ['legal'],                               minScore: 8000, maxPrice: 120, aggression: 0.90, timingBias: 52 },
- { index: 5, name: 'FinancePilot',  tag: 'fin-services',   verticals: ['financial_services', 'insurance'],     minScore: 7500, maxPrice: 100, aggression: 0.70, timingBias: 42 },
+ { index: 4, name: 'LegalEagle',    tag: 'legal-premium',  verticals: ['legal'],                               minScore: 4000, maxPrice: 120, aggression: 0.90, timingBias: 52 },
+ { index: 5, name: 'FinancePilot',  tag: 'fin-services',   verticals: ['financial_services', 'insurance'],     minScore: 4000, maxPrice: 100, aggression: 0.70, timingBias: 42 },
```

### Change 6 — Cut cold-auction rate from 15% to 5%

**File:** `backend/src/services/demo/demo-buyer-scheduler.ts:121`

```diff
- if (Math.random() < 0.15) {   // ~15% of leads get 0 bids
+ if (Math.random() < 0.05) {   // ~5% of leads get 0 bids
```

### Change 7 — Add guaranteed-bid fallback (zero-bid insurance)

After all buyer checks in `scheduleBuyerBids`, if `scheduledCount === 0`, force at least one bid from the lowest-minScore eligible buyer (`GeneralistA`, minScore=3000):

**File:** `backend/src/services/demo/demo-buyer-scheduler.ts` — at end of `scheduleBuyerBids`, after the for loop:

```typescript
// Guaranteed-bid fallback: if no buyer scheduled, force GeneralistA
if (scheduledCount === 0 && qualityScore >= 3000 && VAULT_ADDRESS) {
    const fallback = BUYER_PROFILES.find(p => p.name === 'GeneralistA')!;
    const fallbackBid = Math.min(reservePrice + 2, fallback.maxPrice);
    const fallbackDelay = Math.round((10 + Math.random() * 15) * 1000);
    const fallbackTimer = setTimeout(async () => {
        // ... same lockForBid pattern as existing buyer code ...
    }, fallbackDelay);
    timers.push(fallbackTimer);
}
```

---

## 8. Verification Plan

### Automated

```powershell
# Backend TypeScript (must be exit 0)
cd "c:\Users\Bruce\Projects\Lead Engine CRE\backend"
npx tsc --noEmit

# Frontend TypeScript (must be exit 0)
cd "c:\Users\Bruce\Projects\Lead Engine CRE\frontend"
npx tsc --noEmit

# Contracts (must be 260 passing)
cd "c:\Users\Bruce\Projects\Lead Engine CRE\contracts"
npx hardhat test
```

### Manual Demo Run Check

After applying changes:
1. Start the backend + frontend dev servers
2. Open the marketplace — **should be completely empty (0 leads)**
3. Click "Full E2E Demo" in the Demo Control Panel
4. In the DevLog, confirm: `"Starting marketplace drip — 12 leads seeding now…"` (not `"Seeding 3 initial leads"`)
5. Leads should appear ONE AT A TIME with ~300ms stagger, not in a burst of 3
6. Each new card should show a bid count ≥1 within 10–55s of appearing
7. After all visible cards show bids, grey-out should occur within ~7s of `auctionEndAt`
8. Active lead count in DevLog should stay ≥8 throughout the run

---

## 9. Recommended Next Prompt (Iteration 3)

```
You are working on Lead Engine CRE (commit 04fa05c). The 5 critical sync fixes are confirmed applied.
We are in pure tech excellence mode. Apply these Iteration 3 changes:

1. REMOVE 3-LEAD BURST (demo-orchestrator.ts:446-453)
   Delete the "Step 0b: Seed 3 leads immediately" block entirely (lines 446–454).
   The marketplace must start completely empty.

2. WIRE startLeadDrip AS THE LIVE DRIP ENGINE
   - Add `startLeadDrip` to the import from './demo-lead-drip' at the top of demo-orchestrator.ts
   - After the pre-fund completion log (~line 563), before the per-cycle lead loop, add:
       const leadDrip = startLeadDrip(io, signal, 0, 30);
   - At the end of the demo (before or alongside the existing interval cleardowns), call:
       leadDrip.stop();

3. DECOUPLE CYCLE LEAD SELECTION FROM DRIP
   - Remove the "Step 2: Lead drip" per-cycle creation loop (lines 582–609) including the
     `drippedLeads` array and the `interface DrippedLead` declaration.
   - In the Auction Cycles block, replace `drippedLeads[cycle-1].*` references with a DB
     query that fetches the oldest available unprocessed IN_AUCTION lead:
       const processedLeadIds = new Set<string>();
       // ... inside cycle loop ...
       const nextLead = await prisma.lead.findFirst({
           where: { source: 'DEMO', status: 'IN_AUCTION', auctionEndAt: { gt: new Date() },
                    id: { notIn: Array.from(processedLeadIds) } },
           orderBy: { createdAt: 'asc' },
       });
       if (!nextLead) { await sleep(3000); continue; }
       processedLeadIds.add(nextLead.id);
   - Replace demoLeadId, vertical, baseBid with nextLead.id, nextLead.vertical, nextLead.reservePrice.

4. LOWER minScore FLOORS (demo-buyer-scheduler.ts:48-49)
   - LegalEagle: minScore 8000 → 4000
   - FinancePilot: minScore 7500 → 4000

5. CUT COLD-AUCTION RATE (demo-buyer-scheduler.ts:121)
   - Change: if (Math.random() < 0.15) → if (Math.random() < 0.05)

6. GUARANTEED-BID FALLBACK (demo-buyer-scheduler.ts)
   After the buyer for-loop in scheduleBuyerBids, add a fallback that fires if scheduledCount === 0:
   Force one bid from GeneralistA (index=6, minScore=3000, maxPrice=45) using the same
   lockForBid pattern, with a random delay of 10–25s. Only fire if qualityScore >= 3000.

After all changes:
- Run npx tsc --noEmit (backend + frontend, both must be clean)
- Run npx hardhat test (must be 260 passing)
- Commit with: "feat(demo): empty-start drip, decouple cycles, guarantee bids, cut cold-auction rate"
- Output only a file called iteration3-applied.md with the same format as fixes-applied.md:
  full diffs, verification results, before/after judge experience, and the Iteration 4 prompt.
```
```
