# Lead Engine CRE — Current Status (February 16, 2026)

> **Purpose:** Exhaustive technical snapshot for Grok (xAI). Contains real code, schemas, addresses, and field-level detail — not summaries.

---

## 1. Repository Overview & Structure

**Repo:** `github.com/bnmbnmai/lead-engine-cre`  
**Branch:** `main` (HEAD `74b8e67`)  
**Monorepo layout — 4 packages + root scripts:**

```
Lead Engine CRE/
├── backend/                    # Express + Prisma + Socket.IO API server
│   ├── prisma/
│   │   └── schema.prisma       # 642 lines, 16 models
│   ├── src/
│   │   ├── index.ts            # Express entry point
│   │   ├── config/             # env config
│   │   ├── data/
│   │   │   └── form-config-templates.ts  # 549 lines — 50 vertical form configs
│   │   ├── lib/
│   │   │   ├── fees.ts         # Fee calculation (2.5% + $2 convenience)
│   │   │   └── prisma.ts       # Prisma client singleton
│   │   ├── middleware/         # auth, error handling
│   │   ├── routes/             # 11 route files
│   │   │   ├── analytics.routes.ts
│   │   │   ├── auth.routes.ts
│   │   │   ├── bidding.routes.ts
│   │   │   ├── buyer.routes.ts
│   │   │   ├── crm.routes.ts
│   │   │   ├── demo-panel.routes.ts    # 64KB — demo infrastructure
│   │   │   ├── integration.routes.ts
│   │   │   ├── lander.routes.ts
│   │   │   ├── marketplace.routes.ts   # 63KB — core lead/escrow APIs
│   │   │   ├── mcp.routes.ts
│   │   │   └── vertical.routes.ts
│   │   ├── rtb/
│   │   │   └── socket.ts       # 780 lines — WebSocket auction engine
│   │   ├── services/           # 21 service files
│   │   │   ├── ace.service.ts
│   │   │   ├── analytics-mock.ts
│   │   │   ├── auction.service.ts
│   │   │   ├── auto-bid.service.ts     # 335 lines — autobid engine
│   │   │   ├── confidential.service.ts
│   │   │   ├── conversion-tracking.service.ts
│   │   │   ├── cre.service.ts
│   │   │   ├── datastreams.service.ts
│   │   │   ├── deco.service.ts
│   │   │   ├── holder-perks.service.ts
│   │   │   ├── nft.service.ts          # LeadNFT minting
│   │   │   ├── notification.service.ts
│   │   │   ├── perks-engine.ts
│   │   │   ├── piiProtection.ts
│   │   │   ├── privacy.service.ts      # AES-256-GCM encryption
│   │   │   ├── quarterly-reset.service.ts
│   │   │   ├── vertical-nft.service.ts
│   │   │   ├── vertical-optimizer.service.ts
│   │   │   ├── vertical.service.ts
│   │   │   ├── x402.service.ts         # 28KB — escrow + payment
│   │   │   └── zk.service.ts
│   │   └── utils/
│   └── tests/unit/
│       └── fees.test.ts        # 10 tests, all passing
├── contracts/                  # Hardhat — Solidity ^0.8.24
│   ├── contracts/
│   │   ├── ACECompliance.sol   # 342 lines
│   │   ├── CREVerifier.sol     # 381 lines
│   │   ├── CustomLeadFeed.sol  # 242 lines
│   │   ├── LeadNFT.sol         # 5.9KB (v1, legacy)
│   │   ├── LeadNFTv2.sol       # 280 lines
│   │   ├── Marketplace.sol     # 473 lines
│   │   ├── RTBEscrow.sol       # 239 lines
│   │   ├── VerticalAuction.sol # 344 lines
│   │   ├── VerticalNFT.sol     # 407 lines
│   │   ├── interfaces/         # 5 interface files
│   │   └── mocks/              # 3 mock contracts
│   ├── hardhat.config.ts
│   ├── scripts/                # 6 deploy scripts
│   └── test/                   # 11 Hardhat test files
├── frontend/                   # Vite + React + TypeScript
│   └── src/
│       ├── App.tsx             # 140 lines — all routes
│       ├── components/         # 55 components
│       ├── hooks/              # 9 hooks
│       ├── lib/
│       │   ├── api.ts          # API client
│       │   ├── wagmi.ts        # Wagmi + RainbowKit config + ABIs
│       │   └── socket.ts       # Socket.IO client
│       ├── pages/              # 23 page components
│       └── utils/
├── mcp-server/                 # MCP agent server
│   ├── index.ts                # JSON-RPC server
│   ├── tools.ts                # 9 tool definitions
│   └── agent-logger.ts
├── scripts/                    # 12 utility scripts
├── tests/load/                 # 4 Artillery load test configs
├── docs/                       # 16 documentation files
├── render.yaml                 # Render deployment blueprint
├── TECH_DEBT.md                # 24 documented tech debt items
└── README.md
```

---

## 2. Smart Contracts (Base Sepolia)

### Deployed Addresses

| Contract | Sepolia | Base Sepolia |
|----------|---------|--------------|
| **RTBEscrow** | `0x19B7a082e93B096B0516FA46E67d4168DdCD9004` | `0x80fA1d07a1D5b20Fd90845b4829BEB30B3f86507` |
| **LeadNFTv2** | `0xB93A1Ff499BdEaf74710F760Eb2B6bc5b62f8546` | `0x37414bc0341e0AAb94e51E89047eD73C7086E303` |
| **ACECompliance** | `0x746245858A5A5bCccfd0bdAa228b1489908b9546` | — |
| **CREVerifier** | `0x00f1f1C16e1431FFaAc3d44c608EFb5F8Db257A4` | — |
| **Marketplace** | `0x3b1bBb196e65BE66c2fB18DB70A3513c1dDeB288` | — |
| **USDC (Circle)** | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

> VerticalNFT, VerticalAuction, CustomLeadFeed: not yet deployed to Base Sepolia.

### RTBEscrow.sol (239 lines)
USDC escrow for lead payments. `Ownable + ReentrancyGuard`.

**State:** `IERC20 paymentToken`, `platformFeeBps` (250 = 2.5%), `feeRecipient`, `releaseDelay` (24h), `authorizedCallers` mapping.

**Struct:**
```solidity
struct Escrow {
    string leadId;
    address seller;
    address buyer;
    uint256 amount;
    uint256 platformFee;
    uint256 createdAt;
    uint256 releaseTime;
    EscrowState state; // Created, Funded, Released, Refunded, Disputed
}
```

