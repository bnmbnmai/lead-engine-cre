# CRE Quality Score — Scoring Investigation

> **Generated**: 2026-03-01 · Investigation of why three lead creation paths produce dramatically different CRE scores.

## Observed Symptoms

| Path | Button | Observed Score | Expected |
|---|---|---|---|
| Demo Panel → Inject Single Lead | `POST /demo-panel/lead` | **0** (displays as QS 0) | 75+ |
| Frontend → Simulate Traffic Lead | `POST /ingest/traffic-platform` | **92** (displays as QS 92) | 75+ ✅ |
| Hosted Lander Form (My Funnels) | `POST /marketplace/leads/public/submit` | **1** (displays as QS 1) | 75+ |

---

## How Each Path Scores Leads

### Path 1: Inject Single Lead (`demo-panel.routes.ts` line 984–1010)

```
buildVerticalDemoParams() → computeCREQualityScore() → store raw score → done
```

**Scoring function**: Calls `computeCREQualityScore()` **directly** from `cre-quality-score.ts`.

**Input constructed at line 990–998**:
```ts
const demoScoreInput: LeadScoringInput = {
    tcpaConsentAt: new Date(),        // ✅ Full 2000 pts
    geo: { country, state, zip },     // state=800, zip generated but...
    hasEncryptedData: false,           // ❌ 0 pts (no PII encryption)
    encryptedDataValid: false,         // ❌ 0 pts
    parameterCount: demoParamCount,    // ~4–6 params → 1600–2000 pts
    source: 'PLATFORM',               // 1500 pts
    zipMatchesState: false,            // ❌ hardcoded false → 0 pts geo bonus
};
```

**Expected raw score**: 2000 (TCPA) + 800 (state) + 600 (zip) + 0 (zip match) + 0 (PII) + ~1600 (params) + 1500 (source) = **~6,500/10,000 → displays as QS 65**

**But user sees QS 0** — this means either:
1. The `qualityScore` column defaults to 0 and the frontend reads the DB value before the write completes, OR
2. The `computeCREQualityScore()` input is somehow wrong (e.g., `demoParamCount` = 0 if `buildVerticalDemoParams()` returns an object with internal keys only)

**Key issue**: This path does **NOT** call `creService.verifyLead()`. It uses `computeCREQualityScore()` directly, which has **no `Math.max(7500)` floor**. Even if the raw score is valid, it lacks the floor that the other paths apply.

---

### Path 2: Simulate Traffic Lead (`ingest.routes.ts` line 184)

```
prisma.lead.create() → creService.verifyLead() → computeNumericPreScoreFromLead()
    → confidentialService.computeLeadScore() → Math.max(7500, score) → store
```

**Scoring chain**:
1. `creService.verifyLead(lead.id)` — runs 3-gate check (data, TCPA, geo)
2. On admission → `computeNumericPreScoreFromLead()` (`cre.service.ts` line 458)
3. → `confidentialService.computeLeadScore(lead.id, input)` (TEE stub)
4. → internally calls `computeCREQualityScore(input)` (same function)
5. → **`return Math.max(7500, result.score)`** (`cre.service.ts` line 494) ← **THE FLOOR**

**Input is richer** because ingest leads have:
- `hasEncryptedData: true` + `encryptedDataValid: true` → **+2000** PII bonus
- `zipMatchesState: true` (real zip/state pairs like CA/92101) → **+600** geo bonus
- `source: 'API'` → 1000 pts

**Expected raw score**: 2000 + 800 + 600 + 600 + 2000 + ~1600 + 1000 = **~8,600 → displays as QS 86** (or higher with the floor)

**Plus the `Math.max(7500)` floor** means even a worst-case lead gets 75. The user sees **92** which is consistent: raw score ≈ 9200, displayed as `Math.floor(9200/100)` = 92.

---

### Path 3: Hosted Lander Form (`marketplace.routes.ts` line 594)

```
prisma.lead.create() → creService.verifyLead() → computeNumericPreScoreFromLead()
    → confidentialService.computeLeadScore() → Math.max(7500, score) → store
```

**Identical scoring chain to ingest** — calls `creService.verifyLead()` which goes through `computeNumericPreScoreFromLead()` with the 7500 floor.

**But user sees QS 1** — meaning `qualityScore` is stored as ~100 in the DB. This is suspicious.

**Probable cause**: The hosted lander form creates the lead **without PII encryption** (the frontend form submits raw parameters). The backend at line 569 does encrypt PII server-side into `encryptedData`, but `verifyLead()` is called AFTER the lead is created. At this point `lead.encryptedData` is set. So the scoring should pick it up.

**However**: If the form doesn't include PII fields (no firstName, email, phone) — e.g., a minimal test submission with only non-PII fields — then `encryptedData` is null, meaning:
- `hasEncryptedData: false` → 0 pts
- `encryptedDataValid: false` → 0 pts

