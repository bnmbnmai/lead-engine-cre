// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ace/vendor/core/PolicyProtectedUpgradeable.sol";
import "./interfaces/ILeadNFT.sol";

/**
 * @title LeadNFTv2
 * @dev Gas-optimized ERC-721 for lead tokenization with enhanced metadata.
 *      Chainlink ACE integration via PolicyProtectedUpgradeable mixin:
 *        - mintLead() is gated by `runPolicy` — ACELeadPolicy checks
 *          ACECompliance.isCompliant(msg.sender) before execution proceeds.
 *        - transferFrom() is gated by `runPolicy` — blocks non-compliant transfers.
 *      The PolicyEngine (and its registered ACELeadPolicy) must be deployed and
 *      configured separately via deploy-leadnft-ace.ts before policies are enforced.
 *      When no PolicyEngine is attached (address(0)) all calls pass through.
 * @notice Redeployed with ACE support. Requires new deployment — the proxy address
 *         (LEAD_NFT_V2_ADDRESS env var) must be updated on Render after deploy.
 */
contract LeadNFTv2 is ERC721, ERC721URIStorage, ERC721Burnable, ERC2981, Ownable, ReentrancyGuard, PolicyProtectedUpgradeable, ILeadNFT {
    // ============================================
    // Constants
    // ============================================

    /// @notice Hard cap on royalty basis points (10%)
    uint96 public constant MAX_ROYALTY_BPS = 1000;

    // ============================================
    // State Variables (Optimized Storage Layout)
    // ============================================

    /// @dev Token ID counter. Starts at 1 — token ID 0 is the "not tokenized"
    ///      sentinel in _platformLeadToToken. This invariant MUST be preserved:
    ///      any lead whose platformLeadId maps to 0 has not been minted yet.
    ///      Do NOT change this initializer without updating mintLead() guards.
    uint256 private _nextTokenId = 1;

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
    event LeadStatusUpdated(uint256 indexed tokenId, LeadStatus oldStatus, LeadStatus newStatus);
    event RoyaltyInfoSet(address indexed receiver, uint96 feeNumerator);
    event PolicyEngineAttached(address indexed policyEngine);

    // ============================================
    // Constructor
    // ============================================

    /**
     * @param initialOwner  Deployer / contract admin.
     * @param policyEngine  Address of the deployed PolicyEngine proxy.
     *                      Pass address(0) to skip ACE enforcement (add later via attachPolicyEngine()).
     */
    constructor(address initialOwner, address policyEngine)
        ERC721("Lead Engine Lead v2", "LEADv2")
        Ownable(initialOwner)
    {
        if (policyEngine != address(0)) {
            __PolicyProtected_init(policyEngine);
            emit PolicyEngineAttached(policyEngine);
        }
    }

    // ============================================
    // ACE PolicyEngine Management (admin only)
    // ============================================

    /**
     * @notice Attach or replace the Chainlink ACE PolicyEngine.
     *         Pass address(0) to disable ACE enforcement.
     */
    function attachPolicyEngine(address policyEngine) external onlyOwner {
        _setPolicyEngine(policyEngine);
        emit PolicyEngineAttached(policyEngine);
    }

    /// @notice Returns the currently attached PolicyEngine address (address(0) if none).
    function getPolicyEngine() external view returns (address) {
        return _getPolicyEngine();
    }

    /// @notice Set arbitrary context bytes passed to the PolicyEngine on every run.
    function setPolicyContext(bytes calldata ctx) external onlyOwner {
        _setContext(ctx);
    }

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
        require(_marketplace != address(0), "LeadNFTv2: Zero marketplace");
        address old = marketplace;
        marketplace = _marketplace;
        emit MarketplaceUpdated(old, _marketplace);
    }

    /**
     * @notice Set EIP-2981 default royalty for all LeadNFT secondary sales.
     * @param receiver  Address that receives royalties (e.g., platform treasury)
     * @param feeNumerator  Basis points (e.g., 250 = 2.5%). Hard-capped at 10%.
     */
    function setRoyaltyInfo(address receiver, uint96 feeNumerator) external onlyOwner {
        require(receiver != address(0), "LeadNFTv2: Zero royalty receiver");
        require(feeNumerator <= MAX_ROYALTY_BPS, "LeadNFTv2: Royalty exceeds 10%");
        _setDefaultRoyalty(receiver, feeNumerator);
        emit RoyaltyInfoSet(receiver, feeNumerator);
    }

    /**
     * @notice Returns EIP-2981 royalty info for a given token and sale price.
     * @dev Delegates to ERC2981._defaultRoyaltyInfo (set via setRoyaltyInfo).
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        public
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        return super.royaltyInfo(tokenId, salePrice);
    }

    // ============================================
    // Mint Function (ILeadNFT) — ACE Policy Gated
    // ============================================

    /**
     * @notice Mint a new Lead NFT.
     * @dev Protected by `runPolicy` — if a PolicyEngine is attached, the registered
     *      ACELeadPolicy checks ACECompliance.isCompliant(msg.sender) before execution.
     *      Reverts with IPolicyEngine.PolicyRejected if sender is non-compliant.
     *      When no PolicyEngine is attached (address(0)) the call passes through.
     */
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
    ) external onlyAuthorizedMinter nonReentrant runPolicy returns (uint256) {
        require(_platformLeadToToken[platformLeadId] == 0, "LeadNFTv2: Already tokenized");
        require(expiresAt > block.timestamp, "LeadNFTv2: Invalid expiry");

        // _nextTokenId starts at 1, so the first token minted is always 1.
        // This preserves the invariant: _platformLeadToToken[id] == 0 means "not minted".
        uint256 tokenId = _nextTokenId++;
        assert(tokenId >= 1); // Sentinel invariant: token ID 0 must never be minted

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
        LeadStatus oldStatus = _leadMetadata[tokenId].status;
        _leadMetadata[tokenId].status = status;
        emit LeadStatusUpdated(tokenId, oldStatus, status);
    }

    /**
     * @notice ACE-gated ERC-721 transfer.
     * @dev `runPolicy` runs ACELeadPolicy on every transfer — blocks non-compliant recipients.
     *      When no PolicyEngine is attached the call passes through normally.
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override(ERC721, IERC721) runPolicy {
        super.transferFrom(from, to, tokenId);
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

    /// @notice Returns the number of leads minted so far.
    function totalSupply() external view returns (uint256) {
        // _nextTokenId starts at 1 and is post-incremented on each mint,
        // so the count of minted tokens is _nextTokenId - 1.
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
