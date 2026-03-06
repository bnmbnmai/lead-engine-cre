# Privacy Track

LeadRTB — Winner-only PII decryption via CRE Confidential Compute

---

## Why LeadRTB Wins This Track

LeadRTB ensures sensitive PII is never exposed to losing bidders or the platform after settlement. Lead data is encrypted at rest using AES-256-GCM, zero PII touches the blockchain, and only the auction winner can decrypt via CRE Confidential Compute with `encryptOutput: true`.

## Privacy Integrations

- **Winner-Only PII Decryption** — `DecryptForWinner` CRE workflow uses `ConfidentialHTTPClient` + `encryptOutput: true`. Backend verifies `escrowReleased: true` before decrypting. Non-winners see only anonymized metadata.
- **AES-256-GCM Encryption at Rest** — Each lead's PII (name, email, phone, address) encrypted with a unique key via `privacyService.encryptLeadPII()`. Stored as `lead.encryptedData` in PostgreSQL.
- **Zero On-Chain PII** — All NFT hashes are `keccak256` of field values. No raw data ever touches the blockchain.
- **CHTT Phase 2** — `CREVerifier.requestZKProofVerification()` dispatches live ZK fraud-signal DON requests with SubtleCrypto-encrypted payloads. Enclave key uploaded to DON Vault slot 0.

## Evidence

- **Real PII decrypt live:** Hosted lander/API leads decrypt actual `lead.encryptedData` via `privacyService.decryptLeadPII()`. Demo-drip leads use synthetic fallback.
- **Confidential HTTP Vault secrets:** `{{.creApiKey}}` injected from Vault DON — API key never in config or node memory
- **TCPA consent tracking:** `tcpaConsentAt` timestamp required before any mint
- **Live demo:** [leadrtb.com](https://leadrtb.com) — win a lead, then click "🔓 Decrypt PII" to see winner-only decryption

<!-- Screenshot: Decrypted PII panel with "CRE DON Attested" badge -->
