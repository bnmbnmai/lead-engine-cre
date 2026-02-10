# Submission Form — Lead Engine CRE

**Deadline:** March 1, 2026

---

## Project Info

| Field | Value |
|-------|-------|
| **Project Name** | Lead Engine CRE |
| **Category** | Chainlink CRE + ACE |
| **Theme** | Convergence — Bridging traditional lead generation with decentralized trust infrastructure |
| **Team** | [Your name / team info] |

---

## Description (for submission form)

> Decentralized real-time bidding platform for the $100B+ global lead marketplace. Lead Engine brings web3 trust, privacy, and compliance to traditional lead generation using **5 Chainlink services** as its trust layer:
>
> - **CRE (Custom Functions)** — On-chain lead verification, quality scoring (0–10,000), geo-parameter matching, fraud detection via `CREVerifier.sol`
> - **ACE (Compliance Engine)** — Automated KYC, state-level jurisdiction enforcement, cross-border compliance matrix, on-chain reputation via `ACECompliance.sol`
> - **DECO** *(stub-ready)* — Privacy-preserving attestation with production fallback; activates when access granted
> - **Data Streams** *(stub-ready)* — Real-time bid floor pricing for 10 verticals × 15+ countries
> - **Confidential Compute** *(stub-ready)* — TEE-based lead scoring preserving buyer/seller privacy
>
> **Key innovations:**
> - **Autonomous Bidding** — 9-criteria auto-bid engine + MCP agent server with 8 JSON-RPC tools + full LangChain autonomous bidding agent
> - **CRM Pipeline** — HubSpot and Zapier webhook integrations with format-specific payload transforms
> - **Privacy-Preserving Auctions** — AES-256-GCM encrypted bids with commit-reveal and ZK fraud detection
> - **Lead NFTs** — ERC-721 tokenized leads with on-chain provenance and quality scores
> - **Cross-Border Compliance** — State-pair restriction matrix for mortgage, insurance, with automatic jurisdiction enforcement
>
> 10 verticals • 15+ countries • 151 tests • 500+ testnet txs • 1,500 peak concurrent users validated

---

## Links

| Field | URL |
|-------|-----|
| **GitHub** | `https://github.com/bnmbnmai/lead-engine-cre` |
| **Demo Video** | `[Loom link — record per docs/DEMO_SCRIPT.md]` |
| **Live Frontend** | `https://lead-engine-cre.vercel.app` |
| **Live Backend** | `https://lead-engine-cre-api.onrender.com` |
| **Swagger Docs** | `https://lead-engine-cre-api.onrender.com/api/swagger` |
| **Pitch Deck** | `[Google Slides / PDF link]` |

---

## Contract Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| CREVerifier | `[deployed address]` |
| ACECompliance | `[deployed address]` |
| LeadNFTv2 | `[deployed address]` |
| RTBEscrow | `[deployed address]` |
| Marketplace | `[deployed address]` |

---

## Why We Deserve to Win

### Chainlink Depth
- **5 Chainlink services** integrated (CRE + ACE live, DECO + Data Streams + Confidential Compute stub-ready)
- CRE drives core value: on-chain lead verification is the trust primitive the industry needs
- ACE automates compliance at scale — zero manual KYC review across 15+ jurisdictions
- Stub architecture is production-ready: `isStub: true` → flip to live with API key only

### Convergence Theme
- Traditional lead generation ($100B+ market) meets decentralized infrastructure
- Sellers get **verifiable quality scores** instead of opaque broker ratings
- Buyers get **privacy-preserving auctions** instead of leaked bid data
- Both sides get **automated compliance** instead of per-state legal review
- MCP agent server bridges **AI automation** with **on-chain settlement**

### Production Readiness
- 151 tests: unit, integration, E2E, security, compliance, load
- 500+ testnet transactions across 10 HD wallets
- 1,500 peak concurrent users validated
- Live deployments: Render backend, Vercel frontend, Sepolia contracts
- Autonomous bidding pipeline: Rules → Auto-bid → CRM webhook → Settlement

---

## Demo Tools & Recording Tips

| Tool | Use For |
|------|---------|
| **Loom** (free) | Screen + mic recording, unlisted link, built-in editing |
| **OBS Studio** | Alternative recorder with more control |
| **ScreenPal** | Quick clips for backup segments |
| **Sepolia Explorer** | Pre-open contract tx pages as fallback visuals |

**Tips:**
- Pre-type all terminal commands (see `docs/VIDEO_OUTLINE.md`)
- Pre-record 5 backup segments before the full take
- Keep it under 4 minutes — judges have many submissions
- Lead with the "why" (opaque $100B market), not the "how"
- End with architecture diagram and repo link

---

## Polish Checklist

- [ ] All stubs return `isStub: true` with UI badge — activate when Chainlink access is granted
- [ ] Mock data seeded on live DB (`npm run db:seed` on Render)
- [ ] DECO stub: `deco.service.ts` → swap API key when access granted
- [ ] Data Streams stub: `datastreams.service.ts` → swap API key when access granted
- [ ] Confidential Compute stub: `confidential.service.ts` → swap API key when access granted
- [ ] All contract addresses documented in README + `.env`
- [ ] GitHub README renders Mermaid diagram correctly
- [ ] No `LICENSE` file in repo (proprietary)
- [ ] Swagger UI accessible at live URL
- [ ] WebSocket connection working (real-time bid updates)
- [ ] Auto-bid fires correctly in demo: `POST /api/v1/bids/auto-bid/evaluate`
- [ ] CRM webhooks register and fire: `POST /api/v1/crm/webhooks`
- [ ] MCP agent server responds: `curl localhost:3002/rpc -d '{"method":"tools/list"}'`
