# Lead Engine CRE — Test Plan

## Coverage Matrix

| Service | Test File | Scenarios | Key Edge Cases |
|---------|-----------|-----------|---------------|
| CRE | `tests/unit/cre.service.test.ts` | 10 | Expired TCPA, data integrity mismatch, quality cap at 10000, geo filter miss |
| ACE | `tests/unit/ace.service.test.ts` | 12 | Expired KYC, blacklisted wallet, cross-border mortgage NY/CA/MA, reputation clamping |
| x402 | `tests/unit/x402.service.test.ts` | 10 | Double-settle, refund after release, missing escrow, zero amount |
| Privacy | `tests/unit/privacy.service.test.ts` | 12 | Tampered ciphertext, wrong AAD, case-altered address, small/large amounts |
| NFT | `tests/unit/nft.service.test.ts` | 6 | Already minted skip, non-existent lead, off-chain pseudo-tokenId |
| ZK | `tests/unit/zk.service.test.ts` | 10 | Zero proof, empty inputs, zero commitment, parameter threshold fail |
| E2E | `tests/e2e/demo-flow.test.ts` | 5 | Full 8-step pipeline, non-compliant buyer, wrong reveal address |
| Privacy Audit | `tests/security/privacy-audit.test.ts` | 10 | Plaintext leakage, commitment swap, cross-buyer decryption |
| ACE Sim | `tests/compliance/ace-simulation.test.ts` | 50+ | 17 cross-border state pairs, 8 reputation values, off-site API fraud |

## Commands

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# E2E tests
npm run test:e2e

# Security tests
npm run test:security

# Compliance simulation
npm run test:compliance

# Coverage report
npm run test:coverage

# Load test (requires running server)
npm run test:load

# Security scan (Snyk + Slither)
powershell scripts/security-scan.ps1
```

## Load Test Parameters

| Phase | Duration | Rate | Purpose |
|-------|----------|------|---------|
| Warm up | 30s | 50/s | Baseline |
| Sustained | 60s | 200/s | Normal load |
| Spike | 30s | 500/s | Geo-filtered bids |
| Peak | 30s | 1000→1500/s | Stress test |
| Cool down | 15s | 50/s | Recovery |

**Success criteria:** p99 latency < 2s, error rate < 5%

## Security Checklist

- [ ] `npm audit` — zero HIGH/CRITICAL in backend/frontend
- [ ] Encrypted bids never contain plaintext amounts
- [ ] PII encrypted at rest (AES-256-GCM with AAD binding)
- [ ] Wrong buyer cannot decrypt another buyer's bid
- [ ] Commitment integrity prevents bid amount manipulation
- [ ] Slither: no HIGH/MEDIUM findings in Solidity contracts

## Optimization

- **LRU Cache** (`src/lib/cache.ts`): TTL-based caching for quality scores (5 min), parameter matches (2 min), compliance checks (10 min), KYC (30 min)
- **Gas Profile** (`contracts/scripts/gas-profile.ts`): Measures gas for KYC, reputation, mint, sale, create/release escrow
