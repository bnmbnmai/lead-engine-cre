// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RTBEscrow
 * @dev Escrow contract for RTB lead payments using USDC
 * @notice Handles bid deposits, winner selection, and fund release
 */
contract RTBEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // USDC token contract
    IERC20 public immutable paymentToken;
    
    // Platform fee (basis points, e.g., 250 = 2.5%)
    uint256 public platformFeeBps;
    
    // Fee recipient
    address public feeRecipient;
    
    // Escrow states
    enum EscrowState { Created, Funded, Released, Refunded, Disputed }
    
    // Escrow record
    struct Escrow {
        string leadId;
        address seller;
        address buyer;
        uint256 amount;
        uint256 platformFee;
        uint256 createdAt;
        uint256 releaseTime;
        EscrowState state;
    }
    
    // Escrow ID counter
    uint256 private _nextEscrowId;
    
    // Mapping from escrow ID to escrow data
    mapping(uint256 => Escrow) public escrows;
    
    // Mapping from lead ID to escrow ID
    mapping(string => uint256) public leadToEscrow;
    
    // Authorized callers (backend service)
    mapping(address => bool) public authorizedCallers;
    
    // Release delay for disputes (default 24 hours)
    uint256 public releaseDelay = 24 hours;
    
    // Events
    event EscrowCreated(
        uint256 indexed escrowId,
        string leadId,
        address indexed seller,
        address indexed buyer,
        uint256 amount
    );
    
    event EscrowFunded(uint256 indexed escrowId, uint256 amount);
    event EscrowReleased(uint256 indexed escrowId, address seller, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, address buyer, uint256 amount);
    event EscrowDisputed(uint256 indexed escrowId, address disputant);
    event CallerAuthorized(address indexed caller, bool authorized);
    event PlatformFeeUpdated(uint256 newFeeBps);

    constructor(
        address _paymentToken,
        address _feeRecipient,
        uint256 _platformFeeBps,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_paymentToken != address(0), "Invalid token address");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        require(_platformFeeBps <= 1000, "Fee too high"); // Max 10%
        
        paymentToken = IERC20(_paymentToken);
        feeRecipient = _feeRecipient;
        platformFeeBps = _platformFeeBps;
    }
    
    modifier onlyAuthorizedCaller() {
        require(
            authorizedCallers[msg.sender] || msg.sender == owner(),
            "RTBEscrow: Not authorized"
        );
        _;
    }

    /**
     * @dev Set authorized caller status
     */
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit CallerAuthorized(caller, authorized);
    }

    /**
     * @dev Update platform fee (max 10%)
     */
    function setPlatformFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 1000, "Fee too high");
        platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(newFeeBps);
    }

    /**
     * @dev Create and fund an escrow for a winning bid
     * @param leadId Platform lead ID
     * @param seller The lead seller
     * @param buyer The winning bidder
     * @param amount The bid amount
     */
    function createEscrow(
        string calldata leadId,
        address seller,
        address buyer,
        uint256 amount
    ) external onlyAuthorizedCaller nonReentrant returns (uint256) {
        require(leadToEscrow[leadId] == 0, "Escrow exists for lead");
        require(seller != address(0) && buyer != address(0), "Invalid addresses");
        require(amount > 0, "Amount must be positive");
        
        uint256 escrowId = ++_nextEscrowId;
        uint256 fee = (amount * platformFeeBps) / 10000;
        
        escrows[escrowId] = Escrow({
            leadId: leadId,
            seller: seller,
            buyer: buyer,
            amount: amount,
            platformFee: fee,
            createdAt: block.timestamp,
            releaseTime: block.timestamp + releaseDelay,
            state: EscrowState.Created
        });
        
        leadToEscrow[leadId] = escrowId;
        
        emit EscrowCreated(escrowId, leadId, seller, buyer, amount);
        
        return escrowId;
    }

    /**
     * @dev Fund an escrow (buyer deposits funds)
     * @param escrowId The escrow ID to fund
     */
    function fundEscrow(uint256 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.state == EscrowState.Created, "Invalid escrow state");
        require(msg.sender == escrow.buyer, "Only buyer can fund");
        
        escrow.state = EscrowState.Funded;
        
        paymentToken.safeTransferFrom(msg.sender, address(this), escrow.amount);
        
        emit EscrowFunded(escrowId, escrow.amount);
    }

    /**
     * @dev Create AND fund an escrow in a single transaction (single-signature flow).
     *      Buyer must have pre-approved this contract for (amount + convenienceFee).
     * @param leadId Platform lead ID
     * @param seller The lead seller
     * @param amount The bid amount (in USDC wei)
     * @param convenienceFee Optional flat fee sent directly to feeRecipient (0 if none)
     */
    function createAndFundEscrow(
        string calldata leadId,
        address seller,
        uint256 amount,
        uint256 convenienceFee
    ) external nonReentrant returns (uint256) {
        require(leadToEscrow[leadId] == 0, "Escrow exists for lead");
        require(seller != address(0), "Invalid seller");
        require(amount > 0, "Amount must be positive");

        uint256 escrowId = ++_nextEscrowId;
        uint256 fee = (amount * platformFeeBps) / 10000;

        escrows[escrowId] = Escrow({
            leadId: leadId,
            seller: seller,
            buyer: msg.sender,
            amount: amount,
            platformFee: fee,
            createdAt: block.timestamp,
            releaseTime: block.timestamp + releaseDelay,
            state: EscrowState.Funded  // Already funded atomically
        });

        leadToEscrow[leadId] = escrowId;

        // Transfer bid amount from buyer to escrow
        paymentToken.safeTransferFrom(msg.sender, address(this), amount);

        // Transfer convenience fee directly to feeRecipient
        if (convenienceFee > 0) {
            paymentToken.safeTransferFrom(msg.sender, feeRecipient, convenienceFee);
        }

        emit EscrowCreated(escrowId, leadId, seller, msg.sender, amount);
        emit EscrowFunded(escrowId, amount);

        return escrowId;
    }

    /**
     * @dev Release funds to seller after release delay
     * @param escrowId The escrow ID to release
     */
    function releaseEscrow(uint256 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.state == EscrowState.Funded, "Not funded");
        require(
            block.timestamp >= escrow.releaseTime || 
            msg.sender == owner() ||
            authorizedCallers[msg.sender],
            "Release delay not passed"
        );
        
        escrow.state = EscrowState.Released;
        
        uint256 sellerAmount = escrow.amount - escrow.platformFee;
        
        // Transfer to seller
        paymentToken.safeTransfer(escrow.seller, sellerAmount);
        
        // Transfer fee to platform
        if (escrow.platformFee > 0) {
            paymentToken.safeTransfer(feeRecipient, escrow.platformFee);
        }
        
        emit EscrowReleased(escrowId, escrow.seller, sellerAmount);
    }

    /**
     * @dev Refund buyer (for disputes or failed delivery)
     * @param escrowId The escrow ID to refund
     */
    function refundEscrow(uint256 escrowId) external onlyAuthorizedCaller nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(
            escrow.state == EscrowState.Funded || 
            escrow.state == EscrowState.Disputed,
            "Cannot refund"
        );
        
        escrow.state = EscrowState.Refunded;
        
        paymentToken.safeTransfer(escrow.buyer, escrow.amount);
        
        emit EscrowRefunded(escrowId, escrow.buyer, escrow.amount);
    }

    /**
     * @dev Mark escrow as disputed
     * @param escrowId The escrow ID to dispute
     */
    function disputeEscrow(uint256 escrowId) external {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.state == EscrowState.Funded, "Cannot dispute");
        require(
            msg.sender == escrow.buyer || 
            msg.sender == escrow.seller,
            "Not party to escrow"
        );
        
        escrow.state = EscrowState.Disputed;
        
        emit EscrowDisputed(escrowId, msg.sender);
    }

    /**
     * @dev Get escrow details
     */
    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }
}
