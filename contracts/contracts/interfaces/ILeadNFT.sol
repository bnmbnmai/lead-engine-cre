// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ILeadNFT
 * @dev Interface for Lead Engine NFT contract
 */
interface ILeadNFT {
    // Enums
    enum LeadSource { PLATFORM, API, OFFSITE }
    enum LeadStatus { ACTIVE, IN_AUCTION, SOLD, EXPIRED, CANCELLED }

    // Structs
    struct LeadMetadata {
        bytes32 vertical;           // Keccak hash of vertical string
        bytes32 geoHash;            // Geohash for privacy-preserving location
        bytes32 piiHash;            // Hash of PII for ZK verification
        uint96 reservePrice;        // Minimum acceptable bid (6 decimals for USDC)
        uint40 createdAt;           // Timestamp
        uint40 expiresAt;           // Auction expiry
        uint40 soldAt;              // Sale timestamp
        LeadSource source;          // Origin of lead
        LeadStatus status;          // Current status
        address seller;             // Original seller
        address buyer;              // Winning buyer
        bool isVerified;            // ACE verification status
        bool tcpaConsent;           // TCPA consent flag
    }

    // Events
    event LeadMinted(
        uint256 indexed tokenId,
        bytes32 indexed platformLeadId,
        address indexed seller,
        bytes32 vertical,
        LeadSource source
    );

    event LeadSold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price
    );

    event LeadVerified(uint256 indexed tokenId, address verifier);
    event LeadExpired(uint256 indexed tokenId);

    // Functions
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
    ) external returns (uint256);

    function recordSale(
        uint256 tokenId,
        address buyer,
        uint256 price
    ) external;

    function verifyLead(uint256 tokenId) external;
    function expireLead(uint256 tokenId) external;
    function getLead(uint256 tokenId) external view returns (LeadMetadata memory);
    function getLeadByPlatformId(bytes32 platformLeadId) external view returns (uint256, LeadMetadata memory);
    function isLeadValid(uint256 tokenId) external view returns (bool);
}
