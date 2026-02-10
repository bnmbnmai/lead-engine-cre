# Demo Video Script — Lead Engine CRE

**Target length:** 3–4 minutes
**Format:** Screen recording with voiceover (Loom/OBS)
**Pre-flight:** Seed mock data before recording → `cd backend && npm run db:seed`

---

## Scene 1: Title + Problem (0:00 – 0:30)

**Show:** Landing page hero — "Decentralized Lead RTB / Global. Compliant. Private."
**Actions:**
1. Load homepage (signed out) — show geo-enhanced hero with stats bar (2,847 active leads, $127 avg bid, 15+ countries, 8 verticals)
2. Scroll to feature cards (CRE, ACE, ZK Privacy, 15+ Global Markets) and "How It Works" section

**Say:**
> "Lead Engine is a decentralized real-time bidding platform for the $100 billion lead marketplace. Today, lead trading relies on opaque intermediaries with no trust, no privacy, and no compliance enforcement. We're fixing that with Chainlink — across 10 verticals and 15 countries."

---

## Scene 2: Seller Submits Lead (0:30 – 1:15)

**Show:** Seller Dashboard → Submit Lead page (3 source tabs)
**Actions:**
1. Connect wallet (MetaMask/WalletConnect) — opaque dropdown, no pre-login sidebar
2. Navigate to Seller → Submit Lead
3. Show Platform tab: Vertical = Solar, Country = DE (Germany), State = Bayern, Zip = 80331
4. Fill dynamic solar fields: Roof Age = 5, Monthly Bill = €180, Ownership = owned
5. Submit → CRE verification begins
6. Quick switch to API tab — show curl examples (Roofing US/FL, Mortgage US/NY, Auto AU/NSW)

**Say:**
> "A seller submits a solar lead from Munich, Germany. Our dynamic form adapts to each vertical — showing roof age, monthly bill, and ownership for solar. We also support programmatic submission via REST API, with ready-to-use curl examples for every vertical. CRE immediately begins verifying quality on-chain."

---

## Scene 3: CRE Verification + ZK Proof (1:15 – 1:45)

**Show:** API response from `/api/v1/demo/zk-verify` or backend logs
**Actions:**
1. Show CRE quality score (e.g., 7200/10000)
2. Show ZK fraud proof generation — commitment hash
3. Show proof verification (valid: true)

**Say:**
> "The CRE Verifier computes a quality score of 7,200 out of 10,000. Simultaneously, a ZK fraud detection proof is generated — a keccak256 commitment verifiable on-chain without revealing any PII. This is the trust layer that doesn't exist today."

---

## Scene 4: ACE Compliance — Cross-Border (1:45 – 2:15)

**Show:** API response from `/api/v1/demo/compliance-check`
**Actions:**
1. Show KYC auto-verification (buyer wallet → PASSED)
2. Show cross-border check: DE solar → US buyer = ALLOWED (solar trades freely)
3. Show blocked scenario: NY mortgage cross-border = BLOCKED (requires licensing)
4. Mention MiCA attestation for EU markets

**Say:**
> "Before any bid, Chainlink ACE runs automated compliance. KYC is verified on-chain. Cross-border rules are enforced per vertical — solar trades freely across jurisdictions, but mortgage transactions involving New York require additional licensing. EU leads also get MiCA attestation. This is instant, automatic, and global."

---

## Scene 5: Off-Site Fraud Prevention (2:15 – 2:35)

**Show:** Ask creation form with `acceptOffSite` toggle → then bid rejection
**Actions:**
1. Show ask with `acceptOffSite = false` toggle visible
2. Attempt off-site bid → rejected with fraud flag
3. Mention: source spoofing detection, toggle-flip exploit prevention, sanctioned country blocking

**Say:**
> "Sellers control off-site lead acceptance with a toggle. When disabled, the platform blocks off-site leads entirely — including detecting source spoofing, preventing toggle-flip exploits, and blocking bids from sanctioned countries. Our anomaly detector flags accounts with abnormally high off-site ratios."

---

## Scene 6: Encrypted Bid + Commit-Reveal (2:35 – 2:55)

**Show:** Buyer Dashboard → Place Bid or API `/api/v1/demo/e2e-bid`
**Actions:**
1. Buyer submits encrypted bid ($35 USDC)
2. Show commitment hash (solidityPackedKeccak256)
3. Bid reveal → amount decrypted, commitment verified

**Say:**
> "The buyer places a privacy-preserving bid. The amount is encrypted with AES-256-GCM and committed on-chain. During reveal, the commitment is verified — if it doesn't match, the bid is rejected. Competitors never see bid amounts."

---

## Scene 7: Settlement + NFT Mint (2:55 – 3:15)

**Show:** Transaction result + NFT details
**Actions:**
1. Winning bid → Escrow created (USDC)
2. NFT minted with lead metadata + quality score
3. Escrow released to seller (minus 2.5% platform fee)

**Say:**
> "Upon winning, the lead is minted as an ERC-721 NFT with on-chain provenance. USDC payment flows through RTB Escrow — held until delivery, then released minus a 2.5% platform fee. Complete, trustless settlement."

---

## Scene 8: Global Scale + Testing (3:15 – 3:40)

**Show:** Security sim results (29/29) + Artillery config + Cypress test list
**Actions:**
1. Show 10 verticals, 15+ countries in marketplace filter dropdowns
2. Run security sim → 29/29 passing (including off-site fraud, cross-border ACE, sanctioned countries)
3. Show Artillery config: 13 scenarios, 1500 peak concurrent users
4. Show mock data: 200+ entries across all geos/verticals (`npm run db:seed`)

**Say:**
> "Lead Engine supports 10 verticals across 15+ countries. Our security sim passes 29 tests covering off-site fraud, cross-border compliance, and sanctioned-country blocking. Load testing validates 1,500 concurrent users across 13 scenarios. And we ship with a full mock data seeder — 200+ realistic entries for any demo."

---

## Scene 9: Close (3:40 – 3:55)

**Show:** Architecture diagram from README + repo link
**Say:**
> "Lead Engine combines Chainlink CRE, ACE, ZK proofs, and NFT tokenization to build a transparent, compliant, and privacy-preserving lead marketplace — ready for global production. Thank you."

---

## Backup Plan for Demo Failures

| Failure | Backup |
|---------|--------|
| Wallet won't connect | Use pre-recorded wallet connection segment |
| RPC timeout | All services have off-chain fallbacks — demo continues with DB-only mode |
| Contract call fails | Show pre-captured transaction on Etherscan/Sepolia explorer |
| Frontend blank | Demo via API endpoints directly (Postman/curl) |
| Database down | Unit tests run without DB — run `npm test` as backup demo |
| Mock data missing | Run `npm run db:seed` live — takes < 10 seconds |

**Pre-record key segments** using Loom before live recording as insurance.