**Functions:** `createEscrow(leadId, seller, buyer, amount)` → `onlyAuthorizedCaller`, `fundEscrow(escrowId)` → buyer deposits USDC, `releaseEscrow(escrowId)` → splits seller+fee, `refundEscrow`, `disputeEscrow`, `getEscrow`.

**Events:** `EscrowCreated`, `EscrowFunded`, `EscrowReleased`, `EscrowRefunded`, `EscrowDisputed`.

### LeadNFTv2.sol (280 lines)
ERC-721 for lead tokenization. `ERC721URIStorage + ERC721Burnable + Ownable + ReentrancyGuard + ILeadNFT`.

**Packed metadata struct** optimized for gas:
```solidity
struct PackedLeadMetadata {
    bytes32 platformLeadId;
    bytes32 vertical;
    bytes32 geoHash;
    bytes32 piiHash;
    uint96 reservePrice;
    uint40 createdAt;
    uint40 expiresAt;
    uint40 soldAt;
    LeadSource source;   // PLATFORM, API, OFFSITE
    LeadStatus status;   // ACTIVE, SOLD, EXPIRED, DISPUTED, CANCELLED
    address seller;
    address buyer;
    bool isVerified;
    bool tcpaConsent;
}
```

**Functions:** `mintLead(...)` → `onlyAuthorizedMinter`, `recordSale(tokenId, buyer, price)`, `updateStatus(tokenId, status)`, `getLead(tokenId)`, `isLeadValid(tokenId)`.

### VerticalNFT.sol (407 lines)
ERC-721 + ERC-2981 (royalties) for vertical ownership. Supports batch minting, on-chain resale with enforced royalties, Chainlink price feed integration, fractionalization flag.

**Key functions:** `mintVertical(to, slug, parentSlug, attributesHash, depth, uri)`, `batchMintVerticals(params[])`, `transferWithRoyalty(tokenId, buyer)` — enforces EIP-2981 royalty split, `deactivateVertical(tokenId)`, `isHolder(account, slug)`, `batchIsHolder(account, slugs[])`.

### Marketplace.sol (473 lines)
Full on-chain commit-reveal marketplace. `createListing`, `commitBid(listingId, commitment)`, `revealBid(listingId, amount, salt)`, `resolveAuction(listingId)`, `buyNow(listingId)`, `cancelListing`, `withdrawBid`. Integrates with LeadNFT and ACECompliance.

### CREVerifier.sol (381 lines)
Chainlink Functions client for off-chain verification. Three verification types: `requestParameterMatch`, `requestGeoValidation`, `requestQualityScore`. Also `requestZKProofVerification`. Batch operations supported. Stores JS source code on-chain for each verification type.

### ACECompliance.sol (342 lines)
KYC/AML + reputation + jurisdictional policies. `verifyKYC(user, proofHash, zkProof)`, `checkKYCStatus`, `isKYCValid`, `setJurisdictionPolicy`, `isJurisdictionAllowed`, `checkFullCompliance(seller, buyer, leadTokenId)`, `canTransact(user, vertical, geoHash)`, `updateReputationScore(user, delta)`.

### VerticalAuction.sol (344 lines)
On-chain vertical NFT auctions with holder priority. `HOLDER_MULTIPLIER_BPS = 1200` (1.2×), `PRE_PING_SECONDS = 300` (5min holder-only window). `createAuction`, `placeBid` (ETH), `settleAuction` (pays royalties via `transferWithRoyalty`), `cancelAuction`.

### CustomLeadFeed.sol (242 lines)
On-chain consumer for aggregated platform metrics (CRE cron writes). Stores: `averageQualityScore`, `totalVolumeSettledCents`, `totalLeadsTokenized`, `auctionFillRate`. Exposes `latestQualityScore()`, `latestVolume()`, `latestFillRate()`, `latestAllMetrics()`. Staleness-aware.

---

## 3. Prisma Schema & Data Models

**Full `schema.prisma` (642 lines, 16 models):**

### User
```prisma
model User {
  id            String   @id @default(cuid())
  email         String?  @unique
  walletAddress String   @unique
  role          UserRole @default(BUYER)   // BUYER | SELLER | ADMIN
  nonce         String   @default(uuid())  // For SIWE
  buyerProfile  BuyerProfile?
  sellerProfile SellerProfile?
  bids          Bid[]
  transactions  Transaction[]
  sessions      Session[]
  apiKeys       ApiKey[]
}
```

### Vertical
```prisma
model Vertical {
  id          String         @id @default(cuid())
  slug        String         @unique   // "solar", "home_services.plumbing"
  name        String
  description String?
  parentId    String?                  // NULL = top-level
  depth       Int            @default(0)  // 0 = root, 1 = child, max 3
  sortOrder   Int            @default(0)
  attributes  Json?          // { compliance, budget, icon }
  formConfig  Json?          // { fields[], steps[], gamification? }
  aliases     String[]
  status      VerticalStatus @default(PROPOSED)  // PROPOSED|ACTIVE|DEPRECATED|REJECTED
  requiresTcpa    Boolean @default(false)
  requiresKyc     Boolean @default(false)
  restrictedGeos  String[]
  nftTokenId      Int?
  nftTxHash       String?
  ownerAddress    String?
  resaleHistory   Json[]     @default([])
  parent   Vertical?  @relation("VerticalHierarchy")
  children Vertical[] @relation("VerticalHierarchy")
  auctions VerticalAuction[]
}
```

### BuyerPreferenceSet (autobid rules)
```prisma
model BuyerPreferenceSet {
  id              String   @id @default(cuid())
  buyerProfileId  String
  label           String             // "Solar — US West"
  vertical        String             // Single vertical per set
  priority        Int      @default(0)
  geoCountries    String[]
  geoInclude      String[]           // State codes to include
  geoExclude      String[]           // State codes to exclude
  maxBidPerLead   Decimal? @db.Decimal(10, 2)
  dailyBudget     Decimal? @db.Decimal(10, 2)
  autoBidEnabled  Boolean  @default(false)
  autoBidAmount   Decimal? @db.Decimal(10, 2)
  minQualityScore Int?     // 0-10000 scale
  excludedSellerIds   String[]
  preferredSellerIds  String[]
  minSellerReputation Int?
  requireVerifiedSeller Boolean @default(false)
  acceptOffSite   Boolean  @default(true)
  requireVerified Boolean  @default(false)
  isActive        Boolean  @default(true)
}
```

