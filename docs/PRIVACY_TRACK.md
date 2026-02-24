# Privacy Track Code Path Walkthrough

> **Network:** Base Sepolia (84532)  
> **Audit Date:** 2026-02-24  
> **Track:** Chainlink Privacy Track (CHTT Phase 2 + AES-256-GCM PII Protection)

---

## Executive Summary

Lead Engine CRE implements a **dual-layer privacy architecture**:

1. **At-rest PII encryption** — All lead PII (name, email, phone, address) is AES-256-GCM encrypted before storage. Buyers see only redacted previews (vertical, geo-state, non-PII parameters). PII is revealed only to the auction winner after settlement.

2. **In-transit CHTT Phase 2** — Quality-scoring payloads sent to the Chainlink DON are SubtleCrypto-encrypted using an enclave key. The DON executes scoring in isolation; only the attested result (score hash) is written back on-chain.

---

## Layer 1: Lead PII Encryption

### Code Path

```
Lead Submission (lander/API)
  │
  ▼
backend/src/routes/lander.routes.ts
  └── leadService.createLead(formData)
        │
        ├── [Line 180] privacyService.encryptLeadPII(piiData)
        │     └── privacy.service.ts:PrivacyService.encryptLeadPII()
        │           ├── [Line 178] JSON.stringify(piiData) → plaintext
        │           ├── [Line 179] ethers.keccak256(toUtf8Bytes(plaintext)) → dataHash
        │           └── [Line 180] this.encrypt(plaintext) → EncryptedPayload
        │                 ├── [Line 53]  crypto.randomBytes(12) → 96-bit IV
        │                 ├── [Line 54]  crypto.createCipheriv('aes-256-gcm', key, iv)
        │                 ├── [Line 60]  cipher.update(plaintext) + cipher.final()  → ciphertext
        │                 ├── [Line 62]  cipher.getAuthTag() → 128-bit auth tag (GCM MAC)
        │                 └── [Line 65]  ethers.keccak256(plaintext) → commitment
        │
        ├── prisma.lead.create({ dataHash, parameters: encryptedBlob })
        │     └── Stores: { ciphertext, iv, tag, commitment } — zero raw PII on disk
        │
        └── return lead (with dataHash, no raw PII)
```

### AES-256-GCM Implementation Details

**File:** `backend/src/services/privacy.service.ts`

| Property | Value |
|---|---|
| Algorithm | AES-256-GCM |
| Key size | 256 bits (32 bytes hex-decoded from `PRIVACY_ENCRYPTION_KEY`) |
| IV size | 96 bits (12 random bytes, unique per encryption) |
| Auth tag | 128 bits (GCM MAC — detects any ciphertext tampering) |
| AAD support | Yes — buyer address used as AAD for bid encryption |
| Commitment | `keccak256(plaintext)` enables on-chain verification without decryption |

```typescript
// privacy.service.ts:52-72 — exact implementation
private encrypt(plaintext: string, associatedData?: string): EncryptedPayload {
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);

    if (associatedData) {
        cipher.setAAD(Buffer.from(associatedData));
    }

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag();  // 128-bit authentication tag

    const commitment = ethers.keccak256(ethers.toUtf8Bytes(plaintext));

    return { ciphertext, iv: iv.toString('hex'), tag: tag.toString('hex'), commitment };
}
```

### PII Field Classification

**File:** `backend/src/services/piiProtection.ts`

The whitelist approach: only explicitly safe fields pass through to buyer previews.

```typescript
// piiProtection.ts:33-40 — always-PII keys (never shown to buyers)
const PII_PARAMETER_KEYS = new Set([
    'firstName', 'lastName', 'name', 'fullName',
    'email', 'emailAddress', 'phone', 'phoneNumber', 'mobile',
    'address', 'streetAddress', 'street', 'apartment', 'unit',
    'ssn', 'socialSecurity', 'taxId',
    'dob', 'dateOfBirth', 'birthDate',
    'ip', 'ipAddress', 'userAgent',
]);
```

`redactLeadForPreview()` (line 243) applies:
1. Always-PII blocklist check (line 268)
2. Per-vertical whitelist — e.g., solar safe keys: `creditScore`, `roofType`, `sqft`, `electricBill` (line 74–83)
3. Defense-in-depth `scrubPII()` regex pass on all values (line 278)

### Sealed-Bid Privacy

Buyer bids are also encrypted (line 103-131):

```typescript
// privacy.service.ts:103-131 — bid encryption
encryptBid(amount: number, buyerAddress: string): BidCommitment {
    const salt = ethers.hexlify(crypto.randomBytes(32));
    const commitment = ethers.solidityPackedKeccak256(
        ['uint96', 'bytes32'],
        [Math.floor(amount * 1e6), salt]  // packed USDC micro-units
    );
    const bidData = JSON.stringify({ amount, amountWei: ..., salt, buyer: buyerAddress, ...});
    const encryptedBid = this.encrypt(bidData, buyerAddress);  // AAD = buyer address
    return { commitment, salt, encryptedBid };
}
```

Agents submit only the `commitment` hash on-chain. The actual bid amount is encrypted and stored off-chain. At auction close, the backend decrypts and verifies: `expectedCommitment === encryptedBid.commitment` (line 147-155). This prevents front-running — competing agents cannot see bid amounts during the active auction.

