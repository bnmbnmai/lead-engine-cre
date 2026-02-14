# Lead Engine CRE — Expert Onboarding Guide

> **Last updated:** 2026-02-09  
> **Live frontend:** https://lead-engine-cre-frontend.vercel.app  
> **Live backend:** https://lead-engine-api-0jdu.onrender.com  
> **GitHub:** https://github.com/bnmbnmai/lead-engine-cre

---

## 1. What Is Lead Engine CRE?

Lead Engine CRE is a **decentralized real-time bidding (RTB) marketplace for leads** — initially targeting Commercial Real Estate (CRE) but architected to support any vertical (insurance, solar, mortgage, legal, etc.).

**The pitch:** Sellers submit verified leads. Buyers bid on them in real-time auctions. Smart contracts handle escrow, payments (USDC), and compliance — removing intermediaries and providing trustless, transparent transactions.

**Hackathon context:** Built for the Chainlink Hackathon. Uses Chainlink Functions (CRE) for off-chain data verification, Chainlink Automation for auction lifecycle management, and is deployed on Ethereum Sepolia testnet.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (Vercel)                 │
│  React 18 + Vite + TailwindCSS + shadcn/ui          │
│  Wagmi/viem (wallet) · Socket.IO (real-time)        │
├──────────────────────┬──────────────────────────────┤
│         REST API     │     WebSocket (Socket.IO)    │
├──────────────────────┴──────────────────────────────┤
│                    BACKEND (Render)                  │
│  Express + TypeScript + Prisma ORM                  │
│  PostgreSQL · Redis (pub/sub) · JWT Auth            │
├─────────────────────────────────────────────────────┤
│               BLOCKCHAIN (Sepolia)                  │
│  5 Solidity contracts deployed via Hardhat           │
│  Chainlink Functions · USDC escrow                  │
└─────────────────────────────────────────────────────┘
```

### Data Flow

1. **Seller submits lead** → Backend validates → `LeadNFTv2` mints NFT on-chain → Lead appears in marketplace
2. **Buyer places bid** → Backend stores bid → `RTBEscrow` locks USDC → Auction timer runs
3. **Auction ends** → `Marketplace` contract resolves winner → `RTBEscrow` releases funds to seller → Lead data transferred to buyer
4. **Compliance** → `ACECompliance` verifies seller credentials → `CREVerifier` uses Chainlink Functions to verify lead data off-chain

---

## 3. Tech Stack — Full Inventory

### Frontend

| Category | Technology | Version |
|----------|-----------|---------|
| Framework | React | 18.2 |
| Build | Vite | 5.1 |
| Language | TypeScript | 5.4 |
| Styling | TailwindCSS | 3.4 |
| Component library | shadcn/ui (Radix primitives) | Various |
| Icons | Lucide React | 0.344 |
| Fonts | Inter (sans), JetBrains Mono (mono) | Google Fonts |
| Web3 | wagmi 2.x + viem 2.x | 2.5 / 2.8 |
| Wallet modal | WalletConnect | 2.6 |
| Forms | react-hook-form + zod | 7.51 / 3.22 |
| Routing | react-router-dom | 6.22 |
| State / data | TanStack React Query | 5.25 |
| Real-time | Socket.IO client | 4.7 |
| i18n | i18next + react-i18next | 23.10 |
| Animations | tailwindcss-animate | 1.0 |

### Backend

| Category | Technology |
|----------|-----------|
| Runtime | Node.js + Express |
| Language | TypeScript |
| ORM | Prisma |
| Database | PostgreSQL (Render) |
| Cache / pub-sub | Redis (optional) |
| Auth | JWT + wallet signature (SIWE-style) |
| Real-time | Socket.IO |

### Blockchain

| Category | Technology |
|----------|-----------|
| Network | Ethereum Sepolia (testnet) |
| Framework | Hardhat |
| Language | Solidity |
| Oracle | Chainlink Functions (CRE) |
| Payment | USDC (ERC-20 escrow) |

---

## 4. Smart Contracts (Sepolia)

| Contract | Address | Purpose |
|----------|---------|---------|
| **ACECompliance** | `0x7462...9546` | Seller verification, compliance scoring |
| **LeadNFTv2** | `0xB93A...8546` | Mints lead data as NFTs (ERC-721) |
| **RTBEscrow** | `0x19B7...9004` | USDC escrow for bids, automatic release |
| **Marketplace** | `0x3b1b...B288` | Auction lifecycle, bid resolution, fee management |
| **CREVerifier** | `0x00f1...57A4` | Chainlink Functions integration for off-chain data verification |

Full addresses viewable on [Sepolia Etherscan](https://sepolia.etherscan.io).

---

## 5. Frontend — Deep Dive

### 5.1 Project Structure

```
frontend/src/
├── App.tsx                   # Router + providers
├── main.tsx                  # Entry point
├── index.css                 # Tailwind base + design tokens (CSS vars)
│
├── pages/                    # Route-level components
│   ├── HomePage.tsx          # Landing + marketplace (tabs: Live Leads / Browse Asks)
│   ├── AuctionPage.tsx       # Live auction view with real-time bidding
│   ├── BuyerDashboard.tsx    # Buyer overview, stats, recent activity
│   ├── BuyerBids.tsx         # Buyer's bid history
│   ├── BuyerPreferences.tsx  # Buyer lead preferences form
│   ├── SellerDashboard.tsx   # Seller overview, stats, recent leads
│   ├── SellerLeads.tsx       # Seller's submitted leads list
│   ├── SellerAsks.tsx        # Seller's ask listings
│   ├── SellerSubmit.tsx      # Lead submission form
│   └── CreateAsk.tsx         # Ask creation form
│
├── components/
│   ├── ui/                   # Reusable shadcn-style primitives
│   │   ├── button.tsx        # Button with variants (gradient, glass, ghost, etc.) + asChild
│   │   ├── card.tsx          # Card, CardHeader, CardTitle, CardContent
│   │   ├── input.tsx         # Styled input
│   │   ├── select.tsx        # Radix Select with trigger, content, item
│   │   ├── badge.tsx         # Status/category badges
│   │   ├── skeleton.tsx      # Loading skeletons
│   │   ├── switch.tsx        # Toggle switch
│   │   └── textarea.tsx      # Styled textarea
│   │
│   ├── layout/
│   │   └── Navbar.tsx        # Fixed top nav (glass effect, responsive, mobile menu)
│   │
│   ├── marketplace/
│   │   ├── LeadCard.tsx      # Card for a marketplace lead (bid/view buttons)
│   │   └── AskCard.tsx       # Card for a marketplace ask
│   │
│   ├── bidding/
│   │   └── BidPanel.tsx      # Auction bid controls
│   │
│   ├── forms/
│   │   ├── AskForm.tsx       # Ask creation form (react-hook-form + zod)
│   │   ├── LeadSubmitForm.tsx # Lead submission form
│   │   └── PreferencesForm.tsx # Buyer preferences form
│   │
│   └── wallet/
│       └── ConnectButton.tsx # Wallet connect/disconnect, chain switching
│
├── hooks/
│   ├── useAuth.tsx           # Auth context (JWT + wallet connect, role-based)
│   └── useAuction.ts         # Auction state (Socket.IO real-time updates)
│
├── lib/
│   ├── api.ts                # REST API wrapper (all endpoints)
│   ├── wagmi.ts              # Wagmi config (chains, connectors, WalletConnect)
│   ├── socket.ts             # Socket.IO connection manager
│   ├── i18n.ts               # Internationalization setup
│   └── utils.ts              # cn() helper (clsx + tailwind-merge)
│
└── styles/                   # (empty — all CSS in index.css)
```

### 5.2 Design System

**Theme:** Dark-only (HSL CSS variables in `index.css`)

```css
--background: 220 20% 7%       /* Near-black */
--foreground: 210 40% 98%      /* Near-white */
--card: 220 20% 10%            /* Slightly lighter than bg */
--primary: 217 91% 60%         /* Blue */
--muted-foreground: 217 10% 55% /* Gray text */
--border: 217 20% 18%          /* Subtle borders */
--radius: 0.75rem              /* Rounded corners */
```

**Key utility classes defined in `index.css`:**
- `.gradient-text` — blue-to-pink gradient text (used for headings)
- `.glass` — glassmorphism effect (white/5 bg + backdrop-blur-xl + white/10 border)
- `.glow` / `.glow-purple` — blue/purple box-shadow glow
- `.animate-float` — gentle 6s floating animation
- `.animate-shimmer` — loading shimmer effect

**Tailwind config extends:**
- Fonts: `Inter` (sans), `JetBrains Mono` (mono)
- Animations: accordion, fade, slide, pulse-glow
- Plugin: `tailwindcss-animate`

**Button variants (in `button.tsx`):**
- `default` — primary blue with hover scale
- `gradient` — blue→purple gradient (hero CTAs)
- `glass` — glassmorphism
- `ghost` — transparent hover
- `outline` — bordered
- `link` — underlined
- `destructive` — red

### 5.3 Routing

| Path | Component | Access |
|------|-----------|--------|
| `/` | HomePage | Public |
| `/marketplace` | HomePage | Public |
| `/auction/:leadId` | AuctionPage | Public |
| `/buyer` | BuyerDashboard | Authenticated (Buyer) |
| `/buyer/bids` | BuyerBids | Authenticated (Buyer) |
| `/buyer/preferences` | BuyerPreferences | Authenticated (Buyer) |
| `/seller` | SellerDashboard | Authenticated (Seller) |
| `/seller/leads` | SellerLeads | Authenticated (Seller) |
| `/seller/asks` | SellerAsks | Authenticated (Seller) |
| `/seller/asks/new` | CreateAsk | Authenticated (Seller) |
| `/seller/submit` | SellerSubmit | Authenticated (Seller) |
| `*` | Redirect → `/` | — |

### 5.4 Authentication Flow

1. User clicks "Connect Wallet" → wagmi opens WalletConnect/MetaMask modal
2. After wallet connect → frontend calls `GET /api/v1/auth/nonce/:address` to get a sign-in message
3. User signs the message with their wallet
4. Frontend sends signed message to `POST /api/v1/auth/wallet` → backend verifies → returns JWT
5. JWT stored in `localStorage`, attached to all API calls via `Authorization: Bearer <token>`
6. Role (BUYER/SELLER) determined at login — controls which dashboard routes are accessible

### 5.5 Real-Time Features

Socket.IO events for live auction updates:
- `auction:bid` — new bid placed
- `auction:update` — auction state change
- `auction:end` — auction concluded

### 5.6 API Endpoints (Frontend ↔ Backend)

```
Auth:
  GET  /api/v1/auth/nonce/:address    → { nonce, message }
  POST /api/v1/auth/wallet            → { token, user }
  GET  /api/v1/auth/me                → { user }
  POST /api/v1/auth/logout

