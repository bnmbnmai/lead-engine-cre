// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";

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

    /// @notice Global total deposits (for PoR verification)
    uint256 public totalDeposited;

    /// @notice Global total withdrawn
    uint256 public totalWithdrawn;

    /// @notice Authorized callers (backend service)
    mapping(address => bool) public authorizedCallers;

    // ── Bid Locks ──

    struct BidLock {
        address user;
        uint256 amount;      // bid amount (excl. fee)
        uint256 fee;         // convenience fee
        uint256 lockedAt;
        bool    settled;     // true if settled or refunded
    }

    uint256 private _nextLockId;
    mapping(uint256 => BidLock) public bidLocks;

    /// @dev Track active (unsettled) lock IDs for Automation sweep
    uint256[] private _activeLockIds;
    mapping(uint256 => uint256) private _activeLockIndex; // lockId => index in _activeLockIds

    // ── Proof of Reserves ──

    uint256 public lastPorCheck;
    bool    public lastPorSolvent;

    // ============================================
    // Events
    // ============================================

    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event BidLocked(uint256 indexed lockId, address indexed user, uint256 bidAmount, uint256 fee);
    event BidSettled(uint256 indexed lockId, address indexed winner, address indexed seller, uint256 amount, uint256 fee);
    event BidRefunded(uint256 indexed lockId, address indexed user, uint256 totalRefunded);
    event ReservesVerified(uint256 contractBalance, uint256 claimedTotal, bool solvent, uint256 timestamp);
    event ExpiredLocksRefunded(uint256 count, uint256 timestamp);
    event CallerAuthorized(address indexed caller, bool authorized);
    event PlatformWalletUpdated(address indexed oldWallet, address indexed newWallet);

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

        paymentToken.safeTransfer(msg.sender, withdrawAmount);

        emit Withdrawn(msg.sender, withdrawAmount, balances[msg.sender]);
    }

    // ============================================
    // Bid Lock — Backend locks funds when bid is placed
    // ============================================

    /**
     * @notice Lock funds for a bid (bidAmount + convenience fee).
     *         Called by authorized backend when a bid is accepted.
     * @param user  The bidder's address
     * @param bidAmount  The bid amount in USDC
     * @return lockId  Unique lock identifier for settlement/refund
     */
    function lockForBid(
        address user,
        uint256 bidAmount
    ) external onlyAuthorizedCaller nonReentrant whenNotPaused returns (uint256) {
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
            settled: false
        });

        // Track for Automation sweep
        _activeLockIndex[lockId] = _activeLockIds.length;
        _activeLockIds.push(lockId);

        emit BidLocked(lockId, user, bidAmount, CONVENIENCE_FEE);
        return lockId;
    }

    /**
     * @notice Settle a winning bid: transfer bid amount to seller, fee to platform.
     * @param lockId  The bid lock to settle
     * @param seller  Seller address to receive payment
     */
    function settleBid(
        uint256 lockId,
        address seller
    ) external onlyAuthorizedCaller nonReentrant whenNotPaused {
        BidLock storage lock = bidLocks[lockId];
        require(!lock.settled, "Already settled");
        require(lock.user != address(0), "Invalid lock");
        require(seller != address(0), "Zero seller");

        lock.settled = true;
        uint256 total = lock.amount + lock.fee;
        lockedBalances[lock.user] -= total;

        // Update PoR accounting: funds leaving the contract reduce the claimed total
        totalDeposited -= total;

        // Transfer bid amount to seller
        paymentToken.safeTransfer(seller, lock.amount);

        // Transfer convenience fee to platform
        paymentToken.safeTransfer(platformWallet, lock.fee);

        _removeActiveLock(lockId);

        emit BidSettled(lockId, lock.user, seller, lock.amount, lock.fee);
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
        uint256 claimed = totalDeposited - totalWithdrawn;

        solvent = actual >= claimed;
        lastPorCheck = block.timestamp;
        lastPorSolvent = solvent;

        emit ReservesVerified(actual, claimed, solvent, block.timestamp);
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
