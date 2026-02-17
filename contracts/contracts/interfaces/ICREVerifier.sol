// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICREVerifier
 * @dev Interface for CRE off-chain verification via Chainlink Functions
 * @notice Handles parameter matching, geo validation, and lead quality scoring
 */
interface ICREVerifier {
    // Enums
    enum VerificationType { PARAMETER_MATCH, GEO_VALIDATION, QUALITY_SCORE, ZK_PROOF }
    enum RequestStatus { PENDING, FULFILLED, FAILED, TIMEOUT }

    // Structs
    struct VerificationRequest {
        bytes32 requestId;
        VerificationType verificationType;
        uint256 leadTokenId;
        address requester;
        uint40 requestedAt;
        uint40 fulfilledAt;
        RequestStatus status;
        bytes32 resultHash;
    }

    struct MatchParameters {
        bytes32 vertical;
        bytes32 geoHash;
        uint96 minBudget;
        uint96 maxBudget;
        bool acceptOffsite;
        bytes32[] requiredAttributes;
    }

    // Events
    event VerificationRequested(
        bytes32 indexed requestId,
        uint256 indexed leadTokenId,
        VerificationType verificationType,
        address indexed requester
    );

    event VerificationFulfilled(
        bytes32 indexed requestId,
        bool success,
        bytes32 resultHash
    );

    event VerificationFailed(
        bytes32 indexed requestId,
        bytes32 reason
    );

    // Request Functions
    function requestParameterMatch(
        uint256 leadTokenId,
        MatchParameters calldata buyerParams
    ) external returns (bytes32 requestId);

    function requestGeoValidation(
        uint256 leadTokenId,
        bytes32 expectedGeoHash,
        uint8 precision           // Geohash precision level
    ) external returns (bytes32 requestId);

    function requestQualityScore(
        uint256 leadTokenId
    ) external returns (bytes32 requestId);

    function requestZKProofVerification(
        uint256 leadTokenId,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external returns (bytes32 requestId);

    // Result Functions
    function getVerificationResult(
        bytes32 requestId
    ) external view returns (VerificationRequest memory);

    function isVerificationValid(
        bytes32 requestId
    ) external view returns (bool);

    function getLeadQualityScore(
        uint256 leadTokenId
    ) external view returns (uint16);  // 0-10000

    function computeQualityScoreFromParams(
        uint40 tcpaConsentTimestamp,
        bool hasGeoState,
        bool hasGeoZip,
        bool zipMatchesState,
        bool hasEncryptedData,
        bool encryptedDataValid,
        uint8 parameterCount,
        uint8 sourceType          // 0=API, 1=FORM, 2=PLATFORM, 3=OTHER
    ) external pure returns (uint16);  // 0-10000

    // Batch Operations
    function batchRequestParameterMatch(
        uint256[] calldata leadTokenIds,
        MatchParameters calldata buyerParams
    ) external returns (bytes32[] memory requestIds);

    // Admin
    function setChainlinkSubscription(uint64 subscriptionId) external;
    function setGasLimit(uint32 gasLimit) external;
}
