// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IACECompliance.sol";

/**
 * @title ACECompliance
 * @dev Automated Compliance Engine for Lead Engine
 * @notice Handles KYC/AML verification, jurisdictional policies, and reputation
 */
contract ACECompliance is IACECompliance, Ownable, ReentrancyGuard {
    // ============================================
    // State Variables
    // ============================================
    
    // User => Compliance data
    mapping(address => UserCompliance) private _userCompliance;
    
    // Jurisdiction => Vertical => Allowed
    mapping(bytes32 => mapping(bytes32 => bool)) private _jurisdictionPolicy;
    
    // Default policy for jurisdictions not explicitly set
    mapping(bytes32 => bool) private _defaultVerticalPolicy;
    
    // Blocked jurisdictions (global blocklist)
    mapping(bytes32 => bool) public blockedJurisdictions;
    
    // Authorized verifiers (backend, oracles, ZK verifiers)
    mapping(address => bool) public authorizedVerifiers;
    
    // KYC expiry duration (default 1 year)
    uint40 public kycValidityPeriod = 365 days;
    
    // Minimum reputation score to transact (basis points, 0-10000)
    uint16 public minReputationScore = 1000;  // 10%
    
    // ============================================
    // Events (additional to interface)
    // ============================================
    
    event VerifierAuthorized(address indexed verifier, bool authorized);
    event KYCValidityUpdated(uint40 newPeriod);
    event MinReputationUpdated(uint16 newMinScore);

    // ============================================
    // Constructor
    // ============================================
    
    constructor(address initialOwner) Ownable(initialOwner) {}

    // ============================================
    // Modifiers
    // ============================================
    
    modifier onlyVerifier() {
        require(
            authorizedVerifiers[msg.sender] || msg.sender == owner(),
            "ACE: Not authorized verifier"
        );
        _;
    }

    // ============================================
    // Admin Functions
    // ============================================

    function setAuthorizedVerifier(address verifier, bool authorized) external onlyOwner {
        authorizedVerifiers[verifier] = authorized;
        emit VerifierAuthorized(verifier, authorized);
    }
    
    function setKYCValidityPeriod(uint40 period) external onlyOwner {
        kycValidityPeriod = period;
        emit KYCValidityUpdated(period);
    }
    
    function setMinReputationScore(uint16 minScore) external onlyOwner {
        require(minScore <= 10000, "ACE: Invalid score");
        minReputationScore = minScore;
        emit MinReputationUpdated(minScore);
    }
    
    function setBlockedJurisdiction(bytes32 jurisdiction, bool blocked) external onlyOwner {
        blockedJurisdictions[jurisdiction] = blocked;
    }

    // ============================================
    // KYC Functions
    // ============================================

    function verifyKYC(
        address user,
        bytes32 proofHash,
        bytes calldata /* zkProof */
    ) external onlyVerifier returns (bool) {
        // In production, this would verify the ZK proof
        // For now, we trust the authorized verifier's attestation
        require(proofHash != bytes32(0), "ACE: Invalid proof");
        
        UserCompliance storage compliance = _userCompliance[user];
        compliance.kycStatus = ComplianceStatus.APPROVED;
        compliance.kycExpiresAt = uint40(block.timestamp) + kycValidityPeriod;
        compliance.lastChecked = uint40(block.timestamp);
        
        // Initialize reputation if new user
        if (compliance.reputationScore == 0) {
            compliance.reputationScore = 5000;  // Start at 50%
        }
        
        emit UserVerified(user, CheckType.KYC, ComplianceStatus.APPROVED);
        
        return true;
    }

    function checkKYCStatus(address user) external view returns (ComplianceStatus) {
        UserCompliance storage compliance = _userCompliance[user];
        
        if (compliance.kycStatus != ComplianceStatus.APPROVED) {
            return compliance.kycStatus;
        }
        
        // Check if expired
        if (block.timestamp > compliance.kycExpiresAt) {
            return ComplianceStatus.EXPIRED;
        }
        
        return ComplianceStatus.APPROVED;
    }

    function isKYCValid(address user) external view returns (bool) {
        UserCompliance storage compliance = _userCompliance[user];
        return compliance.kycStatus == ComplianceStatus.APPROVED &&
               block.timestamp <= compliance.kycExpiresAt &&
               !compliance.isBlacklisted;
    }

    // ============================================
    // Jurisdictional Functions
    // ============================================

    function setUserJurisdiction(
        address user,
        bytes32 jurisdictionHash
    ) external onlyVerifier {
        bytes32 oldJurisdiction = _userCompliance[user].jurisdictionHash;
        _userCompliance[user].jurisdictionHash = jurisdictionHash;
        emit JurisdictionUpdated(user, oldJurisdiction, jurisdictionHash);
    }

    function setJurisdictionPolicy(
        bytes32 jurisdiction,
        bytes32 vertical,
        bool allowed
    ) external onlyOwner {
        _jurisdictionPolicy[jurisdiction][vertical] = allowed;
        emit PolicyUpdated(keccak256(abi.encodePacked(jurisdiction, vertical)), allowed);
    }
    
    function setDefaultVerticalPolicy(bytes32 vertical, bool allowed) external onlyOwner {
        _defaultVerticalPolicy[vertical] = allowed;
    }

    function isJurisdictionAllowed(
        bytes32 jurisdictionHash,
        bytes32 vertical
    ) external view returns (bool) {
        // Check global blocklist
        if (blockedJurisdictions[jurisdictionHash]) {
            return false;
        }
        
        // Check specific policy
        if (_jurisdictionPolicy[jurisdictionHash][vertical]) {
            return true;
        }
        
        // Fall back to default
        return _defaultVerticalPolicy[vertical];
    }

    function checkGeoCompliance(
        address user,
        bytes32 leadGeoHash,
        bytes32 vertical
    ) external view returns (bool) {
        UserCompliance storage compliance = _userCompliance[user];
        
        // Check if user's jurisdiction can access this vertical
        if (blockedJurisdictions[compliance.jurisdictionHash]) {
            return false;
        }
        
        // Check if lead's geo is in blocked jurisdiction
        if (blockedJurisdictions[leadGeoHash]) {
            return false;
        }
        
        // Check vertical policy for user's jurisdiction
        if (!_jurisdictionPolicy[compliance.jurisdictionHash][vertical] &&
            !_defaultVerticalPolicy[vertical]) {
            return false;
        }
        
        return true;
    }

    // ============================================
    // Full Compliance Check
    // ============================================

    function checkFullCompliance(
        address seller,
        address buyer,
        uint256 /* leadTokenId */
    ) external view returns (ComplianceResult memory) {
        // Check seller compliance
        UserCompliance storage sellerCompliance = _userCompliance[seller];
        if (sellerCompliance.isBlacklisted) {
            return ComplianceResult({
                passed: false,
                failedCheck: CheckType.FRAUD,
                reason: keccak256("Seller blacklisted")
            });
        }
        
        // Check buyer compliance
        UserCompliance storage buyerCompliance = _userCompliance[buyer];
        if (buyerCompliance.isBlacklisted) {
            return ComplianceResult({
                passed: false,
                failedCheck: CheckType.FRAUD,
                reason: keccak256("Buyer blacklisted")
            });
        }
        
        // Check KYC
        if (sellerCompliance.kycStatus != ComplianceStatus.APPROVED ||
            block.timestamp > sellerCompliance.kycExpiresAt) {
            return ComplianceResult({
                passed: false,
                failedCheck: CheckType.KYC,
                reason: keccak256("Seller KYC invalid")
            });
        }
        
        if (buyerCompliance.kycStatus != ComplianceStatus.APPROVED ||
            block.timestamp > buyerCompliance.kycExpiresAt) {
            return ComplianceResult({
                passed: false,
                failedCheck: CheckType.KYC,
                reason: keccak256("Buyer KYC invalid")
            });
        }
        
        // Check reputation
        if (sellerCompliance.reputationScore < minReputationScore) {
            return ComplianceResult({
                passed: false,
                failedCheck: CheckType.FRAUD,
                reason: keccak256("Seller reputation too low")
            });
        }
        
        return ComplianceResult({
            passed: true,
            failedCheck: CheckType.KYC,  // Unused when passed
            reason: bytes32(0)
        });
    }

    function canTransact(
        address user,
        bytes32 vertical,
        bytes32 geoHash
    ) external view returns (bool) {
        UserCompliance storage compliance = _userCompliance[user];
        
        // Basic checks
        if (compliance.isBlacklisted) return false;
        if (compliance.kycStatus != ComplianceStatus.APPROVED) return false;
        if (block.timestamp > compliance.kycExpiresAt) return false;
        if (compliance.reputationScore < minReputationScore) return false;
        
        // Jurisdiction checks
        if (blockedJurisdictions[compliance.jurisdictionHash]) return false;
        if (blockedJurisdictions[geoHash]) return false;
        
        // Vertical policy
        if (!_jurisdictionPolicy[compliance.jurisdictionHash][vertical] &&
            !_defaultVerticalPolicy[vertical]) {
            return false;
        }
        
        return true;
    }

    // ============================================
    // Reputation Functions
    // ============================================

    function getReputationScore(address user) external view returns (uint16) {
        return _userCompliance[user].reputationScore;
    }

    function updateReputationScore(address user, int16 delta) external onlyVerifier {
        UserCompliance storage compliance = _userCompliance[user];
        
        int32 newScore = int32(uint32(compliance.reputationScore)) + int32(delta);
        
        if (newScore < 0) {
            compliance.reputationScore = 0;
        } else if (newScore > 10000) {
            compliance.reputationScore = 10000;
        } else {
            compliance.reputationScore = uint16(uint32(newScore));
        }
    }

    // ============================================
    // Blacklist Functions
    // ============================================

    function blacklistUser(address user, bytes32 reason) external onlyVerifier {
        _userCompliance[user].isBlacklisted = true;
        emit UserBlacklisted(user, reason);
    }

    function unblacklistUser(address user) external onlyOwner {
        _userCompliance[user].isBlacklisted = false;
    }

    // ============================================
    // View Functions
    // ============================================
    
    function getUserCompliance(address user) external view returns (UserCompliance memory) {
        return _userCompliance[user];
    }
}