### Lead
```prisma
model Lead {
  id              String      @id @default(cuid())
  sellerId        String
  askId           String?
  vertical        String
  geo             Json        // { country, state, zip, city, region }
  source          LeadSource  // PLATFORM | API | OFFSITE
  status          LeadStatus  // PENDING_AUCTION | IN_AUCTION | SOLD | UNSOLD | EXPIRED | CANCELLED | DISPUTED
  dataHash        String?     // Hash of PII for ZK verification
  encryptedData   String?     // AES-256-GCM encrypted lead details
  parameters      Json?       // { creditScore, propertyType, loanAmount, ... }
  adSource        Json?       // UTM / campaign attribution
  reservePrice    Decimal?
  buyNowPrice     Decimal?    // Set when UNSOLD (reserve × 1.2)
  winningBid      Decimal?
  nftTokenId      String?     @unique
  nftContractAddr String?
  nftMintTxHash   String?
  tcpaConsentAt   DateTime?
  consentProof    String?     // Also used as DEMO_PANEL tag (tech debt)
  isVerified      Boolean     @default(false)
  auctionStartAt  DateTime?
  auctionEndAt    DateTime?
  soldAt          DateTime?
  expiresAt       DateTime?
}
```

### Transaction
```prisma
model Transaction {
  id              String            @id @default(cuid())
  leadId          String
  buyerId         String
  amount          Decimal           @db.Decimal(10, 2)
  platformFee     Decimal?          @db.Decimal(10, 2)
  convenienceFee  Decimal?          @db.Decimal(10, 2)  // $2 for AUTO_BID/AGENT
  convenienceFeeType String?        // 'AUTOBID' | 'API' | null
  currency        String            @default("USDC")
  status          TransactionStatus // PENDING|CONFIRMED|ESCROWED|RELEASED|FAILED|REFUNDED|DISPUTED
  txHash          String?           @unique
  chainId         Int?
  blockNumber     Int?
  escrowAddress   String?
  escrowId        String?
  escrowReleased  Boolean           @default(false)
}
```

### Bid
```prisma
model Bid {
  id           String    @id @default(cuid())
  leadId       String
  buyerId      String
  commitment   String?   // Hash of (amount, salt) for sealed bids
  amount       Decimal?  // Revealed amount (raw)
  effectiveBid Decimal?  // After holder multiplier
  salt         String?
  isHolder     Boolean   @default(false)
  status       BidStatus // PENDING|REVEALED|ACCEPTED|OUTBID|REJECTED|WITHDRAWN|EXPIRED
  source       BidSource // MANUAL|AUTO_BID|AGENT
  @@unique([leadId, buyerId])
}
```

### Other Models
- **Session** — JWT session tracking with `token`, `expiresAt`, `userAgent`, `ipAddress`
- **ApiKey** — Hashed API keys with `prefix`, `permissions[]`, `isActive`
- **BuyerProfile** — `verticals[]`, `geoFilters`, `budgetMin/Max`, `dailyBudget`, `monthlyBudget`, `kycStatus`, `holderNotifyOptIn`
- **SellerProfile** — `verticals[]`, `reputationScore` (0-10000), `totalLeadsSold`, `conversionPixelUrl`, `conversionWebhookUrl`
- **Ask** — Seller listing: `vertical`, `geoTargets`, `reservePrice`, `buyNowPrice`, `parameters`, `auctionDuration` (default 60s)
- **AuctionRoom** — Socket.IO state: `roomId`, `phase`, `bidCount`, `highestBid/Bidder`, `biddingEndsAt`, `prePingEndsAt`, `effectiveBid`, `participants[]`
- **VerticalAuction** — On-chain auction tracking: `verticalSlug`, `tokenId`, `reservePrice`, `prePingEndsAt/Nonce`, `leaseEndDate`, `renewalDeadline`, `leaseStatus`
- **ComplianceCheck** — `entityType`, `checkType` (TCPA, KYC, AML, GEO, FRAUD, PARAMETER_MATCH), `status`, `result`
- **AnalyticsEvent** — `eventType`, `entityType/Id`, `metadata`
- **VerticalSuggestion** — AI-suggested verticals: `suggestedSlug`, `parentSlug`, `confidence`, `reasoning`, `hitCount`
- **PlatformConfig** — Key-value config store

---

## 4. Seeded Verticals (The Full List)

**50 verticals** defined in `form-config-templates.ts` with slug → FormConfig mapping. Each has a 2-step form: Details step + Contact Info step (fullName, email, phone, zip, state, country).

### Root Verticals (10)

| # | Slug | isRegulated | Detail Fields |
|---|------|-------------|---------------|
| 1 | `solar` | false | roofType, roofAge, electricBill, creditScore, timeline |
| 2 | `mortgage` | true | propertyType, creditScore, occupancy |
| 3 | `roofing` | false | propertyType, roofMaterial, stories |
| 4 | `insurance` | true | insuranceType, propertyType, urgency |
| 5 | `home_services` | false | propertyType, urgency, serviceType |
| 6 | `b2b_saas` | false | companySize, industry, budget, decisionTimeline |
| 7 | `real_estate` | false | transactionType, timeline |
| 8 | `auto` | false | serviceNeeded, vehicleType |
| 9 | `legal` | true | legalArea, urgency, consultationType |
| 10 | `financial_services` | true | serviceType, timeline, currentAdvisor |

### Child Verticals (40)

**Solar (4):** `solar.residential` (sqft, systemSize, shading + common), `solar.commercial` (buildingSqft, buildingType, monthlyEnergyKwh), `solar.battery_storage` (existingSolar, batteryGoal, batteryBudget, electricBill), `solar.community` (interestType, electricBill, creditScore)

**Mortgage (4):** `mortgage.purchase` (purchasePrice, downPayment, loanType, purchaseTimeline, preApproved), `mortgage.refinance` (currentRate, loanBalance, homeValue, cashOutAmount, refinanceGoal), `mortgage.heloc` (homeValue, mortgageBalance, creditNeeded, purpose), `mortgage.reverse` (borrowerAge, homeValue, mortgageBalance, goal)

**Roofing (4):** `roofing.repair` (damageType, urgency, insuranceClaim), `roofing.replacement` (roofAge, roofSqft, budget, preferredMaterial), `roofing.inspection` (inspectionReason, roofAge), `roofing.gutter` (gutterService, linearFeet, gutterMaterial, stories)