Marketplace:
  GET  /api/v1/asks?params            → { asks[], pagination }
  POST /api/v1/asks                   → { ask }
  GET  /api/v1/asks/:id               → { ask }
  GET  /api/v1/leads?params           → { leads[], pagination }
  POST /api/v1/leads/submit           → { lead }
  GET  /api/v1/leads/:id              → { lead }

Bidding:
  POST /api/v1/bids                   → { bid }
  POST /api/v1/bids/:id/reveal        → { bid }
  GET  /api/v1/bids/my?params         → { bids[] }
  PUT  /api/v1/bids/preferences       → updated prefs

Analytics:
  GET  /api/v1/analytics/overview     → dashboard stats
  GET  /api/v1/analytics/leads?params → lead metrics
  GET  /api/v1/analytics/bids         → bid metrics
```

---

## 6. Backend — Services

| Service | File | Purpose |
|---------|------|---------|
| **ACE** | `ace.service.ts` | Automated Compliance Engine — seller verification scoring |
| **CRE** | `cre.service.ts` | Chainlink Runtime Environment — off-chain function calls |
| **NFT** | `nft.service.ts` | Lead NFT minting and metadata management |
| **Privacy** | `privacy.service.ts` | PII handling, data encryption, access control |
| **x402** | `x402.service.ts` | HTTP 402 payment-required protocol integration |
| **ZK** | `zk.service.ts` | Zero-knowledge proof generation/verification |

---

## 7. Current UI Status & Known Issues

**What works:**
- Dark theme with glassmorphism renders correctly
- Navbar, marketplace tabs (Live Leads / Browse Asks), search, filters
- Wallet connect button with chain switching
- All route pages render

**What needs improvement (the reason you're here):**
- The homepage feels sparse and basic — large empty space when no leads are loaded
- Stat cards (Active Leads, Avg Bid, States) are small and lack visual punch
- No hero section or landing page "wow" factor — jumps straight to marketplace
- Cards (LeadCard, AskCard) are functional but visually plain
- Dashboard pages are data-table-heavy with minimal visual hierarchy
- No micro-animations, hover transitions, or engagement patterns beyond basic hover:scale
- Typography could be more dynamic (varying weights, sizes, spacing)
- No onboarding/empty states — just "Connect your wallet to browse" text
- Mobile responsiveness needs polish
- No dark/light toggle (dark-only but could be enhanced within dark theme)

---

## 8. Development

### Run Locally

```bash
# Frontend (port 5173)
cd frontend && npm install && npm run dev

