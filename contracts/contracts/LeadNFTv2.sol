// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ILeadNFT.sol";

/**
 * @title LeadNFTv2
 * @dev Gas-optimized ERC-721 for lead tokenization with enhanced metadata
 * @notice Supports marketplace integration, ACE verification, and ZK proofs
 */
contract LeadNFTv2 is ERC721, ERC721URIStorage, ERC721Burnable, Ownable, ReentrancyGuard, ILeadNFT {
    // ============================================
    // State Variables (Optimized Storage Layout)
    // ============================================
    
    uint256 private _nextTokenId;
    
    // Packed struct for gas optimization (fits in 3 storage slots)
    struct PackedLeadMetadata {
        // Slot 1: 256 bits
        bytes32 vertical;
        // Slot 2: 256 bits  
        bytes32 geoHash;
        // Slot 3: 256 bits
        bytes32 piiHash;
        // Slot 4: address (160) + uint96 (96) = 256 bits
        address seller;
        uint96 reservePrice;
        // Slot 5: address (160) + uint40 (40) + uint40 (40) = 240 bits
        address buyer;
        uint40 createdAt;
        uint40 expiresAt;
        // Slot 6: uint40 (40) + uint8 (8) + uint8 (8) + bool (8) + bool (8) + bool (8) = 80 bits
        uint40 soldAt;
        LeadSource source;
        LeadStatus status;
        bool isVerified;
        bool tcpaConsent;
    }
    
    // Token ID => Metadata
    mapping(uint256 => PackedLeadMetadata) private _leadMetadata;
    
    // Platform ID => Token ID (using bytes32 for gas efficiency)
    mapping(bytes32 => uint256) private _platformLeadToToken;
    
    // Authorized minters/operators
    mapping(address => bool) public authorizedMinters;
    
    // Marketplace contract address
    address public marketplace;
    
    // ============================================
    // Events
    // ============================================
    
    event MinterAuthorized(address indexed minter, bool authorized);
    event MarketplaceUpdated(address indexed oldMarketplace, address indexed newMarketplace);

    // ============================================
    // Constructor
    // ============================================
    
    constructor(address initialOwner) 
        ERC721("Lead Engine Lead v2", "LEADv2") 
        Ownable(initialOwner) 
    {}
    
    // ============================================
    // Modifiers
    // ============================================
    
    modifier onlyAuthorizedMinter() {
        require(
            authorizedMinters[msg.sender] || 
            msg.sender == owner() ||
            msg.sender == marketplace,
            "LeadNFTv2: Not authorized"
        );
        _;
    }
    
    modifier onlyMarketplace() {
        require(msg.sender == marketplace, "LeadNFTv2: Only marketplace");
        _;
    }

    // ============================================
    // Admin Functions
    // ============================================

    function setAuthorizedMinter(address minter, bool authorized) external onlyOwner {
        authorizedMinters[minter] = authorized;
        emit MinterAuthorized(minter, authorized);
    }
    
    function setMarketplace(address _marketplace) external onlyOwner {
        address old = marketplace;
        marketplace = _marketplace;
        emit MarketplaceUpdated(old, _marketplace);
    }

    // ============================================
    // Mint Function (ILeadNFT)
    // ============================================

    function mintLead(
        address to,
        bytes32 platformLeadId,
        bytes32 vertical,
        bytes32 geoHash,
        bytes32 piiHash,
        uint96 reservePrice,
        uint40 expiresAt,
        LeadSource source,
        bool tcpaConsent,
        string calldata uri
    ) external onlyAuthorizedMinter nonReentrant returns (uint256) {
        require(_platformLeadToToken[platformLeadId] == 0, "LeadNFTv2: Already tokenized");
        require(expiresAt > block.timestamp, "LeadNFTv2: Invalid expiry");
        
        uint256 tokenId = ++_nextTokenId;
        
        _leadMetadata[tokenId] = PackedLeadMetadata({
            vertical: vertical,
            geoHash: geoHash,
            piiHash: piiHash,
            seller: to,
            reservePrice: reservePrice,
            buyer: address(0),
            createdAt: uint40(block.timestamp),
            expiresAt: expiresAt,
            soldAt: 0,
            source: source,
            status: LeadStatus.ACTIVE,
            isVerified: false,
            tcpaConsent: tcpaConsent
        });
        
        _platformLeadToToken[platformLeadId] = tokenId;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        
        emit LeadMinted(tokenId, platformLeadId, to, vertical, source);
        
        return tokenId;
    }

    // ============================================
    // Sale Recording (ILeadNFT)
    // ============================================

    function recordSale(
        uint256 tokenId,
        address buyer,
        uint256 price
    ) external onlyAuthorizedMinter {
        require(_ownerOf(tokenId) != address(0), "LeadNFTv2: Nonexistent");
        
        PackedLeadMetadata storage meta = _leadMetadata[tokenId];
        meta.buyer = buyer;
        meta.soldAt = uint40(block.timestamp);
        meta.status = LeadStatus.SOLD;
        
        emit LeadSold(tokenId, meta.seller, buyer, price);
    }

    // ============================================
    // Status Updates (ILeadNFT)
    // ============================================

    function verifyLead(uint256 tokenId) external onlyAuthorizedMinter {
        require(_ownerOf(tokenId) != address(0), "LeadNFTv2: Nonexistent");
        _leadMetadata[tokenId].isVerified = true;
        emit LeadVerified(tokenId, msg.sender);
    }
    
    function expireLead(uint256 tokenId) external onlyAuthorizedMinter {
        require(_ownerOf(tokenId) != address(0), "LeadNFTv2: Nonexistent");
        PackedLeadMetadata storage meta = _leadMetadata[tokenId];
        require(meta.status == LeadStatus.ACTIVE, "LeadNFTv2: Not active");
        meta.status = LeadStatus.EXPIRED;
        emit LeadExpired(tokenId);
    }
    
    function setLeadStatus(uint256 tokenId, LeadStatus status) external onlyMarketplace {
        require(_ownerOf(tokenId) != address(0), "LeadNFTv2: Nonexistent");
        _leadMetadata[tokenId].status = status;
    }

    // ============================================
    // View Functions (ILeadNFT)
    // ============================================

    function getLead(uint256 tokenId) external view returns (LeadMetadata memory) {
        require(_ownerOf(tokenId) != address(0), "LeadNFTv2: Nonexistent");
        PackedLeadMetadata storage packed = _leadMetadata[tokenId];
        
        return LeadMetadata({
            vertical: packed.vertical,
            geoHash: packed.geoHash,
            piiHash: packed.piiHash,
            reservePrice: packed.reservePrice,
            createdAt: packed.createdAt,
            expiresAt: packed.expiresAt,
            soldAt: packed.soldAt,
            source: packed.source,
            status: packed.status,
            seller: packed.seller,
            buyer: packed.buyer,
            isVerified: packed.isVerified,
            tcpaConsent: packed.tcpaConsent
        });
    }
    
    function getLeadByPlatformId(bytes32 platformLeadId) external view returns (uint256, LeadMetadata memory) {
        uint256 tokenId = _platformLeadToToken[platformLeadId];
        require(tokenId != 0, "LeadNFTv2: Not found");
        return (tokenId, this.getLead(tokenId));
    }
    
    function isLeadValid(uint256 tokenId) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) return false;
        PackedLeadMetadata storage meta = _leadMetadata[tokenId];
        return meta.status == LeadStatus.ACTIVE && 
               block.timestamp < meta.expiresAt;
    }

    function getLeadRaw(uint256 tokenId) external view returns (
        bytes32 vertical,
        bytes32 geoHash,
        uint96 reservePrice,
        LeadSource source,
        LeadStatus status,
        bool isVerified
    ) {
        PackedLeadMetadata storage meta = _leadMetadata[tokenId];
        return (
            meta.vertical,
            meta.geoHash,
            meta.reservePrice,
            meta.source,
            meta.status,
            meta.isVerified
        );
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    // ============================================
    // Required Overrides
    // ============================================

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