**Insurance (4):** `insurance.auto` (vehicleType/Year, coverageType, drivingRecord, currentCarrier, multiCar), `insurance.home` (propertyType, homeAge, sqft, coverageType, claimsHistory), `insurance.life` (coverageAmount, policyType, applicantAge, healthStatus, smoker), `insurance.health` (planType, householdSize, incomeRange, currentCoverage, preExistingConditions)

**Home Services (4):** `home_services.plumbing` (serviceType, problemDescription, budget), `home_services.electrical` (serviceType, projectScope, budget), `home_services.hvac` (serviceType, systemAge, homeSqft, fuelType), `home_services.landscaping` (serviceType, lotSize, budget)

**B2B SaaS (4):** `b2b_saas.crm` (currentSolution, usersNeeded, keyFeatures), `b2b_saas.analytics` (dataSources, currentTool, usersNeeded), `b2b_saas.marketing_automation` (emailListSize, marketingChannels, currentTool), `b2b_saas.hr_tech` (employeeCount, modulesNeeded, currentSystem)

**Real Estate (4):** `real_estate.residential` (propertyType, priceRange, bedrooms, preApproved, financing), `real_estate.commercial` (propertyType, sqftNeeded, budget, leaseBuy), `real_estate.rental` (unitCount, managementNeeded, targetRent, rentalType), `real_estate.land` (acreage, intendedUse, utilitiesNeeded, zoningType)

**Auto (4):** `auto.sales` (purchaseType, vehicleType, budget, hasTradeIn, purchaseTimeline), `auto.warranty` (vehicleMake/Model/Year, mileage, warrantyType), `auto.repair` (vehicleType, repairType, urgency, problemDescription), `auto.insurance` (vehicleType/Year, coverageType, drivingRecord, currentCarrier)

**Legal (4):** `legal.personal_injury` (injuryType, injurySeverity, estimatedCaseValue, hasAttorney, incidentDate), `legal.family` (caseType, childrenInvolved, contested, significantAssets), `legal.immigration` (visaType, currentStatus, hasDeadline), `legal.criminal_defense` (chargeType, arraigned, bailStatus, priorConvictions)

**Financial Services (4):** `financial_services.debt_consolidation` (totalDebt, debtType, monthlyIncome, behindOnPayments), `financial_services.banking` (accountType, initialDeposit, importantFeatures), `financial_services.credit_repair` (currentScore, negativeItems, goal), `financial_services.tax_prep` (taxType, filingStatus, complexity, hasBackTaxes)

### FormConfig Structure

```typescript
interface FormConfig {
    fields: FormField[];   // [{id, key, label, type, required, placeholder?, options?}]
    steps:  FormStep[];    // [{id, label, fieldIds}] — always 2: details + contact
    gamification?: { showProgress: boolean; showNudges: boolean; confetti: boolean };
}
// type can be: 'text' | 'select' | 'boolean' | 'number' | 'textarea' | 'email' | 'phone'
```

All configs include shared contact fields: fullName, email, phone, zip, state, country.  
All have `gamification: { showProgress: true, showNudges: true, confetti: true }`.

---

## 5. Auction & Bidding Flow (End-to-End)

### Single 60-Second Sealed-Bid Auction

```
Seller Submit → Marketplace Seed → Auction Start → 60s Bidding → Resolution → Settlement → NFT Mint → PII Unlock
```

**Step-by-step:**

1. **Seller creates Ask** — vertical, geo targets, reserve price, parameters. `auctionDuration: 60` seconds.
2. **Lead injected** (demo panel or form submission) — encrypted PII via `privacyService.encryptLeadPII()`, stored as `encryptedData` + `dataHash`. Status → `PENDING_AUCTION`.
3. **Auction starts** — Socket.IO creates `AuctionRoom` with `roomId = auction:${leadId}`. Status → `IN_AUCTION`. `biddingEndsAt = now + 60s`. Auto-bid engine evaluates lead.
4. **Bidding (60 seconds):**
   - **Manual bids:** Buyer commits `keccak256(abi.encode(amount, salt))` via Socket.IO `bid:commit`. Backend stores commitment + hashed amount.
   - **Auto-bids:** `auto-bid.service.ts` evaluates `BuyerPreferenceSet` rules (vertical match, geo match, quality score ≥ min, daily budget check, USDC allowance check). Places bid with `source: AUTO_BID`. Commitment generated server-side.
   - **MCP agent bids:** Via `/api/v1/bids` with `source: AGENT`.
   - Bids are sealed — only commitment hash visible to others. `bidCount` and `highestBid` (obfuscated) broadcast via Socket.IO.
5. **Auto-reveal** — At `biddingEndsAt`, `resolveAuction()` in `socket.ts` auto-reveals all bids and picks winner. Highest effective bid wins (holder bids get 1.2× multiplier). Ties broken by holder status.
6. **Resolution:** Winner's bid → `ACCEPTED`, others → `OUTBID`. `Transaction` created with fees via `calculateFees()`. Lead status → `SOLD`. If no bids above reserve → `UNSOLD` with `buyNowPrice = reservePrice × 1.2` and 7-day expiry.
7. **Settlement (client-side escrow signing):**
   - Backend `prepareEscrowTx()` encodes `USDC.approve()` + `createEscrow()` calldata.
   - Buyer gets **3 MetaMask prompts**: (a) `USDC.approve()`, (b) `createEscrow()`, (c) `USDC.transfer($2)` convenience fee (if auto-bid/agent).
   - Backend `confirmEscrowTx()` verifies receipts.
   - **Server-side flow (demo):** Deployer wallet handles all 3 transactions.
8. **NFT mint** — `nft.service.ts` calls `LeadNFTv2.mintLead()` with packed metadata.
9. **PII unlock** — `privacyService.decryptLeadPII()` returns decrypted contact info. Displayed on lead detail page.

### Convenience Fee Logic

```typescript
// fees.ts
PLATFORM_FEE_RATE = 0.025;  // 2.5%
CONVENIENCE_FEE = 2.0;       // $2 flat

// Manual win:   platformFee = bid × 2.5%,  convenienceFee = $0
// Auto-bid win: platformFee = bid × 2.5%,  convenienceFee = $2
// Agent win:    platformFee = bid × 2.5%,  convenienceFee = $2

// Convenience fee collected via separate USDC.transfer() to PLATFORM_WALLET_ADDRESS
```

### UNSOLD Lead Handling

When auction ends with no winner (no bids or all below reserve):
- Lead status → `UNSOLD`
- `buyNowPrice = reservePrice × 1.2`
- `expiresAt = now + 7 days`
- Available in "Buy It Now" marketplace section
- Buyer can purchase directly without auction

