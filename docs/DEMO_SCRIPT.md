# Demo Video Script — Lead Engine CRE

**Target length:** 3–4 minutes
**Format:** Screen recording with voiceover (Loom/OBS)

---

## Scene 1: Title + Problem (0:00 – 0:30)

**Show:** Title slide or README hero section
**Say:**
> "Lead Engine is a decentralized real-time bidding platform for the $100 billion lead marketplace. Today, lead trading relies on opaque intermediaries with no trust, no privacy, and no compliance enforcement. We're fixing that with Chainlink."

---

## Scene 2: Seller Submits Lead (0:30 – 1:00)

**Show:** Seller Dashboard → Create Lead form
**Actions:**
1. Connect wallet (MetaMask/WalletConnect)
2. Fill lead: Vertical = Solar, State = FL, Zip = 33101, Credit Score = 720
3. Submit → CRE verification begins

**Say:**
> "A seller submits a solar lead in Florida. Immediately, Chainlink CRE Functions verify the lead's quality score on-chain — checking data completeness, source credibility, and geo-demand signals."

---

## Scene 3: CRE Verification + ZK Proof (1:00 – 1:45)

**Show:** API response from `/api/v1/demo/zk-verify` or backend logs
**Actions:**
1. Show CRE quality score (e.g., 7200/10000)
2. Show ZK fraud proof generation — commitment hash
3. Show proof verification (valid: true)

**Say:**
> "The CRE Verifier computes a quality score of 7,200 out of 10,000. Simultaneously, a ZK fraud detection proof is generated — a keccak256 commitment that can be verified on-chain without revealing any PII. This is the trust layer that doesn't exist today."

---

## Scene 4: ACE Compliance Check (1:45 – 2:15)

**Show:** API response from `/api/v1/demo/compliance-check`
**Actions:**
1. Show KYC auto-verification (buyer wallet → PASSED)
2. Show cross-border check: FL→CA solar = ALLOWED
3. Show blocked scenario: FL→NY mortgage = BLOCKED (requires licensing)

**Say:**
> "Before any bid, Chainlink ACE runs automated compliance. KYC is verified on-chain. Cross-border rules enforce state-specific licensing — solar trades freely between FL and CA, but mortgage transactions involving NY require additional compliance. This is instant and automatic."

---

## Scene 5: Encrypted Bid + Commit-Reveal (2:15 – 2:45)

**Show:** Buyer Dashboard → Place Bid or API `/api/v1/demo/e2e-bid`
**Actions:**
1. Buyer submits encrypted bid ($35 USDC)
2. Show commitment hash (solidityPackedKeccak256)
3. Bid reveal → amount decrypted, commitment verified

**Say:**
> "The buyer places a privacy-preserving bid. The amount is encrypted with AES-256-GCM and committed on-chain using a solidity-packed hash. During the reveal phase, the commitment is verified — if it doesn't match, the bid is rejected. Competitors never see bid amounts."

---

## Scene 6: Settlement + NFT Mint (2:45 – 3:15)

**Show:** Transaction result + NFT details
**Actions:**
1. Winning bid → Escrow created (USDC)
2. NFT minted with lead metadata + quality score
3. Escrow released to seller (minus 2.5% platform fee)

**Say:**
> "Upon winning, the lead is minted as an ERC-721 NFT with on-chain provenance. The USDC payment flows through our RTB Escrow contract — held until delivery, then released minus a 2.5% platform fee. Complete, trustless settlement."

---

## Scene 7: Global Scale (3:15 – 3:35)

**Show:** Load test results or multi-vertical demo
**Actions:**
1. Show 6 supported verticals
2. Show 123 tests passing
3. Show load test: 1000+ concurrent users, p99 < 2s

**Say:**
> "Lead Engine supports six verticals out of the box and is designed for global scale. Our test suite covers 123 scenarios including compliance across 17 state pairs. Load testing validates over 1,000 concurrent users with sub-2-second latency."

---

## Scene 8: Close (3:35 – 3:50)

**Show:** Architecture diagram from README + repo link
**Say:**
> "Lead Engine combines Chainlink CRE, ACE, ZK proofs, and NFT tokenization to build a transparent, compliant, and privacy-preserving lead marketplace. We're ready for production. Thank you."

---

## Backup Plan for Demo Failures

| Failure | Backup |
|---------|--------|
| Wallet won't connect | Use pre-recorded wallet connection segment |
| RPC timeout | All services have off-chain fallbacks — demo continues with DB-only mode |
| Contract call fails | Show pre-captured transaction on Etherscan/Sepolia explorer |
| Frontend blank | Demo via API endpoints directly (Postman/curl) |
| Database down | Unit tests run without DB — run `npm test` as backup demo |

**Pre-record key segments** using Loom before live recording as insurance.
