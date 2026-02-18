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
