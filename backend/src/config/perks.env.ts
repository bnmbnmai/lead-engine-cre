/**
 * Centralized Perks & Notification Configuration
 *
 * Single source of truth for all tuning knobs across holder-perks,
 * notifications, rate limiting, and cache TTLs.
 *
 * All values read from env vars with sensible defaults.
 */

// ── Holder Perks ──────────────────────────────

/** Sealed-bid multiplier for NFT holders (1.2 = 20% boost) */
export const HOLDER_MULTIPLIER = parseFloat(process.env.HOLDER_MULTIPLIER || '1.2');

/** Pre-ping window for NFT holders (seconds) — fixed 12s head start */
export const PRE_PING_MIN = parseInt(process.env.PRE_PING_MIN || '12', 10);
export const PRE_PING_MAX = parseInt(process.env.PRE_PING_MAX || '12', 10);

/** Grace period (ms) for pre-ping window (network latency tolerance) */
export const PRE_PING_GRACE_MS = parseInt(process.env.PRE_PING_GRACE_MS || '1500', 10);

/** Crypto nonce byte length for pre-ping randomization */
export const NONCE_BYTES = parseInt(process.env.NONCE_BYTES || '16', 10);

/** Holder score bonus in RTB match ranking */
export const HOLDER_SCORE_BONUS = parseInt(process.env.HOLDER_SCORE_BONUS || '2000', 10);

// ── Spam Prevention ──────────────────────────────

/** Max bids per wallet per minute */
export const SPAM_THRESHOLD_BIDS_PER_MINUTE = parseInt(
    process.env.SPAM_THRESHOLD_BIDS_PER_MINUTE || '50', 10
);

// ── Notifications ──────────────────────────────

/** Digest flush interval (ms) — batches notifications */
export const DIGEST_INTERVAL_MS = parseInt(process.env.DIGEST_INTERVAL_MS || '300000', 10);

/** Max notifications per user per day */
export const DAILY_NOTIFICATION_CAP = parseInt(process.env.DAILY_NOTIFICATION_CAP || '50', 10);

/** Socket notify-optin debounce (ms) */
export const NOTIFY_DEBOUNCE_MS = parseInt(process.env.NOTIFY_DEBOUNCE_MS || '10000', 10);

// ── Cache TTLs ──────────────────────────────

/** NFT ownership cache TTL (ms) */
export const NFT_OWNERSHIP_TTL_MS = parseInt(process.env.NFT_OWNERSHIP_TTL_MS || '60000', 10);

/** Bid activity cache TTL (ms) */
export const BID_ACTIVITY_TTL_MS = parseInt(process.env.BID_ACTIVITY_TTL_MS || '60000', 10);

/** Holder notify opt-in cache TTL (ms) */
export const HOLDER_NOTIFY_TTL_MS = parseInt(process.env.HOLDER_NOTIFY_TTL_MS || '300000', 10);

// ── Rate Limiting ──────────────────────────────

/** RTB bidding rate limit (requests per minute) */
export const RTB_RATE_LIMIT_PER_MIN = parseInt(process.env.RTB_RATE_LIMIT_PER_MIN || '10', 10);

/** Tiered limiter hard ceiling (absolute max per minute) */
export const TIER_HARD_CEILING = parseInt(process.env.TIER_HARD_CEILING || '30', 10);

// ── IP Blocklist ──────────────────────────────

/** Maximum number of blocked IPs/subnets */
export const IP_BLOCKLIST_MAX_SIZE = parseInt(process.env.IP_BLOCKLIST_MAX_SIZE || '10000', 10);

// ── PII Audit ──────────────────────────────

/** Enable structured PII scrub audit logging (GDPR Article 30 compliance) */
export const PII_AUDIT_ENABLED = process.env.PII_AUDIT_ENABLED !== 'false';

// ── Auction Durations ──────────────────────────────

/** Lead auction duration (seconds) — single 60s sealed-bid auction */
export const LEAD_AUCTION_DURATION_SECS = parseInt(process.env.LEAD_AUCTION_DURATION_SECS || '60', 10);

/** Default vertical NFT auction duration (seconds) — 60s for hackathon */
export const NFT_AUCTION_DURATION_SECS = parseInt(process.env.NFT_AUCTION_DURATION_SECS || '60', 10);

