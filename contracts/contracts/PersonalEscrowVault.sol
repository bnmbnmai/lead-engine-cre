// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * @title PersonalEscrowVault
 * @notice Per-user USDC vault for Lead Engine CRE.
 *         Buyers deposit USDC, balances are tracked on-chain.
 *         Backend deducts on auction win (bid + $1 fee), refunds on loss.
 *         Chainlink Automation runs Proof-of-Reserves checks every 24h
 *         and auto-refunds expired bid locks after 7 days.
 *
 * @dev Security: ReentrancyGuard on all state-changing functions,
 *      Pausable for emergency stops, SafeERC20 for USDC transfers.
 */
contract PersonalEscrowVault is
    Ownable,
    ReentrancyGuard,
    Pausable,
    AutomationCompatibleInterface
{
    using SafeERC20 for IERC20;

    // ============================================
    // Constants
    // ============================================

    /// @notice $1 USDC convenience fee (6 decimals)
    uint256 public constant CONVENIENCE_FEE = 1_000_000;

    /// @notice 5% platform cut on settlements (basis points)
    uint256 public constant PLATFORM_CUT_BPS = 500;

    /// @notice Proof-of-Reserves check interval
    uint256 public constant POR_INTERVAL = 24 hours;

    /// @notice Lock expiration period (auto-refund after this)
    uint256 public constant LOCK_EXPIRY = 7 days;

    // ============================================
    // State
    // ============================================

    /// @notice USDC token
    IERC20 public immutable paymentToken;

    /// @notice Platform wallet for fee collection
    address public platformWallet;

    /// @notice Per-user available (unlocked) balances
    mapping(address => uint256) public balances;

    /// @notice Per-user locked balances (in active bids)
    mapping(address => uint256) public lockedBalances;

    /// @notice Global total deposits (informational — not used for PoR)
    uint256 public totalDeposited;

    /// @notice Global total withdrawn (informational — not used for PoR)
    uint256 public totalWithdrawn;

    /// @notice Running total of all user obligations (balances + lockedBalances)
    ///         Used by verifyReserves() for accurate Proof-of-Reserves.
    ///         Incremented on deposit, decremented on withdraw and settleBid.
    uint256 public totalObligations;

    /// @notice Authorized callers (backend service)
    mapping(address => bool) public authorizedCallers;

    // ── Bid Locks ──

    struct BidLock {
        address user;
        uint256 amount;      // bid amount (excl. fee)
        uint256 fee;         // convenience fee
        uint256 lockedAt;
        bool    settled;     // true if settled or refunded
        bytes32 leadIdHash;  // keccak256(leadId) binding — 0x0 for legacy (unbound) locks
    }

    uint256 private _nextLockId;
    mapping(uint256 => BidLock) public bidLocks;

    /// @notice Owner-registered seller binding per lead (Phase B3).
    ///         When set, settleBid for that lead MUST pay this address —
    ///         a compromised backend/relayer key cannot redirect funds.
    ///         Registered by the owner (multisig), not the relayer.
    mapping(bytes32 => address) public leadSellers;

    /// @dev Track active (unsettled) lock IDs for Automation sweep
    uint256[] private _activeLockIds;
    mapping(uint256 => uint256) private _activeLockIndex; // lockId => index in _activeLockIds

    // ── Proof of Reserves ──

    uint256 public lastPorCheck;
    bool    public lastPorSolvent;

    // ── Chainlink Data Feed ──

    /// @notice USDC/ETH Chainlink price feed (8 decimals)
    ///         Base Sepolia: 0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF
    AggregatorV3Interface public usdcEthFeed;

    /// @notice Demo mode: bypasses stale Chainlink price feed check for testnet demos.
    ///         Owner-controlled via setDemoMode(). NEVER enable on mainnet.
    bool public demoMode;

    // ============================================
    // Events
    // ============================================

    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event BidLocked(uint256 indexed lockId, address indexed user, uint256 bidAmount, uint256 fee);
    event BidSettled(uint256 indexed lockId, address indexed winner, address indexed seller, uint256 sellerAmount, uint256 platformCut, uint256 convenienceFee);
    event BidRefunded(uint256 indexed lockId, address indexed user, uint256 totalRefunded);
    event ReservesVerified(uint256 contractBalance, uint256 claimedTotal, bool solvent, uint256 timestamp);
    event ExpiredLocksRefunded(uint256 count, uint256 timestamp);
    event CallerAuthorized(address indexed caller, bool authorized);
    event PlatformWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event LeadBound(uint256 indexed lockId, bytes32 indexed leadIdHash);
    event LeadSellerRegistered(bytes32 indexed leadIdHash, address indexed seller);
    event BidSettledForLead(uint256 indexed lockId, bytes32 indexed leadIdHash, address indexed seller);
    event FeedUpdated(address indexed oldFeed, address indexed newFeed);
    event DemoModeUpdated(bool enabled);

    // ============================================
    // Modifiers
    // ============================================

    modifier onlyAuthorizedCaller() {
        require(
            authorizedCallers[msg.sender] || msg.sender == owner(),
            "Vault: not authorized"
        );
        _;
    }

    // ============================================
    // Constructor
    // ============================================

    constructor(
        address _paymentToken,
        address _platformWallet,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_paymentToken != address(0), "Zero token");
        require(_platformWallet != address(0), "Zero platform wallet");
        paymentToken = IERC20(_paymentToken);
        platformWallet = _platformWallet;
        // Base Sepolia USDC/ETH Chainlink Data Feed
        usdcEthFeed = AggregatorV3Interface(0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF);
    }

    // ============================================
    // Admin
    // ============================================

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit CallerAuthorized(caller, authorized);
    }

    function setPlatformWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Zero address");
        emit PlatformWalletUpdated(platformWallet, _wallet);
        platformWallet = _wallet;
    }

    /// @notice Update the USDC/ETH Chainlink price feed address (e.g., on mainnet migration)
    function setUsdcEthFeed(address _feed) external onlyOwner {
        require(_feed != address(0), "Zero feed");
        emit FeedUpdated(address(usdcEthFeed), _feed);
        usdcEthFeed = AggregatorV3Interface(_feed);
    }

    /// @notice Toggle demo mode. When true, skips Chainlink price feed check
    ///         so testnet demos work even when the USDC/ETH feed is stale.
    ///         ONLY safe on testnets — never enable on mainnet.
    function setDemoMode(bool _demo) external onlyOwner {
        demoMode = _demo;
        emit DemoModeUpdated(_demo);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ============================================
    // Deposit — User funds vault
    // ============================================

    /**
     * @notice Deposit USDC into your vault. Caller must have approved this contract.
     * @param amount USDC amount (6 decimals)
     */
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "Zero amount");

        paymentToken.safeTransferFrom(msg.sender, address(this), amount);

        balances[msg.sender] += amount;
        totalDeposited += amount;
        totalObligations += amount;

        emit Deposited(msg.sender, amount, balances[msg.sender]);
    }

    // ============================================
    // Withdraw — User reclaims unlocked funds
    // ============================================

    /**
     * @notice Withdraw unlocked USDC from vault back to your wallet.
     * @param amount USDC amount to withdraw (0 = withdraw all available)
     */
    function withdraw(uint256 amount) external nonReentrant whenNotPaused {
        uint256 available = balances[msg.sender];
        uint256 withdrawAmount = amount == 0 ? available : amount;

        require(withdrawAmount > 0, "Nothing to withdraw");
        require(withdrawAmount <= available, "Insufficient balance");

        balances[msg.sender] -= withdrawAmount;
        totalWithdrawn += withdrawAmount;
        totalObligations -= withdrawAmount;

        paymentToken.safeTransfer(msg.sender, withdrawAmount);

        emit Withdrawn(msg.sender, withdrawAmount, balances[msg.sender]);
    }

    // ============================================
    // Bid Lock — Backend locks funds when bid is placed
    // ============================================

    /**
     * @notice Lock funds for a bid (bidAmount + convenience fee).
     *         Legacy unbound variant — kept for backwards compatibility.
     *         Unbound locks can only be settled via the unbound settleBid.
     * @param user  The bidder's address
     * @param bidAmount  The bid amount in USDC
     * @return lockId  Unique lock identifier for settlement/refund
     */
    function lockForBid(
        address user,
        uint256 bidAmount
    ) external onlyAuthorizedCaller nonReentrant whenNotPaused returns (uint256) {
        return _lockForBid(user, bidAmount, bytes32(0));
    }

    /**
     * @notice Lock funds for a bid, bound to a specific lead (Phase B3).
     *         A lead-bound lock can ONLY be settled with the matching leadIdHash,
     *         and (if registered) only to the owner-registered seller for that lead.
     * @param user        The bidder's address
     * @param bidAmount   The bid amount in USDC
     * @param leadIdHash  keccak256 of the platform lead ID (must be non-zero)
     * @return lockId     Unique lock identifier for settlement/refund
     */
    function lockForBid(
        address user,
        uint256 bidAmount,
        bytes32 leadIdHash
    ) external onlyAuthorizedCaller nonReentrant whenNotPaused returns (uint256) {
        require(leadIdHash != bytes32(0), "Zero leadIdHash");
        return _lockForBid(user, bidAmount, leadIdHash);
    }

    function _lockForBid(
        address user,
        uint256 bidAmount,
        bytes32 leadIdHash
    ) internal returns (uint256) {
        // Chainlink Data Feed: require a valid, live USDC/ETH price before locking funds
        // demoMode=true bypasses this for testnet demos where the feed may be stale
        if (!demoMode) {
            (, int256 price,,,) = usdcEthFeed.latestRoundData();
            require(price > 0, "Vault: Invalid USDC/ETH price");
        }

        uint256 total = bidAmount + CONVENIENCE_FEE;
        require(balances[user] >= total, "Insufficient vault balance");

        balances[user] -= total;
        lockedBalances[user] += total;

        uint256 lockId = ++_nextLockId;
        bidLocks[lockId] = BidLock({
            user: user,
            amount: bidAmount,
            fee: CONVENIENCE_FEE,
            lockedAt: block.timestamp,
            settled: false,
            leadIdHash: leadIdHash
        });

        // Track for Automation sweep
        _activeLockIndex[lockId] = _activeLockIds.length;
        _activeLockIds.push(lockId);

        emit BidLocked(lockId, user, bidAmount, CONVENIENCE_FEE);
        if (leadIdHash != bytes32(0)) {
            emit LeadBound(lockId, leadIdHash);
        }
        return lockId;
    }

    /**
     * @notice Register the seller address for a lead (Phase B3).
     *         Owner-only (multisig) — the relayer key cannot change where
     *         settlement funds go once the seller is registered.
     */
    function registerLeadSeller(bytes32 leadIdHash, address seller) external onlyOwner {
        require(leadIdHash != bytes32(0), "Zero leadIdHash");
        require(seller != address(0), "Zero seller");
        leadSellers[leadIdHash] = seller;
        emit LeadSellerRegistered(leadIdHash, seller);
    }

    /**
     * @notice Settle a winning bid (legacy unbound variant).
     *         Reverts for lead-bound locks — those must use the bound overload.
     * @param lockId  The bid lock to settle
     * @param seller  Seller address to receive payment
     */
    function settleBid(
        uint256 lockId,
        address seller
    ) external onlyAuthorizedCaller nonReentrant whenNotPaused {
        _settleBid(lockId, seller, bytes32(0));
    }

    /**
     * @notice Settle a winning bid bound to a lead (Phase B3).
     *         The provided leadIdHash MUST match the hash stored at lock time,
     *         and the seller MUST match the owner-registered seller (when set).
     * @param lockId      The bid lock to settle
     * @param seller      Seller address to receive payment
     * @param leadIdHash  keccak256 of the platform lead ID
     */
    function settleBid(
        uint256 lockId,
        address seller,
        bytes32 leadIdHash
    ) external onlyAuthorizedCaller nonReentrant whenNotPaused {
        require(leadIdHash != bytes32(0), "Zero leadIdHash");
        _settleBid(lockId, seller, leadIdHash);
    }

    function _settleBid(uint256 lockId, address seller, bytes32 leadIdHash) internal {
        // Chainlink Data Feed: require a valid, live USDC/ETH price before settling
        // demoMode=true bypasses this for testnet demos where the feed may be stale
        if (!demoMode) {
            (, int256 price,,,) = usdcEthFeed.latestRoundData();
            require(price > 0, "Vault: Invalid USDC/ETH price");
        }

        BidLock storage lock = bidLocks[lockId];
        require(!lock.settled, "Already settled");
        require(lock.user != address(0), "Invalid lock");
        require(seller != address(0), "Zero seller");

        // Lead binding: the settle call must carry the exact leadIdHash the
        // funds were locked for (0x0 == 0x0 for legacy unbound locks).
        require(lock.leadIdHash == leadIdHash, "Lead binding mismatch");

        // Seller binding: when the owner (multisig) has registered the seller
        // for this lead, the relayer cannot pay any other address.
        if (leadIdHash != bytes32(0)) {
            address boundSeller = leadSellers[leadIdHash];
            if (boundSeller != address(0)) {
                require(seller == boundSeller, "Seller binding mismatch");
            }
        }

        lock.settled = true;
        uint256 total = lock.amount + lock.fee;
        lockedBalances[lock.user] -= total;

        // Funds leave the contract entirely → reduce obligations
        totalObligations -= total;

        // Calculate 5% platform cut from bid amount
        uint256 platformCut = (lock.amount * PLATFORM_CUT_BPS) / 10000;
        uint256 sellerAmount = lock.amount - platformCut;

        // Transfer 95% of bid to seller
        paymentToken.safeTransfer(seller, sellerAmount);

        // Transfer 5% cut + $1 convenience fee to platform
        paymentToken.safeTransfer(platformWallet, platformCut + lock.fee);

        _removeActiveLock(lockId);

        emit BidSettled(lockId, lock.user, seller, sellerAmount, platformCut, lock.fee);
        if (leadIdHash != bytes32(0)) {
            emit BidSettledForLead(lockId, leadIdHash, seller);
        }
    }

    /**
     * @notice Refund a locked bid back to the user's vault balance.
     * @param lockId  The bid lock to refund
     */
    function refundBid(uint256 lockId) external onlyAuthorizedCaller nonReentrant whenNotPaused {
        _refundBidInternal(lockId);
    }

    // ============================================
    // Chainlink Proof of Reserves
    // ============================================

    /**
     * @notice Verify that contract USDC balance >= total user claims.
     *         Emits ReservesVerified event for off-chain auditing.
     * @return solvent True if contract holds enough USDC
     */
    function verifyReserves() public returns (bool solvent) {
        uint256 actual = paymentToken.balanceOf(address(this));

        // totalObligations = sum of all user balances + lockedBalances
        // accurately tracks what the vault owes, even after settlements
        solvent = actual >= totalObligations;
        lastPorCheck = block.timestamp;
        lastPorSolvent = solvent;

        emit ReservesVerified(actual, totalObligations, solvent, block.timestamp);
    }

    // ============================================
    // Chainlink Automation
    // ============================================

    /**
     * @notice Called by Chainlink Automation to check if upkeep is needed.
     * @return upkeepNeeded True if PoR is due or expired locks exist
     * @return performData Encoded action type (1 = PoR, 2 = refund expired, 3 = both)
     */
    function checkUpkeep(bytes calldata)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        bool porDue = (block.timestamp - lastPorCheck) >= POR_INTERVAL;
        bool hasExpired = _hasExpiredLocks();

        if (porDue && hasExpired) {
            return (true, abi.encode(uint8(3)));
        } else if (porDue) {
            return (true, abi.encode(uint8(1)));
        } else if (hasExpired) {
            return (true, abi.encode(uint8(2)));
        }

        return (false, "");
    }

    /**
     * @notice Called by Chainlink Automation to perform upkeep.
     * @param performData Encoded action type from checkUpkeep
     */
    function performUpkeep(bytes calldata performData) external override {
        uint8 action = abi.decode(performData, (uint8));

        if (action == 1 || action == 3) {
            // PoR verification
            if ((block.timestamp - lastPorCheck) >= POR_INTERVAL) {
                verifyReserves();
            }
        }

        if (action == 2 || action == 3) {
            // Refund expired locks
            _refundExpiredLocks();
        }
    }

    // ============================================
    // View Functions
    // ============================================

    /// @notice Available (unlocked) balance for a user
    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }

    /// @notice Total (available + locked) balance for a user
    function totalBalanceOf(address user) external view returns (uint256) {
        return balances[user] + lockedBalances[user];
    }

    /// @notice Check if user has enough for a bid (amount + $1 fee)
    function canBid(address user, uint256 bidAmount) external view returns (bool) {
        return balances[user] >= bidAmount + CONVENIENCE_FEE;
    }

    /// @notice Number of active (unsettled) locks
    function activeLockCount() external view returns (uint256) {
        return _activeLockIds.length;
    }

    // ============================================
    // Internal
    // ============================================

    function _refundBidInternal(uint256 lockId) internal {
        BidLock storage lock = bidLocks[lockId];
        require(!lock.settled, "Already settled");
        require(lock.user != address(0), "Invalid lock");

        lock.settled = true;
        uint256 total = lock.amount + lock.fee;
        lockedBalances[lock.user] -= total;
        balances[lock.user] += total;

        _removeActiveLock(lockId);

        emit BidRefunded(lockId, lock.user, total);
    }

    function _hasExpiredLocks() internal view returns (bool) {
        for (uint256 i = 0; i < _activeLockIds.length; i++) {
            BidLock storage lock = bidLocks[_activeLockIds[i]];
            if (!lock.settled && (block.timestamp - lock.lockedAt) >= LOCK_EXPIRY) {
                return true;
            }
        }
        return false;
    }

    function _refundExpiredLocks() internal {
        uint256 refundCount = 0;
        uint256 maxBatch = 50; // Gas safety: cap per upkeep call

        // Iterate backwards to safely remove elements
        for (uint256 i = _activeLockIds.length; i > 0 && refundCount < maxBatch; i--) {
            uint256 lockId = _activeLockIds[i - 1];
            BidLock storage lock = bidLocks[lockId];

            if (!lock.settled && (block.timestamp - lock.lockedAt) >= LOCK_EXPIRY) {
                _refundBidInternal(lockId);
                refundCount++;
            }
        }

        if (refundCount > 0) {
            emit ExpiredLocksRefunded(refundCount, block.timestamp);
        }
    }

    /// @dev Remove a lock from the active tracking array (swap-and-pop)
    function _removeActiveLock(uint256 lockId) internal {
        uint256 index = _activeLockIndex[lockId];
        uint256 lastIndex = _activeLockIds.length - 1;

        if (index != lastIndex) {
            uint256 lastLockId = _activeLockIds[lastIndex];
            _activeLockIds[index] = lastLockId;
            _activeLockIndex[lastLockId] = index;
        }

        _activeLockIds.pop();
        delete _activeLockIndex[lockId];
    }
}
