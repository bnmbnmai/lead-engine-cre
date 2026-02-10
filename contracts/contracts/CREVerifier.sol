// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ICREVerifier.sol";
import "./interfaces/ILeadNFT.sol";

/**
 * @title CREVerifier
 * @dev Off-chain verification via Chainlink Functions
 * @notice Handles parameter matching, geo validation, and quality scoring
 */
contract CREVerifier is ICREVerifier, FunctionsClient, Ownable {
    using FunctionsRequest for FunctionsRequest.Request;

    // ============================================
    // State Variables
    // ============================================
    
    ILeadNFT public leadNFT;
    
    // Chainlink Functions config
    bytes32 public donId;
    uint64 public subscriptionId;
    uint32 public gasLimit = 300000;
    
    // Request tracking
    mapping(bytes32 => VerificationRequest) private _requests;
    mapping(uint256 => uint16) private _leadQualityScores;  // Token ID => Score
    
    // Source code for Chainlink Functions
    string private _parameterMatchSource;
    string private _geoValidationSource;
    string private _qualityScoreSource;
    
    // ============================================
    // Events (additional to interface)
    // ============================================
    
    event SourceCodeUpdated(VerificationType verificationType);
    event ConfigUpdated(bytes32 donId, uint64 subscriptionId, uint32 gasLimit);

    // ============================================
    // Constructor
    // ============================================
    
    constructor(
        address router,
        bytes32 _donId,
        uint64 _subscriptionId,
        address _leadNFT,
        address initialOwner
    ) FunctionsClient(router) Ownable(initialOwner) {
        donId = _donId;
        subscriptionId = _subscriptionId;
        leadNFT = ILeadNFT(_leadNFT);
    }

    // ============================================
    // Admin Functions
    // ============================================

    function setChainlinkSubscription(uint64 _subscriptionId) external onlyOwner {
        subscriptionId = _subscriptionId;
    }
    
    function setGasLimit(uint32 _gasLimit) external onlyOwner {
        gasLimit = _gasLimit;
    }
    
    function setConfig(
        bytes32 _donId,
        uint64 _subscriptionId,
        uint32 _gasLimit
    ) external onlyOwner {
        donId = _donId;
        subscriptionId = _subscriptionId;
        gasLimit = _gasLimit;
        emit ConfigUpdated(_donId, _subscriptionId, _gasLimit);
    }
    
    function setLeadNFT(address _leadNFT) external onlyOwner {
        leadNFT = ILeadNFT(_leadNFT);
    }
    
    function setSourceCode(
        VerificationType verificationType,
        string calldata sourceCode
    ) external onlyOwner {
        if (verificationType == VerificationType.PARAMETER_MATCH) {
            _parameterMatchSource = sourceCode;
        } else if (verificationType == VerificationType.GEO_VALIDATION) {
            _geoValidationSource = sourceCode;
        } else if (verificationType == VerificationType.QUALITY_SCORE) {
            _qualityScoreSource = sourceCode;
        }
        emit SourceCodeUpdated(verificationType);
    }

    // ============================================
    // Request Functions
    // ============================================

    function requestParameterMatch(
        uint256 leadTokenId,
        MatchParameters calldata buyerParams
    ) external returns (bytes32 requestId) {
        require(bytes(_parameterMatchSource).length > 0, "CRE: Source not set");
        
        // Build request
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(_parameterMatchSource);
        
        // Encode args
        string[] memory args = new string[](5);
        args[0] = _bytes32ToString(buyerParams.vertical);
        args[1] = _bytes32ToString(buyerParams.geoHash);
        args[2] = _uint256ToString(buyerParams.minBudget);
        args[3] = _uint256ToString(buyerParams.maxBudget);
        args[4] = buyerParams.acceptOffsite ? "true" : "false";
        req.setArgs(args);
        
        // Send request
        requestId = _sendRequest(
            req.encodeCBOR(),
            subscriptionId,
            gasLimit,
            donId
        );
        
        _requests[requestId] = VerificationRequest({
            requestId: requestId,
            verificationType: VerificationType.PARAMETER_MATCH,
            leadTokenId: leadTokenId,
            requester: msg.sender,
            requestedAt: uint40(block.timestamp),
            fulfilledAt: 0,
            status: RequestStatus.PENDING,
            resultHash: bytes32(0)
        });
        
        emit VerificationRequested(
            requestId,
            leadTokenId,
            VerificationType.PARAMETER_MATCH,
            msg.sender
        );
        
        return requestId;
    }

    function requestGeoValidation(
        uint256 leadTokenId,
        bytes32 expectedGeoHash,
        uint8 precision
    ) external returns (bytes32 requestId) {
        require(bytes(_geoValidationSource).length > 0, "CRE: Source not set");
        
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(_geoValidationSource);
        
        string[] memory args = new string[](3);
        args[0] = _uint256ToString(leadTokenId);
        args[1] = _bytes32ToString(expectedGeoHash);
        args[2] = _uint256ToString(precision);
        req.setArgs(args);
        
        requestId = _sendRequest(
            req.encodeCBOR(),
            subscriptionId,
            gasLimit,
            donId
        );
        
        _requests[requestId] = VerificationRequest({
            requestId: requestId,
            verificationType: VerificationType.GEO_VALIDATION,
            leadTokenId: leadTokenId,
            requester: msg.sender,
            requestedAt: uint40(block.timestamp),
            fulfilledAt: 0,
            status: RequestStatus.PENDING,
            resultHash: bytes32(0)
        });
        
        emit VerificationRequested(
            requestId,
            leadTokenId,
            VerificationType.GEO_VALIDATION,
            msg.sender
        );
        
        return requestId;
    }

    function requestQualityScore(
        uint256 leadTokenId
    ) external returns (bytes32 requestId) {
        require(bytes(_qualityScoreSource).length > 0, "CRE: Source not set");
        
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(_qualityScoreSource);
        
        string[] memory args = new string[](1);
        args[0] = _uint256ToString(leadTokenId);
        req.setArgs(args);
        
        requestId = _sendRequest(
            req.encodeCBOR(),
            subscriptionId,
            gasLimit,
            donId
        );
        
        _requests[requestId] = VerificationRequest({
            requestId: requestId,
            verificationType: VerificationType.QUALITY_SCORE,
            leadTokenId: leadTokenId,
            requester: msg.sender,
            requestedAt: uint40(block.timestamp),
            fulfilledAt: 0,
            status: RequestStatus.PENDING,
            resultHash: bytes32(0)
        });
        
        emit VerificationRequested(
            requestId,
            leadTokenId,
            VerificationType.QUALITY_SCORE,
            msg.sender
        );
        
        return requestId;
    }

    function requestZKProofVerification(
        uint256 leadTokenId,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external returns (bytes32 requestId) {
        // For ZK proofs, we generate a deterministic request ID
        requestId = keccak256(abi.encodePacked(
            leadTokenId,
            proof,
            publicInputs,
            block.timestamp
        ));
        
        _requests[requestId] = VerificationRequest({
            requestId: requestId,
            verificationType: VerificationType.ZK_PROOF,
            leadTokenId: leadTokenId,
            requester: msg.sender,
            requestedAt: uint40(block.timestamp),
            fulfilledAt: 0,
            status: RequestStatus.PENDING,
            resultHash: bytes32(0)
        });
        
        emit VerificationRequested(
            requestId,
            leadTokenId,
            VerificationType.ZK_PROOF,
            msg.sender
        );
        
        // ZK verification would be handled off-chain and fulfilled via oracle
        
        return requestId;
    }

    // ============================================
    // Chainlink Functions Callback
    // ============================================

    function fulfillRequest(
        bytes32 requestId,
        bytes memory response,
        bytes memory err
    ) internal override {
        VerificationRequest storage request = _requests[requestId];
        require(request.requestedAt != 0, "CRE: Unknown request");
        
        request.fulfilledAt = uint40(block.timestamp);
        
        if (err.length > 0) {
            request.status = RequestStatus.FAILED;
            emit VerificationFailed(requestId, keccak256(err));
            return;
        }
        
        request.status = RequestStatus.FULFILLED;
        request.resultHash = keccak256(response);
        
        // Process based on verification type
        if (request.verificationType == VerificationType.QUALITY_SCORE) {
            // Decode quality score from response
            uint16 score = abi.decode(response, (uint16));
            _leadQualityScores[request.leadTokenId] = score;
        }
        
        emit VerificationFulfilled(requestId, true, request.resultHash);
    }

    // ============================================
    // Batch Operations
    // ============================================

    function batchRequestParameterMatch(
        uint256[] calldata leadTokenIds,
        MatchParameters calldata buyerParams
    ) external returns (bytes32[] memory requestIds) {
        requestIds = new bytes32[](leadTokenIds.length);
        
        for (uint256 i = 0; i < leadTokenIds.length; i++) {
            requestIds[i] = this.requestParameterMatch(leadTokenIds[i], buyerParams);
        }
        
        return requestIds;
    }

    // ============================================
    // View Functions
    // ============================================

    function getVerificationResult(
        bytes32 requestId
    ) external view returns (VerificationRequest memory) {
        return _requests[requestId];
    }

    function isVerificationValid(bytes32 requestId) external view returns (bool) {
        VerificationRequest storage request = _requests[requestId];
        return request.status == RequestStatus.FULFILLED;
    }

    function getLeadQualityScore(uint256 leadTokenId) external view returns (uint16) {
        return _leadQualityScores[leadTokenId];
    }

    // ============================================
    // Helper Functions
    // ============================================

    function _bytes32ToString(bytes32 data) internal pure returns (string memory) {
        bytes memory result = new bytes(64);
        bytes memory hexChars = "0123456789abcdef";
        
        for (uint256 i = 0; i < 32; i++) {
            result[i * 2] = hexChars[uint8(data[i] >> 4)];
            result[i * 2 + 1] = hexChars[uint8(data[i] & 0x0f)];
        }
        
        return string(result);
    }

    function _uint256ToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        
        return string(buffer);
    }
}
