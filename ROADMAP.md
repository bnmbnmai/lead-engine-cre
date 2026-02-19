# High-Volume Scaling Considerations

The current architecture is designed for demo and early-production traffic. Scaling to 10,000+ leads per day across 50+ verticals requires the following infrastructure changes:

**Cursor-Based Pagination & Read Replicas.** The current offset-based pagination degrades at depth. Replace with cursor-based pagination on `(createdAt, id)` composite indexes. At 10k+ daily writes, introduce a PostgreSQL read replica behind PgBouncer for all marketplace list queries (`GET /leads`, `/asks`, `/buyNow`) to keep write latency unaffected by read load.

**Async Job Queue.** Lead ingestion, CRE quality scoring, NFT minting, escrow settlement, and bounty matching currently execute synchronously in Express request handlers. At volume, each becomes an independent BullMQ worker with per-job retry (3× exponential backoff), dead-letter queues, and per-vertical concurrency limits. This decouples API response time from on-chain transaction latency.

**Batch Minting & Gas Pooling.** Individual NFT mints (~80k gas each) are cost-prohibitive at scale. Aggregate pending mints into batches of 20–50 per transaction via a multicall wrapper on `LeadNFTv2.sol`. Maintain a nonce-managed wallet pool (5–10 hot wallets) with real-time gas price monitoring to prevent transaction queuing under network congestion.

**WebSocket Sharding.** Socket.IO currently broadcasts all events to all connected clients. At thousands of concurrent connections, partition clients into per-vertical rooms and use the Redis adapter for multi-process fan-out. Target: ≤50ms p95 event delivery latency across 5,000+ concurrent WebSocket connections.

**Rate Limiting & Ingestion Throttling.** Replace the per-instance Express rate limiter with a Redis-backed sliding window (`rate-limiter-flexible`) for horizontal scaling. Enforce per-seller, per-vertical ingestion caps (configurable, default 500 leads/day/vertical) to prevent hot-vertical floods from degrading marketplace quality.

**Observability & Alerting.** Add correlation IDs spanning HTTP → WebSocket → on-chain flows. Track auction-close latency (p50/p95/p99), CRE scoring round-trip, escrow funding time, and NFT mint confirmation time as Prometheus metrics. Alert on fill-rate drops >10% and CRE scoring failures.

---

## Enterprise Features (Post-Hackathon)

**Enterprise Branded Verticals.** White-label verticals for large buyers and sellers — custom branding, dedicated lead pools, priority CRE scoring, and isolated auction rooms. VerticalNFT owners can configure branded landing pages, custom form fields, and exclusive buyer access lists. Revenue-share royalties (2%) flow automatically via the deployed VerticalNFT contracts.

**Automatic Lead Requalification.** When a lead goes unsold at auction but a buyer later configures an autobid that matches the lead's vertical, geo, and field criteria — and bids at or above the reserve price — the system automatically sends an SMS to the original lead asking if they are still interested in connecting with a service provider. If the lead replies "Yes," it is re-listed into a new auction where the matching autobidder's bid is placed automatically, resulting in a sale. This closes the loop between buyer demand and unsold inventory without any manual intervention from the seller.

**Secondary LeadNFT Marketplace.** After a buyer purchases a lead and mints an ERC-721 LeadNFT, they can re-list it on a secondary marketplace for resale to other buyers. Royalties (configurable, default 2%) flow back to the original seller on every secondary transfer. This creates a liquid aftermarket for high-intent leads — buyers who can't service a lead in a particular geo or vertical can recoup their cost, while the original seller earns passive royalty income.

**Dispute & Arbitration Flow.** If a buyer claims a purchased lead was fake, stale, or misrepresented, they can open a dispute within a configurable window (e.g., 48 hours). Disputes are resolved via a multi-stage flow: automated CRE re-scoring → seller response period → oracle-backed or DAO arbitration panel. Outcomes include full refund (escrow clawed back), partial refund, or dispute dismissed. On-chain dispute records are linked to the LeadNFT for transparency and seller reputation scoring.

**Analytics Dashboard.** Per-vertical and per-seller analytics including conversion rates (lead → auction → sale), average sale price, fill rate, ROI per vertical, buyer acquisition cost, and CRE quality score distributions. Time-series charts for volume trends, bounty pool utilization, and autobid demand signals. Exportable reports for sellers to optimize their lead generation strategy and for buyers to evaluate vertical performance.

**Fiat On-Ramp for Non-Crypto Buyers.** Integrate Stripe or Circle to allow buyers to deposit fiat (USD) and receive USDC in their platform wallet automatically. Abstract wallet creation behind email/password auth with an embedded custodial wallet (e.g., Privy or Coinbase Smart Wallet) so non-crypto-native buyers can bid, purchase, and settle without ever touching MetaMask or managing private keys. Progressive disclosure: power users can connect their own wallet at any time.

**Ad Platform Integration.** Connect Google Ads, Facebook Ads, and other lead sources so that inbound leads from ad campaigns are automatically submitted to Lead Engine via webhook or pixel-fired API calls. Sellers configure per-campaign vertical mapping, field normalization rules, and quality floor thresholds. Leads that pass CRE scoring enter the marketplace instantly, closing the loop from ad spend → tokenized lead → auction → settlement in a single automated pipeline.