# Backend (port 3001)
cd backend && npm install && npx prisma generate && npm run dev

# Contracts (for deploying/testing)
cd contracts && npm install && npx hardhat compile
```

### Environment Variables

**Frontend (Vercel):**
- `VITE_API_URL` — backend URL
- `VITE_WALLETCONNECT_PROJECT_ID` — WalletConnect Cloud project ID

**Backend (Render):**
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — auth token signing key
- `ALCHEMY_API_KEY` — Sepolia RPC
- `DEPLOYER_PRIVATE_KEY` — for contract interactions
- `FRONTEND_URL` — CORS allowed origin

### Build & Deploy

- **Frontend:** `npm run build` → `tsc -b && vite build` → Vercel auto-deploys from `main`
- **Backend:** `npm run build` → `tsc` → Render auto-deploys from `main`
- **Contracts:** `npx hardhat run scripts/deploy.ts --network sepolia`

---

## 9. Key Files for UI Redesign

If you're focusing on improving the frontend visual design, these are the files that matter most:

| Priority | File | What it controls |
|----------|------|-----------------|
| 🔴 | `src/index.css` | All CSS variables, utility classes, design tokens |
| 🔴 | `tailwind.config.js` | Tailwind theme extensions, colors, fonts, animations |
| 🔴 | `src/pages/HomePage.tsx` | The main landing/marketplace page users see first |
| 🟡 | `src/components/ui/button.tsx` | Button component variants |
| 🟡 | `src/components/ui/card.tsx` | Card component (used everywhere) |
| 🟡 | `src/components/layout/Navbar.tsx` | Top navigation bar |
| 🟡 | `src/components/marketplace/LeadCard.tsx` | Individual lead listing card |
| 🟡 | `src/components/marketplace/AskCard.tsx` | Individual ask listing card |
| 🟢 | `src/pages/BuyerDashboard.tsx` | Buyer dashboard layout |
| 🟢 | `src/pages/SellerDashboard.tsx` | Seller dashboard layout |
| 🟢 | `src/pages/AuctionPage.tsx` | Live auction view |

---

## 10. Design Principles to Maintain

1. **Dark-first** — the entire app is dark-themed. Enhancements should work within the dark palette.
2. **Glass + gradients** — the `.glass` and `.gradient-text` utilities are already established. Build on them.
3. **Radix/shadcn patterns** — UI components follow the shadcn pattern (Radix primitives + CVA variants + cn()). New components should follow this pattern.
4. **Web3-native** — wallet connect is a first-class UX. Don't hide it.
5. **Responsive** — must work mobile/tablet/desktop. Use Tailwind breakpoints (`sm:`, `md:`, `lg:`).
6. **Performance** — minimize bundle size. Use dynamic imports for heavy pages if needed.

---

## 11. Bid Previews & Compliance

### Bid Mode

All bids use **sealed commit-reveal**. Bid amounts are encrypted (AES-256-GCM) until the reveal phase, preventing front-running and protecting buyer strategy.

| Phase | What Happens |
|-------|-------------|
| **Commit** | Buyer submits a commitment hash (`keccak256(amount + salt)`). Amount is hidden. |
| **Reveal** | After auction bidding closes, buyers reveal their amount + salt. Engine verifies against commitment. |
| **Resolution** | Highest valid revealed bid wins. Winner pays via x402 USDC escrow. |

### Lead Preview (Non-PII)

The `LeadPreview` component (`components/bidding/LeadPreview.tsx`) shows buyers redacted lead data grouped by form step — field values like "Loan Type: Refinance" without any personally identifiable information. ZK-verified leads display a green "ZK Verified" badge.

### KYC Flow

- Sellers see a **"Verify Now →"** CTA on the submit page if unverified
- KYC-required errors include an actionable button routing to `/seller/kyc`
- Verified sellers earn higher trust scores and faster settlement

---

## 12. NFT Features (Optional)

NFT minting, auctions, and resale can be disabled to run Lead Engine as a pure lead exchange.

| Variable | Default | Effect |
|----------|---------|--------|
| `NFT_FEATURES_ENABLED` | `true` | When `false`, NFT endpoints return `501 Not Implemented` |

Set in your `.env`:

```bash
NFT_FEATURES_ENABLED=false   # Disable NFTs for lead-only mode
```

Routes guarded: `PUT /:slug/activate`, `POST /:slug/resale`, `POST /:slug/auction`

---

## 13. Additional Environment Variables

| Variable | Location | Purpose |
|----------|----------|---------|
| `VITE_BLOCK_EXPLORER_URL` | Frontend | Block explorer base URL (default: `https://sepolia.etherscan.io`) |
| `NFT_FEATURES_ENABLED` | Backend | Toggle NFT features on/off (default: `true`) |
| `AUTO_EXTEND_INCREMENT_SECS` | Backend | Auction auto-extend duration in seconds |
| `AUTO_EXTEND_MAX` | Backend | Maximum number of auto-extensions per auction |
