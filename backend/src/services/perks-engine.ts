/**
 * Perks Engine — Unified Facade
 *
 * Re-exports all holder-perks and notification functions through a single
 * import point. Reduces import scatter across the codebase.
 *
 * Usage: import { applyHolderPerks, queueNotification, PERKS_CONFIG } from './perks-engine';
 */

// ── Centralized Configuration ──────────────────
export { PERKS_CONFIG } from '../config/perks.env';

// ── Holder Perks ──────────────────────────────
export {
    // Types
    HolderPerks,
    PrePingStatus,
    // Constants
    PRE_PING_MIN,
    PRE_PING_MAX,
    HOLDER_MULTIPLIER,
    SPAM_THRESHOLD_BIDS_PER_MINUTE,
    HOLDER_SCORE_BONUS,
    DEFAULT_PERKS,
    PRE_PING_GRACE_MS,
    // Core functions
    applyHolderPerks,
    applyMultiplier,
    getEffectiveBid,
    isInPrePingWindow,
    isInPrePingWindowLegacy,
    checkActivityThreshold,
    computePrePing,
} from './holder-perks.service';

// ── Notifications ──────────────────────────────
export {
    // Types
    HolderNotification,
    // Functions
    setHolderNotifyOptIn,
    getHolderNotifyOptIn,
    findNotifiableHolders,
    buildHolderNotifications,
    // Batching
    queueNotification,
    flushNotificationDigest,
    hasGdprConsent,
    startDigestTimer,
    // Constants
    NOTIFICATION_CONSTANTS,
} from './notification.service';

// ── Convenience Types ──────────────────────────

/** Complete perk status for a user on a vertical */
export interface PerkStatus {
    perks: import('./holder-perks.service').HolderPerks;
    prePing: import('./holder-perks.service').PrePingStatus;
    notifyOptIn: boolean;
}