/** Auto-extend increment (seconds) — added when late bids arrive on low-activity auctions */
export const AUTO_EXTEND_INCREMENT_SECS = parseInt(process.env.AUTO_EXTEND_INCREMENT_SECS || '60', 10);

/** Maximum number of auto-extensions per auction */
export const AUTO_EXTEND_MAX = parseInt(process.env.AUTO_EXTEND_MAX || '5', 10);

// ── Hierarchy ──────────────────────────────

/** Maximum vertical hierarchy depth (prevents infinite nesting) */
export const MAX_HIERARCHY_DEPTH = parseInt(process.env.MAX_HIERARCHY_DEPTH || '5', 10);

// ── Feature Flags ──────────────────────────────────────

/** Enable NFT features (minting, auctions, resale). Set to 'false' to run as pure lead exchange. */
export const NFT_FEATURES_ENABLED = process.env.NFT_FEATURES_ENABLED !== 'false';

// ── Demo Tuning Knobs ──────────────────────────────────

/** Average interval between dripped demo leads (ms). Randomized ±50% around this value. */
export const DEMO_LEAD_DRIP_INTERVAL_MS = parseInt(process.env.DEMO_LEAD_DRIP_INTERVAL_MS || '7500', 10);

/** Number of demo buyer wallets to use per run */
export const DEMO_NUM_BUYERS = parseInt(process.env.DEMO_NUM_BUYERS || '10', 10);

/** Minimum active (IN_AUCTION) demo leads before replenishment warning fires */
export const DEMO_MIN_ACTIVE_LEADS = parseInt(process.env.DEMO_MIN_ACTIVE_LEADS || '3', 10);

/** Number of leads seeded immediately at demo start */
export const DEMO_INITIAL_LEADS = parseInt(process.env.DEMO_INITIAL_LEADS || '0', 10);

// ── Aggregate export ──────────────────────────────

export const PERKS_CONFIG = {
    holder: {
        multiplier: HOLDER_MULTIPLIER,
        prePingMin: PRE_PING_MIN,
        prePingMax: PRE_PING_MAX,
        prePingGraceMs: PRE_PING_GRACE_MS,
        nonceBytes: NONCE_BYTES,
        scoreBonus: HOLDER_SCORE_BONUS,
    },
    spam: {
        bidsPerMinute: SPAM_THRESHOLD_BIDS_PER_MINUTE,
    },
    notifications: {
        digestIntervalMs: DIGEST_INTERVAL_MS,
        dailyCap: DAILY_NOTIFICATION_CAP,
        debounceMs: NOTIFY_DEBOUNCE_MS,
    },
    cache: {
        nftOwnershipTtlMs: NFT_OWNERSHIP_TTL_MS,
        bidActivityTtlMs: BID_ACTIVITY_TTL_MS,
        holderNotifyTtlMs: HOLDER_NOTIFY_TTL_MS,
    },
    rateLimit: {
        rtbPerMin: RTB_RATE_LIMIT_PER_MIN,
        hardCeiling: TIER_HARD_CEILING,
    },
    ipBlocklist: {
        maxSize: IP_BLOCKLIST_MAX_SIZE,
    },
    piiAudit: {
        enabled: PII_AUDIT_ENABLED,
    },
    hierarchy: {
        maxDepth: MAX_HIERARCHY_DEPTH,
    },
    auction: {
        leadDurationSecs: LEAD_AUCTION_DURATION_SECS,
        nftDurationSecs: NFT_AUCTION_DURATION_SECS,
        autoExtendIncrementSecs: AUTO_EXTEND_INCREMENT_SECS,
        autoExtendMax: AUTO_EXTEND_MAX,
    },
    nft: {
        enabled: NFT_FEATURES_ENABLED,
    },
    demo: {
        leadDripIntervalMs: DEMO_LEAD_DRIP_INTERVAL_MS,
        numBuyers: DEMO_NUM_BUYERS,
        minActiveLeads: DEMO_MIN_ACTIVE_LEADS,
        initialLeads: DEMO_INITIAL_LEADS,
    },
} as const;
