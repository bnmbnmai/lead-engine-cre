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
 *   - platformAddress (immutable) for platform-only minting pattern
 *   - transferWithRoyalty enforces on-chain royalty splits
 *   - Chainlink AggregatorV3Interface for dynamic floor pricing
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

    /// @dev Immutable platform wallet — receives minted NFTs via backend
    address public immutable override platformAddress;

    // Token ID → metadata
    mapping(uint256 => VerticalMetadata) private _verticals;

    // Slug hash → token ID (0 = not minted)
    mapping(bytes32 => uint256) public override slugToToken;

    // Authorized minters (backend service)
    mapping(address => bool) public authorizedMinters;

    // Limits
    uint16 public constant MAX_DEPTH = 3;
    uint16 public constant MAX_ROYALTY_BPS = 1000; // 10% hard cap
    uint16 public constant MAX_BATCH_SIZE = 20;

    // Chainlink price feed (optional)
    address private _priceFeed;

    // ============================================
    // Constructor
    // ============================================

    constructor(
        address initialOwner,
        uint96 defaultRoyaltyBps, // e.g., 200 = 2%
        address _platformAddress
    )
        ERC721("Lead Engine Vertical", "VERT")
        Ownable(initialOwner)
    {
        require(_platformAddress != address(0), "VerticalNFT: Zero platform address");
        require(defaultRoyaltyBps <= MAX_ROYALTY_BPS, "VerticalNFT: Royalty exceeds cap");
        platformAddress = _platformAddress;

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
     * @param feeNumerator Basis points (e.g., 200 = 2%), capped at MAX_ROYALTY_BPS
     */
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        require(feeNumerator <= MAX_ROYALTY_BPS, "VerticalNFT: Royalty exceeds cap");
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
        require(feeNumerator <= MAX_ROYALTY_BPS, "VerticalNFT: Royalty exceeds cap");
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
        emit TokenRoyaltyUpdated(tokenId, receiver, feeNumerator);
    }

    /**
     * @dev Set Chainlink price feed address for dynamic floor pricing
     */
    function setPriceFeed(address feed) external override onlyOwner {
        _priceFeed = feed;
        emit PriceFeedUpdated(feed);
    }

    // ============================================
    // Minting
    // ============================================

    /**
     * @dev Mint a new vertical NFT
     * @param to Recipient address (should be platformAddress for platform-only minting)
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
        return _mintSingle(BatchMintParams({
            to: to,
            slug: slug,
            parentSlug: parentSlug,
            attributesHash: attributesHash,
            depth: depth,
            uri: uri
        }));
    }

    /**
     * @dev Batch mint multiple vertical NFTs in a single transaction
     * @param params Array of mint parameters (max MAX_BATCH_SIZE)
     */
    function batchMintVerticals(
        BatchMintParams[] calldata params
    ) external override onlyAuthorizedMinter nonReentrant returns (uint256[] memory tokenIds) {
        require(params.length > 0, "VerticalNFT: Empty batch");
        require(params.length <= MAX_BATCH_SIZE, "VerticalNFT: Batch too large");

        tokenIds = new uint256[](params.length);
        for (uint256 i = 0; i < params.length; i++) {
            tokenIds[i] = _mintSingle(params[i]);
        }

        emit BatchMinted(tokenIds, msg.sender);
        return tokenIds;
    }

    /**
     * @dev Internal: mint a single vertical (shared by mintVertical + batchMintVerticals)
     */
    function _mintSingle(BatchMintParams memory p) internal returns (uint256) {
        require(p.to != address(0), "VerticalNFT: Zero address");
        require(p.slug != bytes32(0), "VerticalNFT: Empty slug");
        require(slugToToken[p.slug] == 0, "VerticalNFT: Slug already minted");
        require(p.depth <= MAX_DEPTH, "VerticalNFT: Depth exceeds limit");

        // If parent specified, it must exist
        if (p.parentSlug != bytes32(0)) {
            require(slugToToken[p.parentSlug] != 0, "VerticalNFT: Parent not minted");
        }

        uint256 tokenId = _nextTokenId++;

        _verticals[tokenId] = VerticalMetadata({
            slug: p.slug,
            parentSlug: p.parentSlug,
            attributesHash: p.attributesHash,
            activatedAt: uint40(block.timestamp),
            depth: p.depth,
            isFractionalizable: false
        });

        slugToToken[p.slug] = tokenId;

        _safeMint(p.to, tokenId);
        _setTokenURI(tokenId, p.uri);

        emit VerticalMinted(tokenId, p.slug, p.parentSlug, p.to, p.depth);

        return tokenId;
    }

    // ============================================
    // Transfer with Royalty (On-Chain Resale)
    // ============================================

    /**
     * @dev Transfer an NFT with enforced EIP-2981 royalty split
     * @param tokenId Token to transfer
     * @param buyer Recipient address
     * @notice msg.value is the sale price; royalty is deducted and sent to royalty receiver
     */
    function transferWithRoyalty(
        uint256 tokenId,
        address buyer
    ) external payable override nonReentrant {
        address seller = ownerOf(tokenId);
        require(
            msg.sender == seller ||
            isApprovedForAll(seller, msg.sender) ||
            getApproved(tokenId) == msg.sender,
            "VerticalNFT: Not seller or approved"
        );
        require(buyer != address(0), "VerticalNFT: Zero buyer");
        require(msg.value > 0, "VerticalNFT: Zero payment");

        // EIP-2981 royalty calculation
        (address royaltyReceiver, uint256 royaltyAmount) = royaltyInfo(tokenId, msg.value);

        // Cap royalty at MAX_ROYALTY_BPS
        uint256 maxRoyalty = (msg.value * MAX_ROYALTY_BPS) / 10000;
        if (royaltyAmount > maxRoyalty) {
            royaltyAmount = maxRoyalty;
        }

        uint256 sellerProceeds = msg.value - royaltyAmount;

        // Transfer NFT first (checks-effects-interactions)
        _transfer(seller, buyer, tokenId);

        // Pay royalty
        if (royaltyAmount > 0 && royaltyReceiver != address(0)) {
            (bool royaltyOk, ) = royaltyReceiver.call{value: royaltyAmount}("");
            require(royaltyOk, "VerticalNFT: Royalty transfer failed");
        }

        // Pay seller
        if (sellerProceeds > 0) {
            (bool sellerOk, ) = seller.call{value: sellerProceeds}("");
            require(sellerOk, "VerticalNFT: Seller payment failed");
        }

        emit VerticalResold(tokenId, seller, buyer, msg.value, royaltyAmount);
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

    /**
     * @dev Read latest price from Chainlink price feed
     * @return price Latest price (8 decimals for ETH/USD)
     * @return updatedAt Timestamp of last update
     */
    function getFloorPrice() external view override returns (int256 price, uint256 updatedAt) {
        require(_priceFeed != address(0), "VerticalNFT: No price feed");

        // Low-level call to AggregatorV3Interface.latestRoundData()
        (bool success, bytes memory data) = _priceFeed.staticcall(
            abi.encodeWithSignature("latestRoundData()")
        );
        require(success, "VerticalNFT: Price feed call failed");

        (, price, , updatedAt, ) = abi.decode(data, (uint80, int256, uint256, uint256, uint80));
        require(price > 0, "VerticalNFT: Invalid price");
    }

    function priceFeed() external view returns (address) {
        return _priceFeed;
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
