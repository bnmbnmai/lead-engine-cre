# Admin Panel Audit

## 1. Executive Summary

The Admin panel is a **production-oriented management interface** consisting of three pages behind `/admin/*` routes, completely separate from the Demo Control Panel (bottom-right floating UI). It provides platform-level governance: **NFT minting for verticals**, **vertical lifecycle management** (propose → approve → deprecate → reject), and a **white-label Form Builder** for configuring lead capture forms per vertical.

**Current State**: All three pages are functional, well-structured, and backed by comprehensive admin-only API endpoints (15+ routes in `vertical.routes.ts` gated by `requireAdmin` middleware). They are real API-driven — no `useMockData` or `demoMode` fallbacks exist. The admin sidebar renders contextually when the URL starts with `/admin`.

**Hackathon vs Production**: The admin panel is production-ready infrastructure that showcases enterprise features (white-label verticals, NFT provenance, form customization). For the hackathon, it demonstrates depth beyond buyer/seller personas.

**Overall Score**: 7.5/10 — functional and well-built, but with several alignment gaps.

---

## 2. Root Cause Analysis of Gaps

### Gap 1: Admin Panel Inaccessible Without URL Knowledge or Demo Panel

**Files**: `Sidebar.tsx` lines 103–118 (Quick Switch section)

The Quick Switch section in the sidebar only includes Marketplace, Buyer Dashboard, and Seller Dashboard. There is **no admin link** in the quick-switch, meaning:
- A user on `/buyer` or `/seller` has **no visible way** to navigate to admin
- Access requires either: (a) manually typing `/admin/nfts`, or (b) using the **DemoPanel → Login as Demo Admin** button
- The admin sidebar items (lines 53–58) only render when already on an `/admin/*` path

**Impact**: Judges or reviewers may never discover the admin panel.

---

### Gap 2: No System Health / On-Chain Status Overview in Admin

**Files**: `AdminNFTs.tsx`, `AdminVerticals.tsx`

The admin panel has no dashboard or overview page at `/admin`. There is no summary of:
- Total leads in system, active auctions, settlement status
- Chainlink service health (CRE workflow status, VRF availability, Data Feed freshness)
- PersonalEscrowVault total locked / PoR status
- Recent demo runs or error counts

The admin pages jump directly into NFT management and vertical management.

**Impact**: A platform admin has no single-pane-of-glass for system health.

---

### Gap 3: No Provenance Links in AdminVerticals

**Files**: `AdminVerticals.tsx` lines 259–313 (suggestion rows)

The AdminVerticals table shows: name, slug, parent, confidence, hits, source, and sync-check status. However, it **does NOT show**:
- NFT token ID or tx hash for approved verticals (even though `AdminNFTs.tsx` shows these)
- Basescan provenance links for on-chain verticals
- Any LeadNFT minting information tied to the vertical

When a vertical is approved with `+ NFT` (line 332), the success feedback goes to a toast, but the table row itself never updates to show provenance.

**Impact**: Inconsistency between NFT Admin (shows provenance) and Verticals page (does not).

---

### Gap 4: Demo Panel "Login as Admin" Has No Sidebar Cross-Link

**Files**: `DemoPanel.tsx` line 403, `Sidebar.tsx` lines 103–118

When a user clicks "Login as Demo Admin" in the DemoPanel, they are logged in with the ADMIN role and persona is set. However:
- The sidebar does not automatically show admin items (because the user is still on their current non-admin URL)
- There is no redirect to `/admin/nfts` after admin login
- The quick-switch section does not dynamically add an Admin option even after ADMIN role is active

**Impact**: After logging in as admin via DemoPanel, the user must manually navigate to `/admin/*`.

---

### Gap 5: FormBuilder Save/Load Lacks Audit Trail

**Files**: `FormBuilder.tsx` lines 234–261 (saveConfig), `vertical.routes.ts` lines 382–530

The Form Builder saves config via `PUT /api/v1/verticals/:slug/form-config`, which stores the field/step layout in the `VerticalFormConfig` table. However:
- There is no `lastModifiedBy` field — no audit trail of who saved which config
- No version history — saves overwrite with no undo
- No indication in the UI of when the config was last saved or by whom

**Impact**: In a multi-admin environment, accidental overwrites have no recovery path.

---

### Gap 6: AdminNFTs Hardcoded Auction Parameters

**Files**: `AdminNFTs.tsx` lines 157–159

```typescript
const reservePrice = 0.1; // Default reserve
const durationSecs = 3600; // 1 hour default
```