Combined with a possible `source: 'PLATFORM'` (1500) and a zip that doesn't match state, the **raw** score could be: 2000 + 800 + 0 + 0 + 0 + 400 + 1500 = 4700 → floored to 7500 → displays as 75.

**Score of 1** suggests the `qualityScore` was stored as `100` (displayed as `Math.floor(100/100)` = 1) or the `verifyLead` path was bypassed somehow. Most likely: the hosted form submission was made before the `Math.max(7500)` floor was added, and the DBvalue was never updated.

---

## Root Cause Summary

| Issue | Affected Path | Root Cause |
|---|---|---|
| **Score = 0** | Inject Single Lead | `computeCREQualityScore()` called directly (no `verifyLead`, no 7500 floor). Also: `zipMatchesState: false` hardcoded, `hasEncryptedData: false` |
| **Score = 92** | Simulate Traffic Lead | Full `verifyLead()` pipeline with PII encryption, real geo data, 7500 floor ✅ |
| **Score = 1** | Hosted Lander Form | Full `verifyLead()` pipeline — but may have been scored before floor was added, or form submitted without PII fields + sparse geo |

### The Two Underlying Bugs

1. **`demo-panel /lead` bypasses `verifyLead()`** — it calls `computeCREQualityScore()` directly with synthetic inputs where `zipMatchesState: false` and `hasEncryptedData: false`. This skips the 7500 floor AND the TEE-enriched scoring path.

2. **`computeCREQualityScore()` has no floor** — the raw function in `cre-quality-score.ts` returns 0–10,000 without any minimum. The 7500 floor lives only in `computeNumericPreScoreFromLead()` at `cre.service.ts` line 494: `return Math.max(7500, result.score)`.

---

## Where the Scoring Code Lives

| Component | File | Line | Purpose |
|---|---|---|---|
| Raw scoring algorithm | `lib/chainlink/cre-quality-score.ts` | 50–104 | `computeCREQualityScore()` — 5 categories, 0–10,000, **no floor** |
| Floor wrapper | `services/cre.service.ts` | 493–494 | `Math.max(7500, result.score)` inside `computeNumericPreScoreFromLead()` |
| Full verify pipeline | `services/cre.service.ts` | 140–318 | `verifyLead()` — 3-gate + calls `computeNumericPreScoreFromLead()` |
| TEE stub | `services/confidential.service.ts` | 88 | `computeLeadScore()` — wraps `computeCREQualityScore()` |
| Demo bypass (bug) | `routes/demo-panel.routes.ts` | 996–999 | Calls `computeCREQualityScore()` directly, **no floor** |
| CRE workflow trigger | `services/cre.service.ts` | 1233–1242 | `afterLeadCreated()` — fire-and-forget buyer matching |
| DON source code | `lib/chainlink/cre-quality-score.ts` | 115–164 | `DON_QUALITY_SCORE_SOURCE` — same algo for on-chain |

---

## Recommendation: Consistent Chainlink CRE Scoring

### Fix 1: Make Inject Single Lead use `verifyLead()` (preferred)

Replace the manual `computeCREQualityScore()` call in `demo-panel.routes.ts /lead` with:
```ts
// After prisma.lead.create():
const verification = await creService.verifyLead(lead.id);
// qualityScore is now set in the DB by verifyLead → computeNumericPreScoreFromLead
```

This gives demo-injected leads the same scoring path as traffic/hosted leads, including:
- PII encryption (if PII data is present)
- `Math.max(7500)` floor
- Confidential TEE enrichment
- Consistent `afterLeadCreated()` call (already present)

### Fix 2: Also fix the Seed Marketplace scoring

Same issue: `demo-panel.routes.ts /seed` (line 796) calls `computeCREQualityScore()` directly. Switch to `verifyLead()` or at minimum apply the 7500 floor.

### Fix 3: Add PII to demo leads

Currently demo leads from Inject Single Lead have `hasEncryptedData: false` → 0/2000 PII points. Generate mock PII and encrypt it to give demo leads the full 2000-point PII bonus. This makes scores realistic (85–95 range).

### Why NOT move the floor into `computeCREQualityScore()` itself

The floor in `computeNumericPreScoreFromLead()` is intentional: `computeCREQualityScore()` is the **pure DON algorithm** that also runs on-chain via Chainlink Functions. The DON version should return honest 0–10,000 scores. The floor is a **backend display policy** applied after the pure score. Moving it into the pure function would change the on-chain scoring contract behavior.

### Ideal Single Source of Truth

```
All paths → creService.verifyLead(leadId) → computeNumericPreScoreFromLead()
                                           → computeCREQualityScore()  [pure]
                                           → Math.max(7500, score)     [floor]
                                           → store in DB
```

No path should ever call `computeCREQualityScore()` directly to store a score. The only legitimate direct caller is the DON source code (`DON_QUALITY_SCORE_SOURCE`).