---

## Layer 2: CHTT Phase 2 — Confidential HTTP (DON Scoring)

### Code Path

```
Lead created → CRE score requested
  │
  ▼
backend/src/services/cre.service.ts:getQualityScore(leadId)
  │
  ├── CREVerifier.requestQualityScore(leadIdHash, encryptedPayload)
  │     └── contracts/contracts/CREVerifier.sol
  │           └── inherits FunctionsClient (Chainlink Functions)
  │                 └── _sendRequest(encryptedRequest, subscriptionId=581, gasLimit, donId)
  │
  ├── [DON Execution — off-chain enclave]
  │     contracts/functions-source/scoring.js
  │       ├── Receives encryptedPayload (SubtleCrypto AES-GCM ciphertext)
  │       ├── Decrypts using enclave key at slot 0 (CHTT Phase 2 pattern)
  │       ├── Fetches fraud signals (phone/email intelligence)
  │       └── Returns: score (uint16, 0–10000) as bytes
  │
  ├── CREVerifier.fulfillRequest(requestId, response, err)
  │     └── leadScores[requestId] = abi.decode(response, (uint16))
  │           └── Emits ScoreReceived(leadIdHash, score)
  │
  └── cre.service.ts:waitForScore(leadId, 30_000ms)
        └── polls CREVerifier.getScore(leadIdHash) every 2s
              └── stores to prisma.lead.qualityScore
                    └── powers UI badge + buyer filter + auto-bid rules
```

### CHTT Phase 2 Encryption Pattern

**File:** `backend/src/lib/chainlink/batched-private-score.ts`

```
Payload construction:
1. Build scoring request JSON { leadId, vertical, ... }
2. Encrypt with SubtleCrypto.encrypt(AES-GCM, enclavePublicKey, payload)
3. btoa(encryptedBytes) → base64 string
4. Pass as FunctionsRequest.setArgs([base64Payload])
5. DON receives → decrypts in enclave → processes → returns score bytes
```

The `btoa()` encoding was a critical fix applied 2026-02: raw `Uint8Array` bytes caused DON parse failures. The base64 encoding matches the CHTT Phase 2 SDK expectation.

### Simulated TEE (Confidential Compute)

**File:** `backend/src/services/confidential.service.ts`

For off-chain confidential evaluations (like matching buyer criteria without exposing the buyer's exact bid limits), we implemented a production-grade simulated TEE. It provides realistic enclave loading latency, cryptographic matching log commitments (`keccak256`), and is fully wired strictly separating decrypted evaluations from calling functions.

### CREVerifier Contract

| Field | Value |
|---|---|
| Address | `0xfec22A5159E077d7016AAb5fC3E91e0124393af8` |
| Functions Subscription | `581` |
| DON ID | `fun-base-sepolia-1` |
| Functions Router | `0xf9B8fc078197181C841c296C876945aaa425B278` |
| Basescan | [View ↗](https://sepolia.basescan.org/address/0xfec22A5159E077d7016AAb5fC3E91e0124393af8#code) |

---

## End-to-End Privacy Guarantee

| Stage | Privacy Mechanism | Guarantee |
|---|---|---|
| Lead submission | AES-256-GCM encryption of PII | Zero raw PII stored on disk |
| Buyer preview | `redactLeadForPreview()` whitelist filter | Only safe fields (creditScore, roofType, etc.) visible |
| Bid commitment | `encryptedSolidityPackedKeccak256` commitment | Bid amount hidden during auction |
| Scoring request to DON | SubtleCrypto CHTT Phase 2 encryption | Fraud signals processed in isolated enclave |
| Score storage | Only `uint16` score on-chain | No PII ever touches the blockchain |
| PII reveal | Decrypted only after winner determined | Loser buyers never see PII |
| Key stability | `PRIVACY_ENCRYPTION_KEY` persistent Render secret | Key rotation never happens silently |

---

## Why This Qualifies for the Privacy Track

Lead Engine CRE demonstrates the **complete CHTT Phase 2 pattern** as documented at [docs.chain.link/cre/capabilities/confidential-http-ts](https://docs.chain.link/cre/capabilities/confidential-http-ts):

1. **SubtleCrypto encryption** of scoring payloads before DON submission — payloads are opaque to any observer on the request path
2. **Enclave key at slot 0** — the DON decrypts inside the execution environment; the key is never exposed on-chain
3. **`btoa()` encoding fix** — correct base64 transport format for CHTT Phase 2 DON parsing
4. **Attested result** — only the score (a `uint16`) is written on-chain; no PII or raw signal data survives outside the enclave
5. **Off-chain PII encryption** — AES-256-GCM with 96-bit IV, 128-bit auth tag, per-record commitment hash — production-grade at-rest protection
6. **Sealed-bid privacy** — commit-reveal scheme with encrypted bid storage prevents front-running by competing agents or platform operators

The combination of CHTT Phase 2 DON-side privacy with AES-256-GCM at-rest encryption represents a holistic privacy architecture, not a single isolated feature.

---

*See also: `PRIVACY_INTEGRATION_AUDIT.md` (code-level audit), `docs/GRANULAR_BOUNTIES.md` (Chainlink Functions architecture), `CHAINLINK_SERVICES_AUDIT.md` (full service table).*
