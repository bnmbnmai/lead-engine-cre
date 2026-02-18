// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CustomLeadFeed
 * @author Lead Engine CRE
 * @notice On-chain consumer for aggregated Lead Engine platform metrics.
 *         Designed as a custom data feed following the Chainlink CRE
 *         custom-data-feed template pattern.
 *
 * @dev Architecture:
 *   CRE Cron  →  HTTP fetch /api/metrics  →  ABI-encode  →  updateMetrics()
 *
 * Other dApps can consume these metrics:
 *   - DeFi protocols → totalVolumeSettledUSD as TVL proof for credit scoring
 *   - Insurance → auctionFillRate as demand signal for lead pricing models
 *   - Analytics dashboards → all 4 metrics for Lead Engine market health
 *
 * Privacy: Only aggregated, anonymized metrics are stored on-chain.
 *          No PII, no individual lead data, no wallet addresses.
 *
 * Gas: ~40K gas per updateMetrics() call (4 storage writes).
 *      At daily cadence on Base, cost is < $0.01/day.
 *
 * @custom:security-contact security@leadengine.io
 *
 * Reference: https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/custom-data-feed
 */
contract CustomLeadFeed is Ownable {
    // ============================================
    // State Variables
    // ============================================

    /// @notice Average lead quality score across all verified leads (0–10000 scale)
    uint256 public averageQualityScore;

    /// @notice Total USDC volume settled through the platform (in cents to avoid decimals)
    uint256 public totalVolumeSettledUSD;

    /// @notice Total number of leads tokenized as ERC-721 NFTs
    uint256 public totalLeadsTokenized;

    /// @notice Auction fill rate — percentage of auctions resulting in a sale (basis points 0–10000)
    uint256 public auctionFillRate;

    /// @notice Timestamp of the last metric update
    uint256 public lastUpdatedAt;

    /// @notice Maximum acceptable staleness before consumers should consider data stale (seconds)
    uint256 public maxStalenessSeconds;

    /// @notice Address authorized to push metric updates (CRE cron address or owner)
    address public updater;

    // ============================================
    // Events
    // ============================================

    event MetricsUpdated(
        uint256 averageQualityScore,
        uint256 totalVolumeSettledUSD,
        uint256 totalLeadsTokenized,
        uint256 auctionFillRate,
        uint256 timestamp
    );

    event UpdaterChanged(address indexed oldUpdater, address indexed newUpdater);
    event StalenessConfigured(uint256 maxStalenessSeconds);

    // ============================================
    // Errors
    // ============================================

    error UnauthorizedUpdater();
    error InvalidQualityScore(uint256 score);
    error InvalidFillRate(uint256 rate);

    // ============================================
    // Modifiers
    // ============================================

    modifier onlyUpdater() {
        if (msg.sender != updater && msg.sender != owner()) {
            revert UnauthorizedUpdater();
        }
        _;
    }

    // ============================================
    // Constructor
    // ============================================

    /**
     * @param initialOwner Platform admin address
     * @param _maxStalenessSeconds Maximum seconds before data is considered stale (default: 86400 = 1 day)
     */
    constructor(
        address initialOwner,
        uint256 _maxStalenessSeconds
    ) Ownable(initialOwner) {
        updater = initialOwner; // Owner is initial updater; set CRE cron address later
        maxStalenessSeconds = _maxStalenessSeconds;
    }

    // ============================================
    // Write Functions
    // ============================================

    /**
     * @notice Update all platform metrics in a single call.
     * @dev Called by CRE cron workflow (daily) or manually by owner.
     *      Gas: ~40K (4 SSTORE + 1 timestamp write).
     *
     * @param _avgQualityScore Average quality score (0–10000)
     * @param _totalVolumeUSD Total USDC settled in cents
     * @param _totalTokenized Total leads minted as NFTs
     * @param _fillRate Auction fill rate in basis points (0–10000)
     */
    function updateMetrics(
        uint256 _avgQualityScore,
        uint256 _totalVolumeUSD,
        uint256 _totalTokenized,
        uint256 _fillRate
    ) external onlyUpdater {
        if (_avgQualityScore > 10000) revert InvalidQualityScore(_avgQualityScore);
        if (_fillRate > 10000) revert InvalidFillRate(_fillRate);

        averageQualityScore = _avgQualityScore;
        totalVolumeSettledUSD = _totalVolumeUSD;
        totalLeadsTokenized = _totalTokenized;
        auctionFillRate = _fillRate;
        lastUpdatedAt = block.timestamp;

        emit MetricsUpdated(
            _avgQualityScore,
            _totalVolumeUSD,
            _totalTokenized,
            _fillRate,
            block.timestamp
        );
    }

    // ============================================
    // View Functions — Chainlink latestAnswer() Style
    // ============================================

    /**
     * @notice Get the latest average quality score.
     * @return score Average quality score (0–10000)
     * @return updatedAt Timestamp of last update
     */
    function latestQualityScore() external view returns (uint256 score, uint256 updatedAt) {
        return (averageQualityScore, lastUpdatedAt);
    }

    /**
     * @notice Get the latest total volume settled.
     * @return volumeCents Total USDC settled in cents
     * @return updatedAt Timestamp of last update
     */
    function latestVolumeSettled() external view returns (uint256 volumeCents, uint256 updatedAt) {
        return (totalVolumeSettledUSD, lastUpdatedAt);
    }

    /**
     * @notice Get the latest total leads tokenized count.
     * @return count Total leads minted as ERC-721
     * @return updatedAt Timestamp of last update
     */
    function latestLeadsTokenized() external view returns (uint256 count, uint256 updatedAt) {
        return (totalLeadsTokenized, lastUpdatedAt);
    }

    /**
     * @notice Get the latest auction fill rate.
     * @return rateBps Fill rate in basis points (0–10000)
     * @return updatedAt Timestamp of last update
     */
    function latestFillRate() external view returns (uint256 rateBps, uint256 updatedAt) {
        return (auctionFillRate, lastUpdatedAt);
    }

    /**
     * @notice Get all metrics in a single call (gas-efficient for consumers).
     * @return avgScore Average quality score
     * @return volumeCents Total volume settled (cents)
     * @return tokenized Total leads tokenized
     * @return fillRateBps Auction fill rate (basis points)
     * @return updatedAt Last update timestamp
     * @return isStale Whether the data exceeds maxStalenessSeconds
     */
    function latestAnswer()
        external
        view
        returns (
            uint256 avgScore,
            uint256 volumeCents,
            uint256 tokenized,
            uint256 fillRateBps,
            uint256 updatedAt,
            bool isStale
        )
    {
        bool stale = lastUpdatedAt > 0
            ? (block.timestamp - lastUpdatedAt) > maxStalenessSeconds
            : true; // Never updated = stale

        return (
            averageQualityScore,
            totalVolumeSettledUSD,
            totalLeadsTokenized,
            auctionFillRate,
            lastUpdatedAt,
            stale
        );
    }

    // ============================================
    // Admin Functions
    // ============================================

    /**
     * @notice Set the authorized updater address (typically the CRE cron address).
     * @param _updater New updater address
     */
    function setUpdater(address _updater) external onlyOwner {
        require(_updater != address(0), "CustomLeadFeed: Zero updater");
        emit UpdaterChanged(updater, _updater);
        updater = _updater;
    }

    /**
     * @notice Configure the maximum staleness threshold.
     * @param _maxStalenessSeconds New staleness threshold in seconds
     */
    function setMaxStaleness(uint256 _maxStalenessSeconds) external onlyOwner {
        maxStalenessSeconds = _maxStalenessSeconds;
        emit StalenessConfigured(_maxStalenessSeconds);
    }
}
