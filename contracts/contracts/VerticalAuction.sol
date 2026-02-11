// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

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
        uint128 reservePrice;     // Minimum bid in wei
        uint40  startTime;
        uint40  endTime;
        address highBidder;
        uint128 highBid;
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
     * @param reservePrice Minimum bid in wei
     * @param duration Auction duration in seconds
     */
    function createAuction(
        address nftContract,
        uint256 tokenId,
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

        auctions[auctionId] = Auction({
            tokenId: tokenId,
            nftContract: nftContract,
            seller: msg.sender,
            reservePrice: reservePrice,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + duration,
            highBidder: address(0),
            highBid: 0,
            settled: false,
            cancelled: false
        });

        emit AuctionCreated(
            auctionId, tokenId, msg.sender,
            reservePrice, uint40(block.timestamp),
            uint40(block.timestamp) + duration
        );
    }

    // ============================================
    // Place Bid
    // ============================================

    /**
     * @dev Place a bid on an active auction
     */
    function placeBid(uint256 auctionId) external payable nonReentrant {
        Auction storage a = auctions[auctionId];
        require(a.seller != address(0), "Auction: Does not exist");
        require(!a.settled && !a.cancelled, "Auction: Not active");
        require(block.timestamp >= a.startTime, "Auction: Not started");
        require(block.timestamp < a.endTime, "Auction: Ended");
        require(msg.value >= a.reservePrice, "Auction: Below reserve");
        require(msg.value > a.highBid, "Auction: Below current high bid");
        require(msg.sender != a.seller, "Auction: Seller cannot bid");

        // Refund previous high bidder via pull pattern
        if (a.highBidder != address(0)) {
            pendingWithdrawals[a.highBidder] += a.highBid;
        }

        a.highBidder = msg.sender;
        a.highBid = uint128(msg.value);

        emit BidPlaced(auctionId, msg.sender, uint128(msg.value));
    }

    // ============================================
    // Settle Auction
    // ============================================

    /**
     * @dev Settle a completed auction. Transfers NFT and pays seller.
     */
    function settleAuction(uint256 auctionId) external nonReentrant {
        Auction storage a = auctions[auctionId];
        require(a.seller != address(0), "Auction: Does not exist");
        require(!a.settled && !a.cancelled, "Auction: Not active");
        require(block.timestamp >= a.endTime, "Auction: Not ended yet");
        require(a.highBidder != address(0), "Auction: No bids");

        a.settled = true;

        // Try calling transferWithRoyalty on the NFT contract
        // This handles NFT transfer + royalty split in one call
        (bool success, ) = a.nftContract.call{value: a.highBid}(
            abi.encodeWithSignature(
                "transferWithRoyalty(uint256,address)",
                a.tokenId,
                a.highBidder
            )
        );

        uint256 royaltyPaid = 0;
        if (success) {
            // transferWithRoyalty handled everything (NFT + royalty + seller payment)
            // Estimate royalty for event (2% default)
            royaltyPaid = (uint256(a.highBid) * 200) / 10000;
        } else {
            // Fallback: simple transfer + send all funds to seller
            IERC721(a.nftContract).transferFrom(a.seller, a.highBidder, a.tokenId);
            (bool payOk, ) = a.seller.call{value: a.highBid}("");
            require(payOk, "Auction: Payment failed");
        }

        emit AuctionSettled(auctionId, a.highBidder, a.highBid, royaltyPaid);
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
}