---

## 6. Backend Architecture

### Key Services

| Service | Purpose |
|---------|---------|
| `x402.service.ts` | USDC escrow lifecycle (prepare → confirm → release → refund). Uses `DEPLOYER_PRIVATE_KEY` for server-side flow. Client-side flow returns encoded calldata. Convenience fee transfer logic. |
| `nft.service.ts` | LeadNFTv2 minting, sale recording, quality score updates. Off-chain fallback when contracts not configured. |
| `auto-bid.service.ts` | Evaluates leads against all active `BuyerPreferenceSet` rules. Checks: vertical match, geo (country + state include/exclude), quality score, reserve price vs max bid, daily budget cap, USDC allowance. |
| `privacy.service.ts` | AES-256-GCM encryption/decryption. `encryptLeadPII()`, `decryptLeadPII()`, `encryptBid()`, `decryptBid()`, `encryptTokenMetadata()`. Uses 32-byte `PRIVACY_ENCRYPTION_KEY`. |
| `auction.service.ts` | Auction room management, bid validation, timer utilities. |
| `vertical.service.ts` | Vertical CRUD, hierarchy management, form config validation. |
| `vertical-nft.service.ts` | VerticalNFT minting, batch operations, holder checks. |
| `holder-perks.service.ts` | Holder perk calculations: bid multiplier, pre-ping window, fee discounts. |
| `perks-engine.ts` | Perk evaluation engine for holder benefits. |
| `cre.service.ts` | CRE integration: JS source management, request orchestration. |
| `ace.service.ts` | ACE compliance checks: KYC status, jurisdiction validation, reputation. |
| `conversion-tracking.service.ts` | Seller conversion pixel/webhook firing on lead_sold events. |
| `quarterly-reset.service.ts` | Vertical lease lifecycle: grace period, renewal, auction triggers. |
| `zk.service.ts` | ZK proof utilities for parameter verification. |

### Socket.IO (RTBSocketServer — 780 lines)

**Events emitted:**
- `auction:start` — new auction begins
- `auction:bid` — new bid placed (commitment only, amount hidden)
- `auction:tick` — countdown update
- `auction:end` — auction resolved with winner
- `lead:escrow-confirmed` — escrow funded successfully
- `holder:notify-pending` — debounced holder notification toggle

**`resolveAuction(leadId)`** — The core settlement logic (250 lines). Finds highest revealed bid with holder multiplier tiebreaker. Creates Transaction with `calculateFees()`. Fires conversion tracking pixel/webhook. Mints NFT (best-effort). Updates all DB records.

### API Endpoints (Key Routes)

**Auth (`auth.routes.ts`):**
- `POST /api/v1/auth/nonce` — Get SIWE nonce
- `POST /api/v1/auth/login` — SIWE login
- `POST /api/v1/auth/demo-login` — Demo persona login

**Marketplace (`marketplace.routes.ts` — 63KB):**
- `GET /api/v1/asks` — List asks with filters
- `POST /api/v1/asks` — Create ask
- `GET /api/v1/leads/:id` — Lead detail (includes `convenienceFee`, `convenienceFeeType`, decrypted PII if won)
- `POST /api/v1/leads/:id/prepare-escrow` — Returns encoded tx calldata
- `POST /api/v1/leads/:id/confirm-escrow` — Verifies tx receipts (accepts `convenienceFeeTxHash`)
- `GET /api/v1/marketplace/unsold` — Buy It Now leads

**Bidding (`bidding.routes.ts`):**
- `POST /api/v1/bids` — Place sealed bid
- `GET /api/v1/bids/bid-floor` — Real-time bid floor pricing
- `GET /api/v1/bids/preferences/v2` — Get buyer preference sets
- `PUT /api/v1/bids/preferences/v2` — Update preference sets
- `GET /api/v1/buyer/usdc-allowance` — Check on-chain USDC allowance

**Verticals (`vertical.routes.ts`):**
- `GET /api/v1/verticals` — List all active verticals (hierarchical)
- `POST /api/v1/verticals` — Create vertical
- `PUT /api/v1/verticals/:id` — Update vertical (including formConfig)
- `DELETE /api/v1/verticals/:id` — Delete vertical
- `POST /api/v1/verticals/suggest` — AI vertical suggestion

**CRM (`crm.routes.ts`):**
- `GET /api/v1/crm/export` — Export leads as CSV/JSON
- `POST /api/v1/crm/webhooks` — Register CRM webhook

**Integration (`integration.routes.ts`):**
- `POST /api/v1/integration/leads` — API key-authenticated lead submission
- `GET /api/v1/integration/api-keys` — Manage API keys

### Encryption Implementation

```typescript
// privacy.service.ts — AES-256-GCM
class PrivacyService {
    private key: Buffer; // 32-byte key from PRIVACY_ENCRYPTION_KEY env var

    encrypt(plaintext: string, associatedData?: string): EncryptedPayload {
        // iv = crypto.randomBytes(12)
        // cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
        // Returns { ciphertext, iv, tag, commitment: sha256(plaintext) }
    }

    encryptLeadPII(piiData: { firstName, lastName, email, phone, address, ... }): {
        encrypted: EncryptedPayload;
        dataHash: string; // keccak256 hash for on-chain reference
    }
}
```

---

## 7. Frontend Architecture

### Tech Stack
- **Vite + React 18 + TypeScript**
- **Wagmi v2 + RainbowKit** — wallet connection (MetaMask, WalletConnect)
- **TanStack Query** — data fetching
- **Socket.IO client** — real-time auction updates
- **Tailwind CSS** — styling
- **Chains:** Base Sepolia (primary) + Sepolia (fallback)

### Routes (from App.tsx)

