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

/** Pre-ping window range (seconds) */
export const PRE_PING_MIN = parseInt(process.env.PRE_PING_MIN || '5', 10);
export const PRE_PING_MAX = parseInt(process.env.PRE_PING_MAX || '10', 10);

/** Grace period (ms) for pre-ping window (network latency tolerance) */
export const PRE_PING_GRACE_MS = parseInt(process.env.PRE_PING_GRACE_MS || '1500', 10);

/** Crypto nonce byte length for pre-ping randomization */
export const NONCE_BYTES = parseInt(process.env.NONCE_BYTES || '16', 10);

/** Holder score bonus in RTB match ranking */
export const HOLDER_SCORE_BONUS = parseInt(process.env.HOLDER_SCORE_BONUS || '2000', 10);

// ── Spam Prevention ──────────────────────────────

/** Max bids per wallet per minute */
export const SPAM_THRESHOLD_BIDS_PER_MINUTE = parseInt(
    process.env.SPAM_THRESHOLD_BIDS_PER_MINUTE || '5', 10
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

// ── Hierarchy ──────────────────────────────

/** Maximum vertical hierarchy depth (prevents infinite nesting) */
export const MAX_HIERARCHY_DEPTH = parseInt(process.env.MAX_HIERARCHY_DEPTH || '5', 10);

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
} as const;
