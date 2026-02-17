// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VerticalBountyPool
 * @dev Per-vertical USDC bounty pools funded by buyers.
 *
 * Design:
 *   - Buyers deposit USDC into pools keyed by vertical slug hash
 *   - Criteria matching is off-chain (geo, QS, credit score in buyer config)
 *   - Backend calls releaseBounty() when a matching lead is won at auction
 *   - Released amount goes to the seller as a bonus on top of the winning bid
 *   - Buyers can withdraw unreleased balance at any time (refund)
 *   - Multiple pools per vertical → stacking (backend resolves pro-rata)
 *
 * Gas optimizations:
 *   - Packed BountyPool struct (1–2 SSTOREs)
 *   - bytes32 for slug hashes (vs string)
 *   - No criteria on-chain — off-chain match engine
 */
contract VerticalBountyPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================
    // State
    // ============================================

    IERC20 public immutable paymentToken; // USDC

    struct BountyPool {
        address buyer;
        bytes32 verticalSlugHash;
        uint256 totalDeposited;
        uint256 totalReleased;
        uint40  createdAt;
        bool    active;
    }

    uint256 private _nextPoolId;
    mapping(uint256 => BountyPool) public pools;

    // Vertical slug hash → array of pool IDs (for stacking queries)
    mapping(bytes32 => uint256[]) private _verticalPools;

    // Authorized callers (backend service for releases)
    mapping(address => bool) public authorizedCallers;

    // ============================================
    // Events
    // ============================================

    event BountyDeposited(
        uint256 indexed poolId,
        address indexed buyer,
        bytes32 indexed verticalSlugHash,
        uint256 amount,
        uint256 newBalance
    );

    event BountyReleased(
        uint256 indexed poolId,
        address indexed recipient,
        uint256 amount,
        string  leadId
    );

    event BountyWithdrawn(
        uint256 indexed poolId,
        address indexed buyer,
        uint256 amount
    );

    event CallerAuthorized(address indexed caller, bool authorized);

    // ============================================
    // Constructor
    // ============================================

    constructor(
        address _paymentToken,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_paymentToken != address(0), "Zero token address");
        paymentToken = IERC20(_paymentToken);
    }

    // ============================================
    // Admin
    // ============================================

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit CallerAuthorized(caller, authorized);
    }

    modifier onlyAuthorizedCaller() {
        require(
            authorizedCallers[msg.sender] || msg.sender == owner(),
            "Not authorized"
        );
        _;
    }

    // ============================================
    // Deposit — Buyer funds a bounty pool
    // ============================================

    /**
     * @dev Deposit USDC into a new bounty pool for a vertical.
     *      Creates a new pool per call (allows multiple criteria sets per vertical).
     * @param verticalSlugHash keccak256 of the vertical slug string
     * @param amount USDC amount (in token units, 6 decimals)
     * @return poolId The ID of the created pool
     */
    function depositBounty(
        bytes32 verticalSlugHash,
        uint256 amount
    ) external nonReentrant returns (uint256) {
        require(verticalSlugHash != bytes32(0), "Empty slug hash");
        require(amount > 0, "Amount must be positive");

        // Transfer USDC from buyer to this contract
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 poolId = ++_nextPoolId;

        pools[poolId] = BountyPool({
            buyer: msg.sender,
            verticalSlugHash: verticalSlugHash,
            totalDeposited: amount,
            totalReleased: 0,
            createdAt: uint40(block.timestamp),
            active: true
        });

        _verticalPools[verticalSlugHash].push(poolId);

        emit BountyDeposited(poolId, msg.sender, verticalSlugHash, amount, amount);

        return poolId;
    }

    /**
     * @dev Top up an existing pool with additional USDC.
     * @param poolId The pool to top up
     * @param amount Additional USDC amount
     */
    function topUpBounty(
        uint256 poolId,
        uint256 amount
    ) external nonReentrant {
        BountyPool storage pool = pools[poolId];
        require(pool.active, "Pool not active");
        require(msg.sender == pool.buyer, "Only pool buyer");
        require(amount > 0, "Amount must be positive");

        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        pool.totalDeposited += amount;

        uint256 balance = pool.totalDeposited - pool.totalReleased;
        emit BountyDeposited(poolId, msg.sender, pool.verticalSlugHash, amount, balance);
    }

    // ============================================
    // Release — Backend triggers on auction win
    // ============================================

    /**
     * @dev Release bounty to a recipient (seller bonus on matching lead win).
     *      Called by authorized backend service when a lead matches buyer criteria
     *      and the auction is won.
     * @param poolId The bounty pool to release from
     * @param recipient Address to receive the bounty (the seller)
     * @param amount USDC amount to release
     * @param leadId Platform lead ID for audit trail
     */
    function releaseBounty(
        uint256 poolId,
        address recipient,
        uint256 amount,
        string calldata leadId
    ) external onlyAuthorizedCaller nonReentrant {
        BountyPool storage pool = pools[poolId];
        require(pool.active, "Pool not active");
        require(recipient != address(0), "Zero recipient");
        require(amount > 0, "Amount must be positive");

        uint256 available = pool.totalDeposited - pool.totalReleased;
        require(amount <= available, "Insufficient pool balance");

        pool.totalReleased += amount;

        paymentToken.safeTransfer(recipient, amount);

        emit BountyReleased(poolId, recipient, amount, leadId);
    }

    // ============================================
    // Withdraw — Buyer reclaims unreleased funds
    // ============================================

    /**
     * @dev Withdraw unreleased bounty balance back to buyer (refund).
     * @param poolId The pool to withdraw from
     * @param amount USDC amount to withdraw (0 = withdraw all)
     */
    function withdrawBounty(
        uint256 poolId,
        uint256 amount
    ) external nonReentrant {
        BountyPool storage pool = pools[poolId];
        require(pool.active, "Pool not active");
        require(msg.sender == pool.buyer, "Only pool buyer");

        uint256 available = pool.totalDeposited - pool.totalReleased;
        uint256 withdrawAmount = amount == 0 ? available : amount;

        require(withdrawAmount > 0, "Nothing to withdraw");
        require(withdrawAmount <= available, "Insufficient balance");

        pool.totalReleased += withdrawAmount;

        // Deactivate pool if fully drained
        if (pool.totalDeposited == pool.totalReleased) {
            pool.active = false;
        }

        paymentToken.safeTransfer(msg.sender, withdrawAmount);

        emit BountyWithdrawn(poolId, msg.sender, withdrawAmount);
    }

    // ============================================
    // View Functions
    // ============================================

    /**
     * @dev Get available (unreleased) balance for a pool.
     */
    function availableBalance(uint256 poolId) external view returns (uint256) {
        BountyPool storage pool = pools[poolId];
        if (!pool.active) return 0;
        return pool.totalDeposited - pool.totalReleased;
    }

    /**
     * @dev Get all pool IDs for a vertical.
     */
    function getVerticalPoolIds(bytes32 verticalSlugHash) external view returns (uint256[] memory) {
        return _verticalPools[verticalSlugHash];
    }

    /**
     * @dev Get total available bounty across all pools for a vertical.
     */
    function totalVerticalBounty(bytes32 verticalSlugHash) external view returns (uint256 total) {
        uint256[] storage poolIds = _verticalPools[verticalSlugHash];
        for (uint256 i = 0; i < poolIds.length; i++) {
            BountyPool storage pool = pools[poolIds[i]];
            if (pool.active) {
                total += pool.totalDeposited - pool.totalReleased;
            }
        }
    }
}