| Path | Component | Auth |
|------|-----------|------|
| `/` | HomePage (redirects if auth'd) | Public |
| `/marketplace` | HomePage | Public |
| `/auction/:leadId` | AuctionPage | Public |
| `/lead/:id` | LeadDetailPage | Public |
| `/f/:slug` | HostedForm | Public |
| `/buyer` | BuyerDashboard | BUYER |
| `/buyer/bids` | BuyerBids | BUYER |
| `/buyer/analytics` | BuyerAnalytics | BUYER |
| `/buyer/preferences` | BuyerPreferences | BUYER |
| `/buyer/portfolio` | BuyerPortfolio | BUYER |
| `/buyer/integrations` | BuyerIntegrations | BUYER |
| `/seller` | SellerDashboard | SELLER |
| `/seller/leads` | SellerLeads | SELLER |
| `/seller/funnels` | SellerFunnels | SELLER |
| `/seller/submit` | SellerSubmit | SELLER |
| `/seller/analytics` | SellerAnalytics | SELLER |
| `/seller/integrations` | SellerIntegrations | SELLER |
| `/admin/nfts` | AdminNFTs | ADMIN |
| `/admin/verticals` | AdminVerticals | ADMIN |
| `/admin/form-builder` | FormBuilder | ADMIN |

### Key Components
- **DemoPanel** — floating panel (dev/demo mode) for injecting leads, starting auctions, settling
- **BidPanel** — sealed bid placement with commitment generation
- **AuctionTimer** — countdown display
- **LeadPreview** — lead card with geo, vertical, quality score
- **PreferenceSetCard** — autobid rule card with geo filters, budget, quality threshold
- **DynamicFieldRenderer** — renders form fields from vertical's `formConfig`
- **VerticalSelector / NestedVerticalSelect** — hierarchical vertical picker
- **EscrowStepIndicator** — 4-step progress (Approve → Create Escrow → Convenience Fee → Confirming)
- **HolderPerksBadge / HolderWinRateChart** — vertical NFT holder UX
- **UsdcAllowanceCard** — on-chain USDC balance/allowance display

### Wagmi Config (`wagmi.ts`)
```typescript
chains: [baseSepolia, sepolia]
transports: {
    [sepolia.id]: http(VITE_RPC_URL_SEPOLIA),
    [baseSepolia.id]: http(VITE_RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org'),
}
// USDC addresses hardcoded per chain
// Contract addresses from VITE_* env vars
```

### useEscrow Hook (Client-Side Signing)
Steps: `idle` → `approving` → `creating-escrow` → `transferring-fee` → `confirming` → `done`

Three MetaMask prompts:
1. `USDC.approve(escrowAddress, bidAmount)` — with gas estimation + 20% buffer
2. `RTBEscrow.createEscrow(seller, buyer, amount)` — via `sendTransaction` with encoded calldata
3. `USDC.transfer(platformWallet, $2)` — convenience fee (only for AUTO_BID/AGENT wins)

---

## 8. MCP Agent Server

**9 registered tools** in `mcp-server/tools.ts`:

| Tool | Method | Endpoint | Description |
|------|--------|----------|-------------|
| `search_leads` | GET | `/api/v1/marketplace/search` | Search marketplace with vertical/geo/quality filters |
| `place_bid` | POST | `/api/v1/bids` | Place sealed bid with `source: AGENT` |
| `get_bid_floor` | GET | `/api/v1/bids/floor` | Real-time floor pricing by vertical+geo |
| `export_leads` | GET | `/api/v1/crm/export` | Export won leads as CSV/JSON |
| `get_preferences` | GET | `/api/v1/bids/preferences/v2` | Get buyer's preference sets |
| `set_auto_bid_rules` | PUT | `/api/v1/bids/preferences/v2` | Configure autobid rules |
| `configure_crm_webhook` | POST | `/api/v1/crm/webhooks` | Set up CRM integration webhook |
| `ping_lead` | GET | `/api/v1/leads/:id/ping` | Check lead status/freshness |
| `suggest_vertical` | POST | `/api/v1/verticals/suggest` | AI-powered vertical suggestion |

**Auth:** API key in `Authorization: Bearer <key>` header. Keys stored hashed in `ApiKey` model with `permissions[]` array.

**Architecture:** JSON-RPC server (`mcp-server/index.ts`). Each tool definition includes `schema` (JSON Schema for params), `handler` (endpoint URL), and `method` (HTTP verb). `agent-logger.ts` logs all tool invocations.

---

## 9. Chainlink Integrations

### 9.1 CREVerifier (Chainlink Functions)

**Contract:** `CREVerifier.sol` — extends `FunctionsClient`.

**Three verification types with JS source stored on-chain:**

1. **Parameter Match** — `requestParameterMatch(leadTokenId, buyerParams)` → Runs off-chain JS that compares lead parameters against buyer criteria. Returns match score (0-100).
2. **Geo Validation** — `requestGeoValidation(leadTokenId, expectedGeoHash, precision)` → Validates lead's geographic claim matches its actual location.
3. **Quality Score** — `requestQualityScore(leadTokenId)` → Analyzes lead signals (recency, completeness, consent, verification) and returns 0-10000 score.

**Backend integration:** `cre.service.ts` manages JS source code, sends requests, handles `fulfillRequest` callbacks.

**Config env vars:**
- `CHAINLINK_ROUTER_SEPOLIA=0xb83E47C2bC239B3bf370bc41e1459A34b41238D0`
- `CHAINLINK_DON_ID_SEPOLIA=0x66756e2d657468...` (fun-ethereum-sepolia-1)
- `CRE_SUBSCRIPTION_ID=0` (needs real subscription)

### 9.2 CustomLeadFeed (CRE Cron / Data Streams)

**Contract:** `CustomLeadFeed.sol` — on-chain data feed for platform metrics.

**Metrics written by CRE cron workflow (daily):**
- `averageQualityScore` — 0-10000 scale
- `totalVolumeSettledCents` — cumulative USDC volume
- `totalLeadsTokenized` — count of minted NFTs
- `auctionFillRate` — % of auctions with winning bid (0-10000 bps)

**Consumer pattern:** `latestQualityScore()`, `latestVolume()`, `latestFillRate()`, `latestAllMetrics()` — all staleness-aware via `maxStalenessSeconds`.

**Backend integration:** `datastreams.service.ts` aggregates platform data and calls `updateMetrics()`.

### 9.3 ACECompliance

**Not a Chainlink integration directly** — but designed to receive verified attestations from Chainlink Functions or other oracle-verified KYC providers. `verifyKYC()` currently trusts `authorizedVerifiers` (placeholder for production ZK proof verification).

### 9.4 VerticalNFT Price Feed

`VerticalNFT.sol` integrates with Chainlink price feed for dynamic floor pricing. The contract stores a `priceFeed` address for ETH/USD conversion.

---

## 10. Deployment Configuration

### render.yaml

```yaml
databases:
  - name: lead-engine-db
    plan: free
    databaseName: lead_engine_cre
    postgresMajorVersion: "16"

services:
  - type: web
    name: lead-engine-api
    runtime: node
    plan: free
    buildCommand: cd backend && npm install && npx prisma generate && npx prisma db push && npm run build
    startCommand: cd backend && node dist/index.js
    healthCheckPath: /api/v1/health
    envVars:
      - key: DATABASE_URL
        fromDatabase: lead-engine-db
      - key: RPC_URL_BASE_SEPOLIA
        value: https://sepolia.base.org
      # ... all contract addresses, API keys, secrets
```

### Key Environment Variables

| Variable | Current Value | Notes |
|----------|---------------|-------|
| `RPC_URL_SEPOLIA` | Alchemy endpoint | Rate-limited |
| `RPC_URL_BASE_SEPOLIA` | `https://sepolia.base.org` | Public RPC |
| `ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA` | `0x80fA1d...` | Primary chain |
| `LEAD_NFT_CONTRACT_ADDRESS_BASE_SEPOLIA` | `0x37414b...` | Primary chain |
| `USDC_CONTRACT_ADDRESS` | `0x036CbD...` | Base Sepolia Circle USDC |
| `DEPLOYER_PRIVATE_KEY` | Set (HD wallet #0) | Used for server-side txs |
| `PRIVACY_ENCRYPTION_KEY` | Placeholder | **MUST be real 32-byte hex** |
| `PLATFORM_WALLET_ADDRESS` | Falls back to deployer | Should be separate wallet |
| `TESTNET_MNEMONIC` | 12-word phrase | For 10 HD test wallets |

---

## 11. Recent Changes (Last 30 Commits)

### $2 Convenience Fee (Option B — Separate USDC Transfer)
- Added `CONVENIENCE_FEE = 2.0` to `fees.ts` with `totalBuyerCharge` field
- `x402.service.ts`: Encodes `USDC.transfer()` calldata in `prepareEscrowTx()`, verifies `convenienceFeeTxHash` in `confirmEscrowTx()`, handles server-side transfer in `createPayment()`
- `useEscrow.ts`: Added `'transferring-fee'` step — third MetaMask prompt
- `LeadDetailPage.tsx`: Updated `EscrowStepIndicator` to show 4 steps
- `socket.ts`: Fixed conversion tracking to report `platformFee` only (not `totalFees`)

### Client-Side Escrow Signing (TD-01 Fix)
- Refactored from deployer-wallet-pays-for-everything to buyer-signs-with-MetaMask
- `prepareEscrowTx()` returns encoded calldata instead of executing
- Frontend `useEscrow` hook handles approval + escrow creation + fee transfer

### Lead Detail & Escrow UI
- Auto-refresh after `confirmEscrow` completes
- Socket listener for `lead:escrow-confirmed` event
- Decrypted PII display for won leads with demo fallback

### Base Sepolia Deployment
- RTBEscrow → `0x80fA1d07a1D5b20Fd90845b4829BEB30B3f86507`
- LeadNFTv2 → `0x37414bc0341e0AAb94e51E89047eD73C7086E303`
- Wagmi config updated for dual-chain support
- Hardhat config updated with Base Sepolia network

### Tech Debt Audit
- `TECH_DEBT.md` created with 24 documented issues (10 Critical, 7 Medium, 7 Low)

### Wallet & Auth Fixes
- Removed `mainnet` from Wagmi chains (eliminated cloudflare-eth RPC spam)
- Added mutex to prevent concurrent SIWE `login()` calls
- Fixed seller wallet assignment to use faucet wallets from `faucet-wallets.txt`

### Demo Cleanup
- Removed mock data from production analytics views
- Replaced Faker.js seeding with Prisma/Redis-only data in production

---

## 12. Tech Debt Summary (24 Items)

### 🔴 Critical (10)
| ID | Issue | Quick Fix? |
|----|-------|-----------|
| TD-01 | Deployer wallet pays for all on-chain actions | ✅ **Partially fixed** (client-side escrow signing implemented, server-side flow still uses deployer) |
| TD-02 | Off-chain fallbacks silently bypass on-chain behavior | Planning started (conversation `3978d960`) |
| TD-03 | Sequential escrow scan (loop 1-50 RPC calls) | Store escrowId↔leadId mapping in DB |
| TD-04 | USDC check uses DB wallet, not session wallet | Use `req.user.walletAddress` |
| TD-05 | NFT mint/recordSale are non-fatal best-effort | Make required for production |
| TD-06 | Demo buyers toggle resets to ON on restart | Persist in DB/Redis |
| TD-07 | Demo bids via fire-and-forget setTimeout | Use BullMQ |
| TD-08 | `consentProof` field hijacked as demo tag | Add `isDemo` flag |
| TD-09 | "Clear Demo Data" deletes ALL data | Scope to demo records |
| TD-10 | Settlement auto-creates missing Transaction records | Fix root cause |

### 🟡 Medium (7)
| ID | Issue |
|----|-------|
| TD-11 | Privacy encryption key random on restart if env var unset |
| TD-12 | USDC approve uses 10× amount (over-approval) |
| TD-13 | Hardcoded gas limits (500k mint, 200k sale) |
| TD-14 | Hardcoded Sepolia chain ID in Transaction update |
| TD-15 | DemoPanel hardcodes fallback wallet addresses |
| TD-16 | DEMO_WALLETS and FAUCET_WALLETS overlap |
| TD-17 | Auto-bid stores amount + commitment (breaks sealed-bid) |

### 🟢 Low (7)
TD-18 through TD-24: Demo bids skip commit-reveal, parameters JSON used as tag, USDC check swallows RPC errors, hardcoded demo RPC fallback, `getLeadMetadata` ABI mismatch, platform fee hardcoded at 2.5%, no PII encryption for demo leads.

---

## 13. Readiness for VerticalField Model

### What Exists Today (Field-Level Foundation)

The platform already has a rich form-config system with 50 vertical-specific configs. Each vertical's `formConfig` defines typed fields with `id`, `key`, `label`, `type`, `required`, `options[]`. Fields span 7 types: `text`, `select`, `boolean`, `number`, `textarea`, `email`, `phone`.

**Current field data storage:** All field values are stored as a flat JSON blob in `Lead.parameters`. There is NO per-field schema enforcement at the DB level — only at form-config rendering time.

**Current autobidding granularity:** `BuyerPreferenceSet` filters by `vertical` (single), `geoCountries[]`, `geoInclude[]`, `geoExclude[]`, `maxBidPerLead`, `dailyBudget`, `minQualityScore`. There is **no field-level filtering** — a buyer cannot say "only auto-bid on solar leads where `creditScore = 'Excellent'`".

### What VerticalField Would Add

A `VerticalField` model would promote fields from untyped JSON blobs to first-class database entities:

```prisma
model VerticalField {
  id          String   @id @default(cuid())
  verticalId  String
  key         String           // "creditScore", "propertyType"
  label       String           // Human-readable label
  fieldType   FieldType        // TEXT, SELECT, BOOLEAN, NUMBER, TEXTAREA, EMAIL, PHONE
  required    Boolean  @default(false)
  options     String[]         // For SELECT fields
  sortOrder   Int      @default(0)
  isFilterable Boolean @default(true)   // Can buyers filter on this field?
  isBiddable  Boolean  @default(false)  // Can buyers set autobid rules on this field?
  vertical    Vertical @relation(fields: [verticalId], references: [id])
  @@unique([verticalId, key])
}
```

**Impact on autobidding:** With `VerticalField`, you could add a `BuyerFieldFilter` model:

```prisma
model BuyerFieldFilter {
  id                  String   @id @default(cuid())
  preferenceSetId     String
  verticalFieldId     String
  operator            FilterOperator  // EQUALS, IN, GT, LT, GTE, LTE, BETWEEN, NOT_IN
  value               String          // JSON-encoded value
  preferenceSet       BuyerPreferenceSet @relation
  verticalField       VerticalField @relation
}
```

This enables rules like: "Auto-bid $25 on `solar.residential` leads where `creditScore IN ['Excellent', 'Good']` AND `electricBill >= '$200-$300'` AND `state NOT IN ['AK', 'HI']`".

### Migration Path

1. Create `VerticalField` model in Prisma schema
2. Write migration script to read all `formConfig` JSONs and create `VerticalField` rows
3. Update `formConfig` to reference `VerticalField` IDs instead of inline definitions
4. Add `BuyerFieldFilter` model linked to `BuyerPreferenceSet`
5. Update `auto-bid.service.ts` to check field-level filters against `Lead.parameters`
6. Update the Admin Form Builder UI to manage `VerticalField`s
7. Update `BuyerPreferences` page to show filterable/biddable fields per vertical

### What Stays the Same
- `Lead.parameters` JSON stays (contains actual values)
- `formConfig` rendering still works (backward compatible)
- All 50 existing vertical configs continue functioning
- Current macro-level autobid rules (vertical, geo, quality, budget) remain

---

## 14. Open Questions for Grok

### Architecture
1. **VerticalField migration:** Should `formConfig` be replaced entirely by `VerticalField` rows, or should both coexist? The form-config approach is simpler for form rendering; VerticalField is needed for DB-level queries and field-level autobidding.

2. **Field-level autobid evaluation cost:** With N field filters × M active preference sets × L incoming leads, what's the recommended evaluation strategy? In-memory filter engine vs. Prisma query with JSON path filters?

3. **CustomLeadFeed update cadence:** Currently designed for daily cron. Should it be event-driven (update on each auction resolution) for real-time analytics?

### Smart Contracts
4. **Which contracts need Base Sepolia deployment?** ACECompliance, CREVerifier, Marketplace, VerticalNFT, VerticalAuction, CustomLeadFeed are only on Sepolia. Should all be deployed to Base Sepolia for the final build?

5. **CREVerifier subscription:** `CRE_SUBSCRIPTION_ID=0` — needs a real Chainlink Functions subscription on Base Sepolia. What's the recommended starter template for the CRE cron workflow?

6. **Marketplace.sol vs socket.ts auction:** The on-chain Marketplace has full commit-reveal bidding. The backend socket.ts also has auction logic. Are both needed? Should the backend be a thin relay to on-chain, or does the hybrid approach (off-chain auction + on-chain escrow) remain the architecture?

### Data Model
7. **Field type expansion:** Current types are `text|select|boolean|number|textarea|email|phone`. Should VerticalField support additional types like `date`, `range`, `multi-select`, `file-upload`, `address-autocomplete`?

8. **Lead.parameters normalization:** Currently a flat JSON. Should individual field values be stored in a separate `LeadFieldValue` join table (leadId + verticalFieldId + value) for queryability? Trade-off: flexibility vs. query complexity.

### Production Readiness
9. **Off-chain fallback strategy (TD-02):** Plan started but not implemented. Should off-chain mode be a hard block (server won't start) or a degraded mode with visible warnings?

10. **Privacy key management:** `PRIVACY_ENCRYPTION_KEY` is a single AES key. Should there be key rotation support? What about per-lead keys derived from a master key?

11. **Demo infrastructure isolation:** 10 critical tech debt items relate to demo code leaking into production. What's the recommended approach — feature flags, separate demo service, or stripping demo code entirely for production builds?

---

## 15. Project Health Summary

| Dimension | Status | Notes |
|-----------|--------|-------|
| **Core auction flow** | 🟢 Working | 60s sealed-bid auctions with auto-resolve |
| **Escrow (client-side)** | 🟢 Working | 3-step MetaMask signing with convenience fee |
| **Auto-bidding** | 🟢 Working | Vertical + geo + quality + budget filters |
| **NFT minting** | 🟡 Best-effort | Non-fatal — can silently fail (TD-05) |
| **Privacy/encryption** | 🟡 Key risk | Random key on restart if env var unset (TD-11) |
| **Demo isolation** | 🔴 Risky | Demo code deeply interleaved with production (TD-06-10) |
| **On-chain integrity** | 🟡 Partial | Client-side signing works; server-side still uses deployer |
| **Chainlink CRE** | 🟡 Scaffolded | Contracts deployed, no live subscription |
| **Chainlink Functions** | 🟡 Scaffolded | CREVerifier deployed, JS sources need real implementation |
| **CustomLeadFeed** | 🟡 Designed | Contract written, no cron job wired |
| **VerticalField model** | 🔴 Not built | Form configs exist as JSON; no DB-level field entities |
| **Field-level autobidding** | 🔴 Not built | Only macro-level filters (vertical, geo, quality, budget) |
| **MCP agent** | 🟢 Working | 9 tools, JSON-RPC transport |
| **Test coverage** | 🟡 Minimal | Only `fees.test.ts` (10 tests), 11 Hardhat test files |
| **Deployment** | 🟢 Configured | render.yaml + Base Sepolia contracts deployed |

**Lines of code (approx):**
- Backend: ~15,000 lines TypeScript
- Contracts: ~3,500 lines Solidity
- Frontend: ~12,000 lines TypeScript/TSX
- Config/scripts/docs: ~3,000 lines
- **Total: ~33,500 lines**
