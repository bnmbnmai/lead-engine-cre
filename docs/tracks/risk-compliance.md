# Risk & Compliance Track

LeadRTB — ACE policy-gated NFT minting with on-chain KYC enforcement

---

## Why LeadRTB Wins This Track

LeadRTB integrates **ACE (Access, Compliance, Enforcement)** directly into the lead tokenization flow — every NFT mint passes through a `runPolicy` modifier that enforces KYC/geo/reputation rules on-chain before any lead can be tokenized.

## ACE & Compliance Integrations

- **ACECompliance** ([0xAea259…EfE6](https://sepolia.basescan.org/address/0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6)) — On-chain KYC registry with `verifyKYC()`, `isCompliant()`, and `canTransact()` methods. Buyers must pass compliance before bidding.
- **ACELeadPolicy** ([0x013f32…566F](https://sepolia.basescan.org/address/0x013f3219012030aC32cc293fB51a92eBf82a566F)) — Lead-specific policy rules enforced per vertical. Attached to `LeadNFTv2` via `PolicyProtectedUpgradeable`.
- **LeadNFTv2 `runPolicy` Modifier** — Every `mintLead()` call executes `IPolicyEngine.run()` on-chain before minting. PolicyEngine auto-detaches in demo mode for reliability.
- **TCPA Consent Gate** — `tcpaConsentAt` timestamp required for regulated verticals (mortgage, insurance, solar). Encoded as `bool tcpaConsent` in mint calldata.

## Evidence

- **ACE KYC badge** visible in Buyer Portfolio: "ACE KYC Status: KYC Verified / Chainlink ACE Compliant"
- **Per-vertical policy rules** enforced on-chain (mortgage, insurance, solar require TCPA consent)
- **Auto-KYC registration** via `aceService.autoKYC(walletAddress)` during demo persona switch
- **Live demo:** [leadrtb.com](https://leadrtb.com) — switch to Buyer persona to see ACE compliance status

<!-- Screenshot: ACE KYC Verified badge in Buyer Portfolio -->
