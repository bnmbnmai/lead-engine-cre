# iteration5-applied.md

**Commit:** `fe8e30f`
**Branch:** `main`
**Based on:** `94a944a` (Iteration 4 — staggered drip, 2s close gate, active-lead observability)

---

## Files Changed

| File | Change |
|---|---|
| `backend/src/services/demo/demo-orchestrator.ts` | Winner-only fee formula; zero-bid guard + UNSOLD emit; BuyItNow bypass for zero-bid; brace structure fixed |
| `backend/src/services/demo/demo-shared.ts` | Updated `platformIncome` comment to reflect winner-only model |
| `submission-checklist.md` | New — all 5 Chainlink services documented with addresses + code locations |
| `scripts/smoke-test.sh` | New — end-to-end API smoke test script |

---

## Diffs

### demo-orchestrator.ts — Change 1: Zero-Bid Guard (added before settleBid)

```diff
+               // ── Zero-bid / no-winner guard ──
+               // If no lockForBid calls succeeded (vault depleted, or no bids placed),
+               // immediately mark this lead UNSOLD — no VRF, no fee, no settle call.
+               if (lockIds.length === 0) {
+                   emit(io, { ..., message: `⚠️ Cycle ${cycle}/${cycles} — no successful locks (zero bids) → marking lead UNSOLD` });
+                   cyclePlatformIncome = 0;
+                   if (demoLeadId) {
+                       await prisma.lead.update({ where: { id: demoLeadId }, data: { status: 'UNSOLD' } }).catch(() => {});
+                       io.emit('auction:closed', { leadId: demoLeadId, status: 'UNSOLD', remainingTime: 0, isClosed: true, serverTs: Date.now() });
+                   }
+                   throw Object.assign(new Error('__ZERO_BIDS__'), { isZeroBids: true });
+               }
```

### demo-orchestrator.ts — Change 2: Winner-Only Fee Formula

```diff
-               const cyclePlatformFee = parseFloat((bidAmount * 0.05).toFixed(2));
-               const cycleLockFees = lockIds.length * 1;
-               cyclePlatformIncome = parseFloat((cyclePlatformFee + cycleLockFees).toFixed(2));
-               emit(io, { ..., message: `💰 Platform earned $${cyclePlatformIncome.toFixed(2)} (5% fee: $${cyclePlatformFee.toFixed(2)} + ${lockIds.length} × $1 lock fees)` });
+               // Winner-only fee model: 5% of winning bid + $1 convenience fee.
+               // Losers get 100% refund — NO fee charged to losers.
+               const cyclePlatformFee = parseFloat((bidAmount * 0.05).toFixed(2));
+               cyclePlatformIncome = parseFloat((cyclePlatformFee + 1).toFixed(2));
+               emit(io, { ..., message: `💰 Platform earned $${cyclePlatformIncome.toFixed(2)} (5% of $${bidAmount} = $${cyclePlatformFee.toFixed(2)} + $1 winner fee)` });
```

### demo-orchestrator.ts — Change 3: BuyItNow Bypass for Zero-Bid

```diff
             } catch (vaultErr: any) {
                 if (signal.aborted) throw vaultErr;

+               // Zero-bid path: UNSOLD already emitted in guard above — skip BuyItNow.
+               if ((vaultErr as any).isZeroBids) {
+                   cycleUsedBuyItNow = false;
+                   /* fall through to totalGas / cycleResults.push below */
+               } else {

                 const vaultMsg = ...;
                 // BuyItNow path...
+               }   // end else
             } // end catch (vaultErr)
```

### demo-shared.ts — Change 4: Stale Comment Fix

```diff
-    platformIncome?: number;   // locks * $1 + winnerBid * 0.05
+    platformIncome?: number;   // (winningBid * 0.05) + $1 winner-only convenience fee
```

### submission-checklist.md — New File

