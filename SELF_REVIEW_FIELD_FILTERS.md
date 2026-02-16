# Field-Level Filtering — Self-Review (All 5 Prompts)

## ✅ Correct Behaviors

| # | Area | Status |
|---|------|--------|
| 1 | **Operator round-trip** | OP_MAP (write) and OP_REVERSE (read) are exact inverses for all 11 operators |
| 2 | **PII gate** | 3 layers: VerticalField.isPii in /fields endpoint, isBiddable/isPii in PUT, parameters stripped in search response |
| 3 | **Cascade integrity** | BuyerFieldFilter → BuyerPreferenceSet has onDelete:Cascade; deleting a pref set cleans up filters |
| 4 | **Multi-select serialization** | Single: `op=='=='`, Multiple: `op=='includes'` + JSON.stringify array. field-filter.service handles both |
| 5 | **formConfig fallback** | /fields endpoint works pre-migration using formConfig JSON |
| 6 | **Null-safe evaluation** | field-filter.service returns `false` for null/undefined lead values (fail-closed) |

## ⚠️ Warnings

| # | Issue | Impact | Suggested Fix |
|---|-------|--------|---------------|
| 7 | **Delete-then-recreate on save** | BuyerFieldFilter.id changes every save — no external refs exist today | Switch to upsert-by-unique(`preferenceSetId, verticalFieldId`) if IDs are surfaced |
| 8 | **`as any` casts in bidding.routes** | Required until `prisma generate` runs. 5 casts total: 2 in GET, 3 in PUT | Remove after running migration |
| 9 | **Per-set vertical lookup in PUT** | N×2 queries per save (vertical + fields per preference set) | Batch: pre-fetch all verticals and fields once before the loop |
| 10 | **sortBy injection in /leads/search** | User-provided `sortBy` passes into Prisma `orderBy`. Prisma rejects bad fields but no explicit whitelist | Add `ALLOWED_SORT_FIELDS = ['createdAt', 'reservePrice', 'qualityScore']` |
| 11 | **In-memory filtering cap at 500** | POST /leads/search fetches max 500 candidates, filters in-memory | Fine for hackathon scale; needs Prisma JSON path queries or search index at scale |
| 12 | **MCP handler path template** | `get_vertical_fields` handler uses `/api/v1/verticals/{vertical}/fields` with curly-brace placeholder — MCP server.ts must interpolate | Verify MCP server.ts performs `handler.replace('{vertical}', args.vertical)` |
| 13 | **MCP tool count** | README says 12, actual count in tools.ts = 12 (9 original + get_vertical_fields + search_leads_advanced + fieldFilters param = 12) | ✅ Count is correct |

## 🔴 Potential Errors

| # | Issue | Risk | Fix |
|---|-------|------|-----|
| 14 | **BuyerFieldFilter table doesn't exist yet** | All `(tx as any).buyerFieldFilter` calls will throw until migration applied | Run `prisma migrate dev` before testing |
| 15 | **VerticalField table doesn't exist yet** | Same — includes in GET and findMany in PUT will fail | Same fix: run migration |
| 16 | **Vertical.findUnique({ slug })** in PUT | If user sends a vertical slug that doesn't exist, `vertical` is null, fieldFilters silently dropped | Already handled: `if (vertical)` guard skips filter creation |
| 17 | **form-config field.id may be undefined** | `/fields` fallback uses `f.id || f.key` — some fields might not have .id | `f.key` fallback is always present per form-config schema convention |

## 📋 Edge Cases

| # | Edge Case | Behavior |
|---|-----------|----------|
| 18 | Save with 0 field filters | DELETE clears all BuyerFieldFilter rows, no creates — ✅ |
| 19 | Save filter on non-biddable field | `isBiddable: true` guard in findMany → key not resolved → silently skipped — ✅ |
| 20 | Save filter on PII field | `isPii: false` guard → key skipped — ✅ |
| 21 | GET with no preference sets | Returns `{ sets: [] }` — ✅ |
| 22 | GET with sets but no field filters | `fieldFilters` is empty `{}` — ✅ |
| 23 | Multi-select with 1 option deselected to 0 | Filter key deleted from `fieldFilters` — ✅ |
| 24 | Boolean "Any" selected | Filter key deleted — semantically matches all — ✅ |
| 25 | New vertical created via VerticalNFT | No VerticalField rows yet → /fields falls back to formConfig → filters work via formConfig fields. When admin approves and form-config is saved, `syncVerticalFields` populates VerticalField table for the new vertical — ✅ |

## 🚀 Future Improvements

| # | Improvement | When |
|---|-------------|------|
| 26 | Between operator (range slider) in UI | Post-hackathon — needs min/max metadata from VerticalField |
| 27 | NOT_EQUALS / NOT_IN operators in UI | On user request — backend already supports |
| 28 | Batch field resolution in PUT | When buyers have >5 preference sets |
| 29 | PostgreSQL JSON path queries | When marketplace has >10K leads per vertical |
| 30 | Real-time filter preview ("N leads match") | High-impact UX feature for premium tier |
