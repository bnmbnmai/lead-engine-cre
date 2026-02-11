// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IVerticalNFT.sol";

/**
 * @title VerticalNFT
 * @dev ERC-721 representing ownership of a marketplace vertical (sub-stream)
 * @notice Each token maps to a unique vertical slug. Includes EIP-2981 royalties (2% default).
 *
 * Design choices:
 *   - bytes32 for slugs (vs string) → cheaper storage & comparison
 *   - Packed struct → single SSTORE for metadata
 *   - One NFT per slug enforced via slugToToken mapping
 *   - isFractionalizable flag for future ERC-1155 wrapper integration
 */
contract VerticalNFT is
    IVerticalNFT,
    ERC721,
    ERC721URIStorage,
    ERC721Burnable,
    ERC2981,
    Ownable,
    ReentrancyGuard
{
    // ============================================
    // State Variables
    // ============================================

    uint256 private _nextTokenId = 1; // Start at 1 (0 = "not minted" sentinel)

    // Token ID → metadata
    mapping(uint256 => VerticalMetadata) private _verticals;

    // Slug hash → token ID (0 = not minted)
    mapping(bytes32 => uint256) public override slugToToken;

    // Authorized minters (backend service)
    mapping(address => bool) public authorizedMinters;

    // Limits
    uint16 public constant MAX_DEPTH = 3;

    // ============================================
    // Constructor
    // ============================================

    constructor(
        address initialOwner,
        uint96 defaultRoyaltyBps // e.g., 200 = 2%
    )
        ERC721("Lead Engine Vertical", "VERT")
        Ownable(initialOwner)
    {
        // Set default royalty: owner receives royalties on all tokens
        _setDefaultRoyalty(initialOwner, defaultRoyaltyBps);
    }

    // ============================================
    // Modifiers
    // ============================================

    modifier onlyAuthorizedMinter() {
        require(
            authorizedMinters[msg.sender] || msg.sender == owner(),
            "VerticalNFT: Not authorized"
        );
        _;
    }

    // ============================================
    // Admin Functions
    // ============================================

    /**
     * @dev Authorize or revoke a minter address
     */
    function setAuthorizedMinter(address minter, bool authorized) external onlyOwner {
        authorizedMinters[minter] = authorized;
        emit MinterAuthorized(minter, authorized);
    }

    /**
     * @dev Update default royalty for all tokens
     * @param receiver Royalty recipient
     * @param feeNumerator Basis points (e.g., 200 = 2%)
     */
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
        emit DefaultRoyaltyUpdated(receiver, feeNumerator);
    }

    /**
     * @dev Override royalty for a specific token (e.g., premium vertical)
     */
    function setTokenRoyalty(
        uint256 tokenId,
        address receiver,
        uint96 feeNumerator
    ) external override onlyOwner {
        require(_ownerOf(tokenId) != address(0), "VerticalNFT: Token does not exist");
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
        emit TokenRoyaltyUpdated(tokenId, receiver, feeNumerator);
    }

    // ============================================
    // Minting
    // ============================================

    /**
     * @dev Mint a new vertical NFT
     * @param to Recipient address (vertical owner)
     * @param slug keccak256 hash of the vertical slug string
     * @param parentSlug keccak256 hash of parent slug (bytes32(0) for top-level)
     * @param attributesHash Hash of attributes JSON
     * @param depth Hierarchy depth (0-3)
     * @param uri Metadata URI (IPFS or API endpoint)
     */
    function mintVertical(
        address to,
        bytes32 slug,
        bytes32 parentSlug,
        bytes32 attributesHash,
        uint16 depth,
        string calldata uri
    ) external override onlyAuthorizedMinter nonReentrant returns (uint256) {
        require(to != address(0), "VerticalNFT: Zero address");
        require(slug != bytes32(0), "VerticalNFT: Empty slug");
        require(slugToToken[slug] == 0, "VerticalNFT: Slug already minted");
        require(depth <= MAX_DEPTH, "VerticalNFT: Depth exceeds limit");

        // If parent specified, it must exist
        if (parentSlug != bytes32(0)) {
            require(slugToToken[parentSlug] != 0, "VerticalNFT: Parent not minted");
        }

        uint256 tokenId = _nextTokenId++;

        _verticals[tokenId] = VerticalMetadata({
            slug: slug,
            parentSlug: parentSlug,
            attributesHash: attributesHash,
            activatedAt: uint40(block.timestamp),
            depth: depth,
            isFractionalizable: false
        });

        slugToToken[slug] = tokenId;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        emit VerticalMinted(tokenId, slug, parentSlug, to, depth);

        return tokenId;
    }

    // ============================================
    // Deactivation
    // ============================================

    /**
     * @dev Deactivate a vertical (burn the NFT)
     * @param tokenId Token to deactivate
     */
    function deactivateVertical(uint256 tokenId) external override {
        require(
            _isAuthorized(ownerOf(tokenId), msg.sender, tokenId),
            "VerticalNFT: Not owner or approved"
        );

        bytes32 slug = _verticals[tokenId].slug;

        // Clear slug mapping
        delete slugToToken[slug];
        delete _verticals[tokenId];

        // Burn
        _burn(tokenId);

        emit VerticalDeactivated(tokenId, slug);
    }

    // ============================================
    // Fractionalizable Flag
    // ============================================

    /**
     * @dev Set whether a vertical can be fractionalized (future ERC-1155 wrapper)
     */
    function setFractionalizable(uint256 tokenId, bool flag) external override onlyOwner {
        require(_ownerOf(tokenId) != address(0), "VerticalNFT: Token does not exist");
        _verticals[tokenId].isFractionalizable = flag;
        emit FractionalizableSet(tokenId, flag);
    }

    // ============================================
    // View Functions
    // ============================================

    function getVertical(uint256 tokenId) external view override returns (VerticalMetadata memory) {
        require(_ownerOf(tokenId) != address(0), "VerticalNFT: Token does not exist");
        return _verticals[tokenId];
    }

    function getVerticalBySlug(bytes32 slug) external view override returns (uint256 tokenId, VerticalMetadata memory) {
        tokenId = slugToToken[slug];
        require(tokenId != 0, "VerticalNFT: Slug not found");
        return (tokenId, _verticals[tokenId]);
    }

    function totalSupply() external view override returns (uint256) {
        return _nextTokenId - 1;
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
        override(ERC721, ERC721URIStorage, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
