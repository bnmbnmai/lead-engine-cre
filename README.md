Lead Engine CRE: Decentralized Real-Time Lead Marketplace with Chainlink Integration
CI
Chainlink CRE
Chainlink ACE
Chainlink Automation
Chainlink Functions
On-Chain Vault
Chainlink Convergence 2026 Submission — Mandatory CRE + ACE Track. Tokenizing the $200B+ lead industry with verifiable quality, on-chain compliance, and automated settlements—powered by 8+ Chainlink services for fraud-proof, efficient RTB.
Recent Updates

Feb 18, 2026: On-chain personal escrow vaults with Chainlink PoR for verifiable reserves and Automation for auto-refunds/expirations. Pricing refined to 5% settlement cut + $1/action for competitive edge.

Overview
Lead Engine CRE revolutionizes lead generation: Sellers submit via AI-optimized CRO landers; Chainlink CRE zk-scores quality (0–10k); ACE auto-KYC gates access; buyers pre-fund on-chain vaults, bid sealed with MCP agents; 60s auctions settle in USDC with VRF ties and auto-refunds. Undercuts legacy platforms (5–7% fees vs 10–30%) with instant, verifiable payouts—driving explosive network effects.
Judges: Dive into our live demo for seeded leads, vault funding, autobids, and PoR checks. See how we flip industry pain with Chainlink depth.
Features

On-Chain Personal Escrow Vaults: Frictionless USDC pools for bids/bounties/autobids. Gas sponsored, $1/action fee, 5% settlement cut—auto-deduct/refund via Automation.
Verifiable Reserves (PoR): Chainlink Proof of Reserves attests solvency, with 24h automated verifications for unbreakable trust.
Sealed RTB Auctions: 60s timed, VRF fair ties, Data Feeds dynamic floors. Handles dotted sub-verticals (e.g., home_services.plumbing) with lazy ACE policies.
AI-Powered Autobidding: LangChain MCP agents (12 tools) execute field-level strategies from vaults.
Targeted Bounties: Fund vertical pools (e.g., $75 for solar in CA, credit>720)—Functions match, Automation expires unclaimed.
LeadNFT Assets: ERC-721 with 2% royalties, PII decryption only for winners.
Fraud Defenses: CRE zkProofs, DECO/Confidential HTTP stubs for advanced signals.
Demo Tools: Persona switches, data seeding, Chainlink Services Dev Log for real-time insights.

Explore docs/FEATURES.md for specs.
Architecture
Seller submits → CRE/ACE verify → Vault lock → Sealed bid/settle → Release/refund. Backend sponsors gas; on-chain core ensures trust.
Chainlink Spotlight
8 services orchestrate decentralization:

CRE: zkProof quality scoring.
ACE: Auto-KYC/policies.
Data Feeds: Floor pricing.
VRF v2.5: Tie resolution.
Functions: Bounty matching.
Automation: PoR checks, refund expirations.
PoR: Reserve proofs.
DECO/Confidential HTTP: Fraud stubs.

Service Integration Points

How a Lead Moves Through the System

Why We Win: Differentiators

































Legacy PainCRE SolutionHigh fees/chargebacks5–7% effective with auto-refundsFraud/opacityCRE zk-scores + PoR reservesSlow payoutsInstant USDC via vaultsManual checksACE auto-complianceNo automationAutomation for PoR/expirationsCentralized holdsOn-chain vaults, sponsored gas
Fraud Mitigation



































TypeDefenseImpactStuffingCRE zkProofs + limitsBlocks invalid leadsRecyclingLeadNFT timestampsEnsures uniquenessDisputesOn-chain settlementsNo chargebacksMismanagementPoR verificationsProves reservesExpirationsAutomation refundsClears stuck funds
Full matrix in docs/FRAUD.md (12+ types).
Pricing: Simple & Competitive
$1/action convenience fee (bids/bounties/autobids) + 5% settlement cut (wins/matches). Vault-automated for zero friction.









































ChannelConvenience FeePlatform CutEffectiveManual bid$1/bid5% on win5–6%Auto-bid$1/execution5% on win5–6%API/MCP$1/bid5% on win5–6%Buy It Now$15%6%Bounty Release$1/post5% on match5–6%
Fees cover sponsorship/ops, deducted from vault. Refunds fee-free.
Quick Start & Demo

Clone: git clone https://github.com/bnmbnmai/lead-engine-cre
Install: yarn
Env: Copy .env.example → .env, set keys (e.g., VAULT_ADDRESS_BASE_SEPOLIA, AUTOMATION_REGISTRY, POR_FEED_ADDRESS).
Backend: cd backend && prisma db push && yarn dev
Frontend: cd frontend && yarn dev
Agents: cd mcp-server && yarn dev (LLM key required)
Contracts: cd contracts && yarn deploy:base-sepolia

Demo Flow (Buyer Persona):

Fund vault ($100+ USDC).
Post bounty → Set autobid rules.
Place sealed bid on lead.
Win: Auto-settle (5% cut).
Check PoR status → Withdraw balance.

Live: https://lead-engine-cre-frontend.vercel.app
Deployment
Vercel (frontend) + Render (backend). Contracts on Base Sepolia.
Key env:

VAULT_ADDRESS_BASE_SEPOLIA
AUTOMATION_REGISTRY
POR_FEED_ADDRESS
USDC_CONTRACT_ADDRESS
PLATFORM_WALLET_ADDRESS

See .env.example. Run prisma db push post-schema changes.
ROADMAP

High: DECO/Confidential HTTP fraud signals; Cross-chain support.
Medium: Secondary NFT markets; Advanced PoR Feed audits.
Ready: On-Chain Vaults with PoR/Automation; Multi-language landers; NFT royalties (2%).

Details in ROADMAP.md