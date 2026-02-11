// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IVerticalNFT
 * @dev Interface for the VerticalNFT contract
 * @notice ERC-721 representing ownership of a marketplace vertical
 */
interface IVerticalNFT {
    // ============================================
    // Structs
    // ============================================

    struct VerticalMetadata {
        bytes32 slug;           // keccak256 of slug string (gas-efficient)
        bytes32 parentSlug;     // Parent vertical slug hash (0x0 for top-level)
        bytes32 attributesHash; // Hash of attributes JSON (compliance, keywords, etc.)
        uint40  activatedAt;    // Activation timestamp
        uint16  depth;          // Hierarchy depth (0 = root, max 3)
        bool    isFractionalizable; // Future: can be split into ERC-1155 fractions
    }

    struct BatchMintParams {
        address to;
        bytes32 slug;
        bytes32 parentSlug;
        bytes32 attributesHash;
        uint16  depth;
        string  uri;
    }

    // ============================================
    // Events
    // ============================================

    event VerticalMinted(
        uint256 indexed tokenId,
        bytes32 indexed slug,
        bytes32 indexed parentSlug,
        address owner,
        uint16 depth
    );

    event VerticalDeactivated(uint256 indexed tokenId, bytes32 slug);
    event MinterAuthorized(address indexed minter, bool authorized);
    event DefaultRoyaltyUpdated(address receiver, uint96 feeNumerator);
    event TokenRoyaltyUpdated(uint256 indexed tokenId, address receiver, uint96 feeNumerator);
    event FractionalizableSet(uint256 indexed tokenId, bool flag);

    event VerticalResold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 salePrice,
        uint256 royaltyAmount
    );

    event PriceFeedUpdated(address feed);
    event BatchMinted(uint256[] tokenIds, address minter);

    // ============================================
    // External Functions
    // ============================================

    function mintVertical(
        address to,
        bytes32 slug,
        bytes32 parentSlug,
        bytes32 attributesHash,
        uint16 depth,
        string calldata uri
    ) external returns (uint256);

    function transferWithRoyalty(uint256 tokenId, address buyer) external payable;
    function batchMintVerticals(BatchMintParams[] calldata params) external returns (uint256[] memory);
    function deactivateVertical(uint256 tokenId) external;
    function setFractionalizable(uint256 tokenId, bool flag) external;
    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external;
    function setPriceFeed(address feed) external;

    // ============================================
    // View Functions
    // ============================================

    function platformAddress() external view returns (address);
    function getVertical(uint256 tokenId) external view returns (VerticalMetadata memory);
    function getVerticalBySlug(bytes32 slug) external view returns (uint256 tokenId, VerticalMetadata memory);
    function slugToToken(bytes32 slug) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function getFloorPrice() external view returns (int256 price, uint256 updatedAt);
}