The "Start Auction" handler uses hardcoded values. There is no UI to configure reserve price or auction duration before starting.

**Impact**: Low flexibility; acceptable for hackathon but not for production.

---

### Gap 7: Sidebar "Quick Switch" Does Not Include Admin for ADMIN Users

**Files**: `Sidebar.tsx` lines 103–118

The quick-switch section shows Marketplace, Buyer, and Seller. It **never** includes Admin as a destination, even when the authenticated user has `role === 'ADMIN'`. The `getContextItems()` function (lines 60–65) knows about admin items, but the quick-switch is hardcoded without admin.

---

## 3. Recommended Improvements (High-Impact, Low-Risk)

| # | Improvement | Files | Effort | Risk |
|---|---|---|---|---|
| 1 | **Add Admin to Quick Switch when role is ADMIN** — Conditionally include `{ href: '/admin/nfts', label: 'Admin Panel', icon: <Gem/> }` in quick-switch when user role is ADMIN | `Sidebar.tsx` L103–118 | Very Low | None |
| 2 | **Show NFT provenance in AdminVerticals ACTIVE tab** — Add nftTokenId + Basescan tx link columns to the ACTIVE tab table, same pattern as AdminNFTs minted table | `AdminVerticals.tsx` ~L260 | Low | None |
| 3 | **Redirect to `/admin/nfts` after DemoPanel admin login** — After successful admin login in DemoPanel, use `navigate('/admin/nfts')` | `DemoPanel.tsx` ~L403 | Very Low | None |
| 4 | **Add a simple `/admin` overview route** — Create an AdminDashboard page showing counts (total verticals, minted NFTs, pending suggestions, saved form configs). Wire as `/admin` route in App.tsx | New file + `App.tsx` | Medium | Low |
| 5 | **Show "Last saved at" timestamp in Form Builder** — Display the `updatedAt` from the form config API response | `FormBuilder.tsx` ~L86 | Very Low | None |
| 6 | **Make auction params configurable** — Add two inputs (reserve price, duration) in a mini-dialog before `handleStartAuction` | `AdminNFTs.tsx` L157 | Low | None |

---

## 4. Testing Steps for Admin Panel Consistency

### Manual Testing (All Steps Assume Demo Mode Enabled)

1. **Access Admin via DemoPanel**
   - Open the app at `/marketplace`
   - Click the floating Demo Control Panel (bottom-right)
   - Click "Login as Demo Admin"
   - Verify: Admin persona is set (amber indicator visible)
   - Navigate manually to `/admin/nfts`
   - Verify: Sidebar shows "NFT Admin", "Verticals", "Form Builder"

2. **NFT Admin Page**
   - Verify: Stats cards show Minted NFTs, Pending Proposals, Royalties Earned
   - Verify: "NFT Features Disabled" banner appears if `VITE_NFT_ENABLED=false`
   - Verify: Proposed verticals list shows Mint NFT button
   - Verify: Minted NFTs table shows Token ID, Tx Hash (Basescan link), Owner address, Resales count
   - Click any Basescan link → verify it opens `sepolia.basescan.org/tx/...`

3. **Admin Verticals Page**
   - Navigate to `/admin/verticals`
   - Verify: 4 tabs (Pending, Approved, Paused, Rejected) render correctly
   - Verify: Search input filters suggestions
   - Verify: Sync Check (🔄) button triggers and shows ✓ or ! badge
   - Verify: Approve, Approve + NFT, and Reject actions work with proper toasts
   - Switch to Approved tab → verify Pause and Delete actions render

4. **Form Builder Page**
   - Navigate to `/admin/form-builder`
   - Verify: Vertical selector loads API verticals (not just hardcoded presets)
   - Select a vertical → verify fields and steps populate
   - Drag-and-drop a field between steps → verify reorder works
   - Add a field → verify it appears in the step editor
   - Switch to JSON tab → verify export matches editor state
   - Click "Save Config" → verify success toast and ✅ Saved badge
   - Reload page → verify saved config loads from API

5. **Sidebar Navigation Consistency**
   - From `/admin/nfts`, verify quick-switch does NOT show Admin (current gap)
   - From `/admin/nfts`, click "Verticals" in sidebar → verify navigation
   - From `/admin/form-builder`, click browser back → verify no broken state

6. **Role Guard Verification**
   - Log out → navigate directly to `/admin/nfts`
   - Verify: Redirected to `/` (ProtectedRoute guard)
   - Login as Buyer persona → navigate to `/admin/nfts`
   - Verify: Redirected to `/` (ADMIN role check at component level)
