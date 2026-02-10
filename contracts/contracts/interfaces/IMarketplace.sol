// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IMarketplace
 * @dev Interface for Lead Engine RTB Marketplace
 */
interface IMarketplace {
    // Enums
    enum ListingStatus { ACTIVE, IN_AUCTION, SOLD, CANCELLED, EXPIRED }
    enum BidStatus { PENDING, REVEALED, ACCEPTED, REJECTED, REFUNDED }

    // Structs - gas optimized
    struct Listing {
        uint256 leadTokenId;
        address seller;
        uint96 reservePrice;         // Min bid
        uint96 buyNowPrice;          // Instant purchase (0 = disabled)
        uint40 auctionStart;
        uint40 auctionEnd;
        uint40 revealDeadline;       // For commit-reveal
        ListingStatus status;
        bytes32 vertical;
        bytes32 geoHash;
        bool acceptOffsite;          // Seller toggle
    }

    struct Bid {
        address bidder;
        uint96 amount;               // Revealed amount (0 until revealed)
        bytes32 commitment;          // Hash of (amount, salt)
        uint40 committedAt;
        uint40 revealedAt;
        BidStatus status;
    }

    struct BuyerPreferences {
        bytes32[] allowedVerticals;
        bytes32[] allowedGeos;
        bytes32[] blockedGeos;
        uint96 maxBidAmount;
        bool acceptOffsite;          // Buyer toggle
        bool requireVerified;        // Require ACE-verified leads
    }

    // Events
    event ListingCreated(
        uint256 indexed listingId,
        uint256 indexed leadTokenId,
        address indexed seller,
        uint96 reservePrice
    );

    event BidCommitted(
        uint256 indexed listingId,
        address indexed bidder,
        bytes32 commitment
    );

    event BidRevealed(
        uint256 indexed listingId,
        address indexed bidder,
        uint96 amount
    );

    event AuctionResolved(
        uint256 indexed listingId,
        address indexed winner,
        uint96 winningBid
    );

    event ListingCancelled(uint256 indexed listingId);
    event BuyNowExecuted(uint256 indexed listingId, address indexed buyer, uint96 price);

    // Listing Functions
    function createListing(
        uint256 leadTokenId,
        uint96 reservePrice,
        uint96 buyNowPrice,
        uint40 auctionDuration,
        uint40 revealWindow,
        bool acceptOffsite
    ) external returns (uint256 listingId);

    function cancelListing(uint256 listingId) external;
    function buyNow(uint256 listingId) external;

    // Bidding Functions (Commit-Reveal)
    function commitBid(
        uint256 listingId,
        bytes32 commitment
    ) external;

    function revealBid(
        uint256 listingId,
        uint96 amount,
        bytes32 salt
    ) external;

    function withdrawBid(uint256 listingId) external;

    // Resolution
    function resolveAuction(uint256 listingId) external returns (address winner, uint96 amount);

    // Buyer Preferences
    function setBuyerPreferences(BuyerPreferences calldata prefs) external;
    function getBuyerPreferences(address buyer) external view returns (BuyerPreferences memory);

    // View Functions
    function getListing(uint256 listingId) external view returns (Listing memory);
    function getBid(uint256 listingId, address bidder) external view returns (Bid memory);
    function getHighestBid(uint256 listingId) external view returns (address bidder, uint96 amount);
    function canBidOnListing(address buyer, uint256 listingId) external view returns (bool, string memory);
}
