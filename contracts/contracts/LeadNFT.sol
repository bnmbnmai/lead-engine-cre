// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LeadNFT
 * @dev ERC-721 token representing ownership of a lead in the Lead Engine CRE marketplace
 * @notice Each token represents a unique lead with metadata stored on IPFS
 */
contract LeadNFT is ERC721, ERC721URIStorage, ERC721Burnable, Ownable, ReentrancyGuard {
    uint256 private _nextTokenId;
    
    // Lead metadata
    struct LeadMetadata {
        string vertical;      // e.g., "solar", "mortgage", "roofing"
        string geoHash;       // Geolocation hash for privacy
        uint256 createdAt;
        uint256 soldAt;
        address seller;
        address buyer;
        uint256 salePrice;
        bool isVerified;
    }
    
    // Mapping from token ID to lead metadata
    mapping(uint256 => LeadMetadata) public leadMetadata;
    
    // Mapping from platform lead ID to token ID
    mapping(string => uint256) public platformLeadToToken;
    
    // Authorized minters (backend service, RTB engine)
    mapping(address => bool) public authorizedMinters;
    
    // Events
    event LeadMinted(
        uint256 indexed tokenId,
        string platformLeadId,
        address indexed seller,
        string vertical
    );
    
    event LeadSold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price
    );
    
    event LeadVerified(uint256 indexed tokenId, address verifier);
    event MinterAuthorized(address indexed minter, bool authorized);

    constructor(address initialOwner) 
        ERC721("Lead Engine Lead", "LEAD") 
        Ownable(initialOwner) 
    {}
    
    modifier onlyAuthorizedMinter() {
        require(
            authorizedMinters[msg.sender] || msg.sender == owner(),
            "LeadNFT: Not authorized to mint"
        );
        _;
    }

    /**
     * @dev Authorize or revoke a minter address
     * @param minter Address to authorize/revoke
     * @param authorized Whether to authorize or revoke
     */
    function setAuthorizedMinter(address minter, bool authorized) external onlyOwner {
        authorizedMinters[minter] = authorized;
        emit MinterAuthorized(minter, authorized);
    }

    /**
     * @dev Mint a new lead NFT
     * @param to Address to mint to (typically the seller initially)
     * @param platformLeadId The lead ID from the platform database
     * @param vertical The lead vertical (e.g., "solar")
     * @param geoHash Hashed geolocation for privacy
     * @param uri IPFS URI with full lead metadata
     */
    function mintLead(
        address to,
        string calldata platformLeadId,
        string calldata vertical,
        string calldata geoHash,
        string calldata uri
    ) external onlyAuthorizedMinter nonReentrant returns (uint256) {
        require(platformLeadToToken[platformLeadId] == 0, "LeadNFT: Lead already tokenized");
        
        uint256 tokenId = _nextTokenId++;
        
        leadMetadata[tokenId] = LeadMetadata({
            vertical: vertical,
            geoHash: geoHash,
            createdAt: block.timestamp,
            soldAt: 0,
            seller: to,
            buyer: address(0),
            salePrice: 0,
            isVerified: false
        });
        
        platformLeadToToken[platformLeadId] = tokenId;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        
        emit LeadMinted(tokenId, platformLeadId, to, vertical);
        
        return tokenId;
    }

    /**
     * @dev Record a lead sale (called by escrow contract or authorized minter)
     * @param tokenId The token ID being sold
     * @param buyer The buyer address
     * @param price The sale price in wei
     */
    function recordSale(
        uint256 tokenId,
        address buyer,
        uint256 price
    ) external onlyAuthorizedMinter {
        require(_ownerOf(tokenId) != address(0), "LeadNFT: Token does not exist");
        
        LeadMetadata storage meta = leadMetadata[tokenId];
        meta.buyer = buyer;
        meta.salePrice = price;
        meta.soldAt = block.timestamp;
        
        emit LeadSold(tokenId, meta.seller, buyer, price);
    }

    /**
     * @dev Mark a lead as verified (e.g., after compliance check)
     * @param tokenId The token ID to verify
     */
    function verifyLead(uint256 tokenId) external onlyAuthorizedMinter {
        require(_ownerOf(tokenId) != address(0), "LeadNFT: Token does not exist");
        leadMetadata[tokenId].isVerified = true;
        emit LeadVerified(tokenId, msg.sender);
    }

    /**
     * @dev Get lead metadata
     * @param tokenId The token ID
     */
    function getLead(uint256 tokenId) external view returns (LeadMetadata memory) {
        require(_ownerOf(tokenId) != address(0), "LeadNFT: Token does not exist");
        return leadMetadata[tokenId];
    }

    /**
     * @dev Get current token count
     */
    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    // Required overrides
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