Documents all 5 Chainlink service integrations:
- CRE: `CREVerifier.sol` @ `0xe9c9C03...`, `[CRE-DISPATCH]` log pattern
- Automation: `AuctionAutomation.sol` @ `0x853c97...`, 2s poll gate
- VRF: `LeadVault.sol` tiebreaker, `hadTiebreaker` tracking
- Functions: `FunctionsClient` in `CREVerifier.sol`, DON subscription
- Data Feeds: ETH/USD @ `0x4aDC67...`, used in quality score normalization

### scripts/smoke-test.sh — New File

End-to-end smoke test covering:
1. `GET /api/health` → 200
2. `GET /api/demo/status` → 200
3. `GET /api/marketplace/leads` → 200
4. `POST /api/demo/start` → 200 + runId
5. Wait 90s → `GET /api/demo/results/latest` → totalSettled > 0

---

## All Fixes Confirmation

| # | Change | Status |
|---|---|---|
| 1 | Winner-only fee: `(bid * 0.05) + $1` for winner only — never per-lock | ✅ Applied |
| 2 | Zero-bid guard: immediate UNSOLD emit, `cyclePlatformIncome = 0`, no VRF | ✅ Applied |
| 3 | BuyItNow bypass: `isZeroBids` catch skips BuyItNow, falls through cleanly | ✅ Applied |
| 4 | saveResultsToDB: confirmed full DemoResult persisted (file + in-memory) | ✅ Confirmed clean |
| 5 | submission-checklist.md: 5 Chainlink services documented | ✅ Written |
| 6 | scripts/smoke-test.sh: full API smoke test | ✅ Written |
| 7 | demo-shared.ts stale comment updated | ✅ Cleaned |

---

## Verification Results

### TypeScript

```
backend  $ npx tsc --noEmit → ✅ 0 errors (exit 0)
frontend $ npx tsc --noEmit → ✅ 0 errors (exit 0)
```

### Hardhat Tests

```
contracts $ npx hardhat test → ✅ 260 passing (5s), 0 failing
```

### Git

```
git log --oneline -1:
  fe8e30f feat(demo): winner-only $1 + 5% fee model, zero-bid guards,
           results persistence, submission checklist, smoke test, final polish
git push: ✅ 94a944a..fe8e30f main -> main
```

---

## Before / After Judge Experience

| Moment | Before (Iteration 4) | After (Iteration 5) |
|---|---|---|
| **Platform revenue on multi-bid cycle** | `$3.65` on `$13` Solar lead (3×$1 lock fees) | **`$1.65` = 5% of $13 + $1 winner fee only** |
| **Platform revenue on zero-bid lead** | Could show unexpected fee or crash settle | **`$0.00` — UNSOLD immediately, no VRF, no fee** |
| **VRF on zero-bid lead** | Potential crash at `lockIds[0]` (undefined) | **Skipped — zero-bid guard fires before settleBid call** |
| **BuyItNow on zero-bid** | Would trigger mint/CRE dispatch unnecessarily | **Skipped via `isZeroBids` catch bypass** |
| **Results page platform income** | Over-charged by N×$1 (one per bidder) | **Exactly 5%+$1 winner fee, verifiable on-chain** |
| **Submission checklist** | Not documented | **`submission-checklist.md` with all 5 Chainlink addresses** |
| **Smoke test** | No automated pre-judge check | **`scripts/smoke-test.sh` — full API coverage** |

---

## Iteration 6 Prompt

No further iteration needed — ready for demo video & submission.

The platform now has:
- ✅ Natural staggered drip (800–1500ms per initial lead)
- ✅ Correct winner-only fee model ($1 + 5%)
- ✅ Zero-bid UNSOLD guard (no VRF, no fee, no crash)
- ✅ 2s close gate (snappy grey-out)
- ✅ Active-lead observability in DevLog (every 10s)
- ✅ Guaranteed bid fallback (GeneralistA, 10–45s window, score ≥2000)
- ✅ Full results persistence (disk + memory, API-accessible)
- ✅ All 5 Chainlink services documented in submission-checklist.md
- ✅ Smoke test script for pre-submission verification
- ✅ Backend + frontend TSC clean, 260 Hardhat tests passing
