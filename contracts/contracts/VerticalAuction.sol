// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./interfaces/IVerticalNFT.sol";

/**
 * @title VerticalAuction
 * @dev Simple sealed-bid auction for VerticalNFT tokens
 * @notice Platform creates auctions for verticals it owns.
 *         Bidders compete during a time window. Highest bid wins.
 *         Settlement pays royalties via VerticalNFT.transferWithRoyalty.
 *
 * Auction lifecycle: CREATE → BID → SETTLE (or CANCEL if no bids)
 */
contract VerticalAuction is ReentrancyGuard {

    // ============================================
    // Structs
    // ============================================

    struct Auction {
        uint256 tokenId;
        address nftContract;      // VerticalNFT address
        address seller;           // NFT owner (platform)
        bytes32 slug;             // Vertical slug hash (for holder check)
        uint128 reservePrice;     // Minimum bid in wei
        uint40  startTime;
        uint40  endTime;
        uint40  prePingEnd;       // startTime + PRE_PING_SECONDS (holder-only window)
        address highBidder;
        uint128 highBid;          // Effective bid (after multiplier) for comparison
        uint128 highBidRaw;       // Actual ETH sent (used for settlement)
        bool    settled;
        bool    cancelled;
    }

    // ============================================
    // State
    // ============================================

    uint256 public nextAuctionId = 1;
    mapping(uint256 => Auction) public auctions;

    // Track pending withdrawals (pull pattern for losing bidders)
    mapping(address => uint256) public pendingWithdrawals;

    // Gas optimization: cache holder status per auction to avoid repeated cross-contract calls
    // auctionId => (bidder => isHolder)
    mapping(uint256 => mapping(address => bool)) private holderCache;
    mapping(uint256 => mapping(address => bool)) private holderCacheSet;

    // ─── Holder Priority Constants ────────────────
    /// @dev 1.2× multiplier expressed in basis points (1200 / 1000 = 1.2)
    uint256 public constant HOLDER_MULTIPLIER_BPS = 1200;
    /// @dev Denominator for multiplier math
    uint256 public constant MULTIPLIER_DENOM = 1000;
    /// @dev Pre-ping window in seconds — only holders can bid during this window
    uint40 public constant PRE_PING_SECONDS = 10;

    // ============================================
    // Events
    // ============================================

    event AuctionCreated(
        uint256 indexed auctionId,
        uint256 indexed tokenId,
        address seller,
        uint128 reservePrice,
        uint40 startTime,
        uint40 endTime
    );

    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint128 amount
    );

    event HolderBidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint128 rawBid,
        uint128 effectiveBid,
        uint256 multiplierBps
    );

    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed winner,
        uint128 amount,
        uint256 royaltyPaid
    );

    event AuctionCancelled(uint256 indexed auctionId);

    // ============================================
    // Create Auction
    // ============================================

    /**
     * @dev Create a new auction. Caller must own the NFT and have approved this contract.
     * @param nftContract The VerticalNFT contract address
     * @param tokenId The NFT token ID to auction
     * @param slug The vertical slug hash (for holder lookup)
     * @param reservePrice Minimum bid in wei
     * @param duration Auction duration in seconds
     */
    function createAuction(
        address nftContract,
        uint256 tokenId,
        bytes32 slug,
        uint128 reservePrice,
        uint40 duration
    ) external returns (uint256 auctionId) {
        require(nftContract != address(0), "Auction: Zero NFT contract");
        require(duration >= 60, "Auction: Duration too short"); // Min 1 minute
        require(duration <= 7 days, "Auction: Duration too long");

        // Caller must own the NFT
        require(
            IERC721(nftContract).ownerOf(tokenId) == msg.sender,
            "Auction: Not NFT owner"
        );

        // Contract must be approved to transfer
        require(
            IERC721(nftContract).isApprovedForAll(msg.sender, address(this)) ||
            IERC721(nftContract).getApproved(tokenId) == address(this),
            "Auction: Not approved"
        );

        auctionId = nextAuctionId++;
        uint40 start = uint40(block.timestamp);

        auctions[auctionId] = Auction({
            tokenId: tokenId,
            nftContract: nftContract,
            seller: msg.sender,
            slug: slug,
            reservePrice: reservePrice,
            startTime: start,
            endTime: start + duration,
            prePingEnd: start + PRE_PING_SECONDS,
            highBidder: address(0),
            highBid: 0,
            highBidRaw: 0,
            settled: false,
            cancelled: false
        });

        emit AuctionCreated(
            auctionId, tokenId, msg.sender,
            reservePrice, start,
            start + duration
        );
    }

    // ============================================
    // Place Bid
    // ============================================

    /**
     * @dev Place a bid on an active auction.
     *      During the pre-ping window (first PRE_PING_SECONDS), only holders can bid.
     *      Holder bids get a 1.2× effective weight for comparison (but settle at raw ETH).
     */
    function placeBid(uint256 auctionId) external payable nonReentrant {
        Auction storage a = auctions[auctionId];
        require(a.seller != address(0), "Auction: Does not exist");
        require(!a.settled && !a.cancelled, "Auction: Not active");
        require(block.timestamp >= a.startTime, "Auction: Not started");
        require(block.timestamp < a.endTime, "Auction: Ended");
        require(msg.sender != a.seller, "Auction: Seller cannot bid");

        // Check holder status — use cache if available (saves ~2,100 gas per repeat bid)
        bool bidderIsHolder;
        if (holderCacheSet[auctionId][msg.sender]) {
            bidderIsHolder = holderCache[auctionId][msg.sender];
        } else {
            bidderIsHolder = IVerticalNFT(a.nftContract).isHolder(msg.sender, a.slug);
            holderCache[auctionId][msg.sender] = bidderIsHolder;
            holderCacheSet[auctionId][msg.sender] = true;
        }

        // Pre-ping gate: only holders can bid before prePingEnd
        if (block.timestamp < a.prePingEnd) {
            require(bidderIsHolder, "Auction: Pre-ping window (holders only)");
        }

        // Calculate effective bid (holder gets 1.2× weight)
        uint128 effectiveBid = bidderIsHolder
            ? uint128((uint256(msg.value) * HOLDER_MULTIPLIER_BPS) / MULTIPLIER_DENOM)
            : uint128(msg.value);

        require(effectiveBid >= a.reservePrice, "Auction: Below reserve");
        require(effectiveBid > a.highBid, "Auction: Below current high bid");

        // Refund previous high bidder via pull pattern (use raw amount)
        if (a.highBidder != address(0)) {
            pendingWithdrawals[a.highBidder] += a.highBidRaw;
        }

        a.highBidder = msg.sender;
        a.highBid = effectiveBid;       // Effective (for comparison)
        a.highBidRaw = uint128(msg.value); // Actual ETH (for settlement)

        if (bidderIsHolder) {
            emit HolderBidPlaced(auctionId, msg.sender, uint128(msg.value), effectiveBid, HOLDER_MULTIPLIER_BPS);
        } else {
            emit BidPlaced(auctionId, msg.sender, uint128(msg.value));
        }
    }

    // ============================================
    // Settle Auction
    // ============================================

    /**
     * @dev Settle a completed auction. Transfers NFT and pays seller.
     *      Uses highBidRaw (actual ETH) for payment, not effectiveBid.
     */
    function settleAuction(uint256 auctionId) external nonReentrant {
        Auction storage a = auctions[auctionId];
        require(a.seller != address(0), "Auction: Does not exist");
        require(!a.settled && !a.cancelled, "Auction: Not active");
        require(block.timestamp >= a.endTime, "Auction: Not ended yet");
        require(a.highBidder != address(0), "Auction: No bids");

        // Cache in memory to avoid repeated SLOAD (~2,100 gas each)
        address highBidder = a.highBidder;
        uint128 paymentAmount = a.highBidRaw;
        address nftContract = a.nftContract;
        uint256 tokenId = a.tokenId;
        address seller = a.seller;
        uint128 highBid = a.highBid;

        a.settled = true;

        // Try calling transferWithRoyalty on the NFT contract
        (bool success, ) = nftContract.call{value: paymentAmount}(
            abi.encodeWithSignature(
                "transferWithRoyalty(uint256,address)",
                tokenId,
                highBidder
            )
        );

        uint256 royaltyPaid = 0;
        if (success) {
            royaltyPaid = (uint256(paymentAmount) * 200) / 10000;
        } else {
            // Fallback: simple transfer + send all funds to seller
            IERC721(nftContract).transferFrom(seller, highBidder, tokenId);
            (bool payOk, ) = seller.call{value: paymentAmount}("");
            require(payOk, "Auction: Payment failed");
        }

        emit AuctionSettled(auctionId, highBidder, highBid, royaltyPaid);
    }

    // ============================================
    // Cancel Auction
    // ============================================

    /**
     * @dev Cancel an auction. Only possible if no bids have been placed.
     */
    function cancelAuction(uint256 auctionId) external {
        Auction storage a = auctions[auctionId];
        require(a.seller == msg.sender, "Auction: Not seller");
        require(!a.settled && !a.cancelled, "Auction: Not active");
        require(a.highBidder == address(0), "Auction: Has bids");

        a.cancelled = true;

        emit AuctionCancelled(auctionId);
    }

    // ============================================
    // Withdraw (Pull Pattern for Outbid Bidders)
    // ============================================

    /**
     * @dev Withdraw pending refund from being outbid
     */
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Auction: Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Auction: Withdraw failed");
    }

    // ============================================
    // View Functions
    // ============================================

    function getAuction(uint256 auctionId) external view returns (Auction memory) {
        require(auctions[auctionId].seller != address(0), "Auction: Does not exist");
        return auctions[auctionId];
    }

    function isAuctionActive(uint256 auctionId) external view returns (bool) {
        Auction storage a = auctions[auctionId];
        return a.seller != address(0) &&
               !a.settled &&
               !a.cancelled &&
               block.timestamp >= a.startTime &&
               block.timestamp < a.endTime;
    }

    /**
     * @dev Batch check holder status for multiple addresses (gas-free view).
     *      Useful for frontend pre-validation before placing bids.
     */
    function batchCheckHolders(
        uint256 auctionId,
        address[] calldata bidders
    ) external view returns (bool[] memory results) {
        Auction storage a = auctions[auctionId];
        require(a.seller != address(0), "Auction: Does not exist");
        results = new bool[](bidders.length);
        for (uint256 i = 0; i < bidders.length; i++) {
            if (holderCacheSet[auctionId][bidders[i]]) {
                results[i] = holderCache[auctionId][bidders[i]];
            } else {
                results[i] = IVerticalNFT(a.nftContract).isHolder(bidders[i], a.slug);
            }
        }
    }
}
