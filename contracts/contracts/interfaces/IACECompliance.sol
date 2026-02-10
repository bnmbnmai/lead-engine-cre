// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IACECompliance
 * @dev Interface for Automated Compliance Engine
 * @notice Handles KYC verification, jurisdictional checks, and policy enforcement
 */
interface IACECompliance {
    // Enums
    enum ComplianceStatus { UNCHECKED, PENDING, APPROVED, REJECTED, EXPIRED }
    enum CheckType { KYC, AML, TCPA, GEO, FRAUD }

    // Structs
    struct UserCompliance {
        ComplianceStatus kycStatus;
        ComplianceStatus amlStatus;
        bytes32 jurisdictionHash;      // Hashed jurisdiction for privacy
        uint40 kycExpiresAt;
        uint40 lastChecked;
        uint16 reputationScore;        // 0-10000 (basis points)
        bool isBlacklisted;
    }

    struct ComplianceResult {
        bool passed;
        CheckType failedCheck;
        bytes32 reason;                // Hashed reason for privacy
    }

    // Events
    event UserVerified(
        address indexed user,
        CheckType checkType,
        ComplianceStatus status
    );

    event JurisdictionUpdated(
        address indexed user,
        bytes32 indexed oldJurisdiction,
        bytes32 indexed newJurisdiction
    );

    event UserBlacklisted(address indexed user, bytes32 reason);
    event PolicyUpdated(bytes32 indexed policyId, bool active);

    // KYC Functions
    function verifyKYC(
        address user,
        bytes32 proofHash,
        bytes calldata zkProof
    ) external returns (bool);

    function checkKYCStatus(address user) external view returns (ComplianceStatus);
    function isKYCValid(address user) external view returns (bool);

    // Jurisdictional Functions
    function setUserJurisdiction(
        address user,
        bytes32 jurisdictionHash
    ) external;

    function isJurisdictionAllowed(
        bytes32 jurisdictionHash,
        bytes32 vertical
    ) external view returns (bool);

    function checkGeoCompliance(
        address user,
        bytes32 leadGeoHash,
        bytes32 vertical
    ) external view returns (bool);

    // Policy Functions
    function checkFullCompliance(
        address seller,
        address buyer,
        uint256 leadTokenId
    ) external view returns (ComplianceResult memory);

    function canTransact(
        address user,
        bytes32 vertical,
        bytes32 geoHash
    ) external view returns (bool);

    // Reputation
    function getReputationScore(address user) external view returns (uint16);
    function updateReputationScore(address user, int16 delta) external;

    // Admin
    function blacklistUser(address user, bytes32 reason) external;
    function unblacklistUser(address user) external;
    function setJurisdictionPolicy(bytes32 jurisdiction, bytes32 vertical, bool allowed) external;
}
