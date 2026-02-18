// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IMarketplace.sol";
import "./interfaces/ILeadNFT.sol";
import "./interfaces/IACECompliance.sol";

/**
 * @title Marketplace
 * @dev RTB Marketplace for Lead Engine with commit-reveal bidding
 * @notice Handles listings, bids, auction resolution, and buyer filter toggles
 */
contract Marketplace is IMarketplace, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================
    // State Variables
    // ============================================
    
    ILeadNFT public leadNFT;
    IACECompliance public aceCompliance;
    IERC20 public paymentToken;          // USDC
    address public escrowContract;
    
    uint256 private _nextListingId;
    
    // Listing storage
    mapping(uint256 => Listing) private _listings;
    
    // Listing ID => Bidder => Bid
    mapping(uint256 => mapping(address => Bid)) private _bids;
    
    // Listing ID => array of bidder addresses (for enumeration)
    mapping(uint256 => address[]) private _listingBidders;
    
    // Buyer preferences
    mapping(address => BuyerPreferences) private _buyerPrefs;
    
    // Token ID => Listing ID (to check if already listed)
    mapping(uint256 => uint256) public tokenToListing;
    
    // Platform settings
    uint256 public minAuctionDuration = 1 hours;
    uint256 public maxAuctionDuration = 7 days;
    uint256 public minRevealWindow = 15 minutes;
    uint256 public bidDepositBps = 1000;  // 10% deposit required
    
    // ============================================
    // Events (additional to interface)
    // ============================================
    
    event SettingsUpdated(uint256 minDuration, uint256 maxDuration, uint256 revealWindow);

    // ============================================
    // Constructor
    // ============================================
    
    constructor(
        address _leadNFT,
        address _aceCompliance,
        address _paymentToken,
        address _escrow,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_leadNFT != address(0), "Invalid LeadNFT");
        require(_paymentToken != address(0), "Invalid payment token");
        
        leadNFT = ILeadNFT(_leadNFT);
        aceCompliance = IACECompliance(_aceCompliance);
        paymentToken = IERC20(_paymentToken);
        escrowContract = _escrow;
    }

    // ============================================
    // Admin Functions
    // ============================================
    
    function setContracts(
        address _leadNFT,
        address _aceCompliance,
        address _escrow
    ) external onlyOwner {
        if (_leadNFT != address(0)) leadNFT = ILeadNFT(_leadNFT);
        if (_aceCompliance != address(0)) aceCompliance = IACECompliance(_aceCompliance);
        if (_escrow != address(0)) escrowContract = _escrow;
    }
    
    function setAuctionSettings(
        uint256 _minDuration,
        uint256 _maxDuration,
        uint256 _revealWindow
    ) external onlyOwner {
        minAuctionDuration = _minDuration;
        maxAuctionDuration = _maxDuration;
        minRevealWindow = _revealWindow;
        emit SettingsUpdated(_minDuration, _maxDuration, _revealWindow);
    }

    // ============================================
    // Listing Functions
    // ============================================

    function createListing(
        uint256 leadTokenId,
        uint96 reservePrice,
        uint96 buyNowPrice,
        uint40 auctionDuration,
        uint40 revealWindow,
        bool acceptOffsite
    ) external nonReentrant returns (uint256 listingId) {
        // Validate ownership
        require(
            IERC721(address(leadNFT)).ownerOf(leadTokenId) == msg.sender,
            "Marketplace: Not owner"
        );
        require(tokenToListing[leadTokenId] == 0, "Marketplace: Already listed");
        require(
            auctionDuration >= minAuctionDuration && 
            auctionDuration <= maxAuctionDuration,
            "Marketplace: Invalid duration"
        );
        require(revealWindow >= minRevealWindow, "Marketplace: Reveal window too short");
        
        // Get lead metadata
        ILeadNFT.LeadMetadata memory leadMeta = leadNFT.getLead(leadTokenId);
        require(reservePrice >= leadMeta.reservePrice, "Marketplace: Below reserve");
        
        listingId = ++_nextListingId;
        uint40 auctionEnd = uint40(block.timestamp) + auctionDuration;
        
        _listings[listingId] = Listing({
            leadTokenId: leadTokenId,
            seller: msg.sender,
            reservePrice: reservePrice,
            buyNowPrice: buyNowPrice,
            auctionStart: uint40(block.timestamp),
            auctionEnd: auctionEnd,
            revealDeadline: auctionEnd + revealWindow,
            status: ListingStatus.ACTIVE,
            vertical: leadMeta.vertical,
            geoHash: leadMeta.geoHash,
            acceptOffsite: acceptOffsite
        });
        
        tokenToListing[leadTokenId] = listingId;
        
        // Transfer NFT to marketplace for escrow
        IERC721(address(leadNFT)).transferFrom(msg.sender, address(this), leadTokenId);
        
        emit ListingCreated(listingId, leadTokenId, msg.sender, reservePrice);
        
        return listingId;
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = _listings[listingId];
        require(listing.seller == msg.sender, "Marketplace: Not seller");
        require(listing.status == ListingStatus.ACTIVE, "Marketplace: Not active");
        require(_listingBidders[listingId].length == 0, "Marketplace: Has bids");
        
        listing.status = ListingStatus.CANCELLED;
        delete tokenToListing[listing.leadTokenId];
        
        // Return NFT
        IERC721(address(leadNFT)).transferFrom(
            address(this),
            msg.sender,
            listing.leadTokenId
        );
        
        emit ListingCancelled(listingId);
    }

    function buyNow(uint256 listingId) external nonReentrant {
        Listing storage listing = _listings[listingId];
        require(listing.status == ListingStatus.ACTIVE, "Marketplace: Not active");
        require(listing.buyNowPrice > 0, "Marketplace: Buy now disabled");
        require(block.timestamp < listing.auctionEnd, "Marketplace: Auction ended");
        
        // Check buyer can bid
        (bool canBid, string memory reason) = canBidOnListing(msg.sender, listingId);
        require(canBid, reason);
        
        listing.status = ListingStatus.SOLD;
        delete tokenToListing[listing.leadTokenId];
        
        // Transfer payment
        paymentToken.safeTransferFrom(msg.sender, escrowContract, listing.buyNowPrice);
        
        // Transfer NFT
        IERC721(address(leadNFT)).transferFrom(
            address(this),
            msg.sender,
            listing.leadTokenId
        );
        
        // Record sale
        leadNFT.recordSale(listing.leadTokenId, msg.sender, listing.buyNowPrice);
        
        emit BuyNowExecuted(listingId, msg.sender, listing.buyNowPrice);
    }

    // ============================================
    // Commit-Reveal Bidding
    // ============================================

    function commitBid(
        uint256 listingId,
        bytes32 commitment
    ) external nonReentrant {
        Listing storage listing = _listings[listingId];
        require(listing.status == ListingStatus.ACTIVE, "Marketplace: Not active");
        require(block.timestamp < listing.auctionEnd, "Marketplace: Bidding ended");
        require(_bids[listingId][msg.sender].commitment == bytes32(0), "Marketplace: Already bid");
        
        // Check buyer eligibility
        (bool canBid, string memory reason) = canBidOnListing(msg.sender, listingId);
        require(canBid, reason);
        
        // Require deposit for commitment
        uint256 deposit = (uint256(listing.reservePrice) * bidDepositBps) / 10000;
        paymentToken.safeTransferFrom(msg.sender, address(this), deposit);
        
        _bids[listingId][msg.sender] = Bid({
            bidder: msg.sender,
            amount: 0,              // Revealed later
            commitment: commitment,
            committedAt: uint40(block.timestamp),
            revealedAt: 0,
            status: BidStatus.PENDING
        });
        
        _listingBidders[listingId].push(msg.sender);
        
        emit BidCommitted(listingId, msg.sender, commitment);
    }

    function revealBid(
        uint256 listingId,
        uint96 amount,
        bytes32 salt
    ) external nonReentrant {
        Listing storage listing = _listings[listingId];
        require(
            block.timestamp >= listing.auctionEnd && 
            block.timestamp < listing.revealDeadline,
            "Marketplace: Not reveal phase"
        );
        
        Bid storage bid = _bids[listingId][msg.sender];
        require(bid.commitment != bytes32(0), "Marketplace: No commitment");
        require(bid.status == BidStatus.PENDING, "Marketplace: Already revealed");
        
        // Verify commitment
        bytes32 expectedCommitment = keccak256(abi.encodePacked(amount, salt));
        require(bid.commitment == expectedCommitment, "Marketplace: Invalid reveal");
        require(amount >= listing.reservePrice, "Marketplace: Below reserve");
        
        bid.amount = amount;
        bid.revealedAt = uint40(block.timestamp);
        bid.status = BidStatus.REVEALED;
        
        emit BidRevealed(listingId, msg.sender, amount);
    }

    function withdrawBid(uint256 listingId) external nonReentrant {
        Listing storage listing = _listings[listingId];
        Bid storage bid = _bids[listingId][msg.sender];
        
        require(bid.bidder == msg.sender, "Marketplace: Not bidder");
        require(
            bid.status == BidStatus.REJECTED || 
            (bid.status == BidStatus.PENDING && block.timestamp > listing.revealDeadline),
            "Marketplace: Cannot withdraw"
        );
        
        bid.status = BidStatus.REFUNDED;
        
        // Return deposit
        uint256 deposit = (uint256(listing.reservePrice) * bidDepositBps) / 10000;
        paymentToken.safeTransfer(msg.sender, deposit);
    }

    // ============================================
    // Auction Resolution
    // ============================================

    function resolveAuction(uint256 listingId) external nonReentrant returns (address winner, uint96 amount) {
        Listing storage listing = _listings[listingId];
        require(listing.status == ListingStatus.ACTIVE, "Marketplace: Not active");
        require(block.timestamp >= listing.revealDeadline, "Marketplace: Reveal not ended");
        
        // Find highest valid bid
        address[] storage bidders = _listingBidders[listingId];
        uint96 highestBid = 0;
        address highestBidder = address(0);
        
        for (uint256 i = 0; i < bidders.length; i++) {
            Bid storage bid = _bids[listingId][bidders[i]];
            if (bid.status == BidStatus.REVEALED && bid.amount > highestBid) {
                highestBid = bid.amount;
                highestBidder = bid.bidder;
            }
        }
        
        if (highestBidder == address(0)) {
            // No valid bids - return NFT to seller
            listing.status = ListingStatus.EXPIRED;
            delete tokenToListing[listing.leadTokenId];
            IERC721(address(leadNFT)).transferFrom(
                address(this),
                listing.seller,
                listing.leadTokenId
            );
            return (address(0), 0);
        }
        
        // Process winning bid
        listing.status = ListingStatus.SOLD;
        delete tokenToListing[listing.leadTokenId];
        
        Bid storage winningBid = _bids[listingId][highestBidder];
        winningBid.status = BidStatus.ACCEPTED;
        
        // Return deposit and collect full payment
        uint256 deposit = (uint256(listing.reservePrice) * bidDepositBps) / 10000;
        // Safe: highestBid >= reservePrice (enforced in revealBid), deposit = reservePrice * 10%
        uint256 remaining = highestBid - deposit;
        paymentToken.safeTransferFrom(highestBidder, escrowContract, remaining);
        paymentToken.safeTransfer(escrowContract, deposit);  // Send held deposit to escrow
        
        // Transfer NFT to winner
        IERC721(address(leadNFT)).transferFrom(
            address(this),
            highestBidder,
            listing.leadTokenId
        );
        
        // Record sale
        leadNFT.recordSale(listing.leadTokenId, highestBidder, highestBid);
        
        // Mark other bids as rejected (they can withdraw deposits)
        for (uint256 i = 0; i < bidders.length; i++) {
            Bid storage bid = _bids[listingId][bidders[i]];
            if (bid.status == BidStatus.REVEALED && bidders[i] != highestBidder) {
                bid.status = BidStatus.REJECTED;
            }
        }
        
        emit AuctionResolved(listingId, highestBidder, highestBid);
        
        return (highestBidder, highestBid);
    }

    // ============================================
    // Buyer Preferences
    // ============================================

    function setBuyerPreferences(BuyerPreferences calldata prefs) external {
        _buyerPrefs[msg.sender] = prefs;
    }
    
    function getBuyerPreferences(address buyer) external view returns (BuyerPreferences memory) {
        return _buyerPrefs[buyer];
    }

    // ============================================
    // Eligibility Checks
    // ============================================

    function canBidOnListing(address buyer, uint256 listingId) public view returns (bool, string memory) {
        Listing storage listing = _listings[listingId];
        BuyerPreferences storage prefs = _buyerPrefs[buyer];
        ILeadNFT.LeadMetadata memory meta = leadNFT.getLead(listing.leadTokenId);
        
        // Check ACE compliance if available
        if (address(aceCompliance) != address(0)) {
            // Check if buyer requires verified leads
            if (prefs.requireVerified && !meta.isVerified) {
                return (false, "Lead not verified");
            }
            
            // Check compliance
            if (!aceCompliance.canTransact(buyer, listing.vertical, listing.geoHash)) {
                return (false, "Compliance check failed");
            }
        }
        
        // Check off-site toggle
        if (meta.source == ILeadNFT.LeadSource.OFFSITE && !prefs.acceptOffsite) {
            return (false, "Buyer rejects off-site leads");
        }
        
        // Check seller off-site acceptance
        if (meta.source == ILeadNFT.LeadSource.OFFSITE && !listing.acceptOffsite) {
            return (false, "Seller rejects off-site for this listing");
        }
        
        // Check vertical filter
        if (prefs.allowedVerticals.length > 0) {
            bool verticalAllowed = false;
            for (uint256 i = 0; i < prefs.allowedVerticals.length; i++) {
                if (prefs.allowedVerticals[i] == listing.vertical) {
                    verticalAllowed = true;
                    break;
                }
            }
            if (!verticalAllowed) return (false, "Vertical not allowed");
        }
        
        // Check geo filters
        for (uint256 i = 0; i < prefs.blockedGeos.length; i++) {
            if (prefs.blockedGeos[i] == listing.geoHash) {
                return (false, "Geo blocked");
            }
        }
        
        if (prefs.allowedGeos.length > 0) {
            bool geoAllowed = false;
            for (uint256 i = 0; i < prefs.allowedGeos.length; i++) {
                if (prefs.allowedGeos[i] == listing.geoHash) {
                    geoAllowed = true;
                    break;
                }
            }
            if (!geoAllowed) return (false, "Geo not in allowlist");
        }
        
        return (true, "");
    }

    // ============================================
    // View Functions
    // ============================================

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return _listings[listingId];
    }
    
    function getBid(uint256 listingId, address bidder) external view returns (Bid memory) {
        return _bids[listingId][bidder];
    }
    
    function getHighestBid(uint256 listingId) external view returns (address bidder, uint96 amount) {
        address[] storage bidders = _listingBidders[listingId];
        uint96 highest = 0;
        address highestBidder = address(0);
        
        for (uint256 i = 0; i < bidders.length; i++) {
            Bid storage bid = _bids[listingId][bidders[i]];
            if (bid.status == BidStatus.REVEALED && bid.amount > highest) {
                highest = bid.amount;
                highestBidder = bidders[i];
            }
        }
        
        return (highestBidder, highest);
    }
    
    function getListingBidders(uint256 listingId) external view returns (address[] memory) {
        return _listingBidders[listingId];
    }
    
    function getBidCount(uint256 listingId) external view returns (uint256) {
        return _listingBidders[listingId].length;
    }
}
