// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/v1_0_0/libraries/FunctionsRequest.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BountyMatcher
 * @author Lead Engine CRE
 * @notice Uses Chainlink Functions to run bounty-criteria matching logic
 *         off-chain in the DON and store verified results on-chain.
 *
 * @dev Architecture:
 *   1. Backend calls `requestBountyMatch(leadIdHash, args)` with lead
 *      attributes serialised as string args.
 *   2. The DON executes the stored JavaScript source (`_matchSource`) which
 *      evaluates each pool's AND-logic criteria against the lead.
 *   3. `fulfillRequest()` decodes the DON response — an ABI-encoded tuple of
 *      (string[] matchedPoolIds, bool matchFound) — and stores the result.
 *   4. `VerticalBountyPool.releaseBounty()` can optionally check
 *      `isMatchVerified(leadIdHash)` before releasing funds.
 *
 * Gas optimisation: All criteria evaluation runs off-chain in the DON.
 * On-chain cost is limited to request bookkeeping (~80k) and result
 * storage (~50k).
 *
 * Base Sepolia:
 *   Router : 0xf9B8fc078197181C841c296C876945aaa425B278
 *   DON ID : fun-base-sepolia-1
 */
contract BountyMatcher is FunctionsClient, Ownable {
    using FunctionsRequest for FunctionsRequest.Request;

    // ============================================
    // Types
    // ============================================

    enum MatchStatus {
        NONE,       // Default — no request exists
        PENDING,    // Request sent to DON, awaiting callback
        FULFILLED,  // DON responded with match results
        FAILED      // DON responded with an error
    }

    struct MatchResult {
        bytes32     requestId;
        string[]    matchedPoolIds;
        bool        matchFound;
        MatchStatus status;
        uint40      requestedAt;
        uint40      fulfilledAt;
    }

    // ============================================
    // State
    // ============================================

    /// @notice Chainlink Functions DON ID
    bytes32 public donId;

    /// @notice Chainlink Functions subscription ID
    uint64  public subscriptionId;

    /// @notice Callback gas limit for fulfillRequest
    uint32  public gasLimit = 300_000;

    /// @notice JavaScript source code executed by the DON
    string  private _matchSource;

    /// @dev Functions requestId -> leadIdHash (reverse lookup for callback)
    mapping(bytes32 => bytes32) private _requestToLead;

    /// @dev leadIdHash -> MatchResult
    mapping(bytes32 => MatchResult) private _results;

    /// @dev Transient: set before _sendRequest so synchronous mock callbacks
    ///      can locate the lead (same pattern as VRFTieBreaker)
    bytes32 private _pendingLeadIdHash;

    // ============================================
    // Events
    // ============================================

    event BountyMatchRequested(
        bytes32 indexed leadIdHash,
        bytes32 indexed requestId,
        uint256 argCount
    );

    event BountyMatchCompleted(
        bytes32 indexed leadIdHash,
        bytes32 indexed requestId,
        bool    matchFound,
        uint256 matchedCount
    );

    event BountyMatchFailed(
        bytes32 indexed leadIdHash,
        bytes32 indexed requestId
    );

    event SourceCodeUpdated();
    event ConfigUpdated(bytes32 donId, uint64 subscriptionId, uint32 gasLimit);

    // ============================================
    // Constructor
    // ============================================

    /**
     * @param router          Chainlink Functions router address
     *                        Base Sepolia: 0xf9B8fc078197181C841c296C876945aaa425B278
     * @param _donId          DON ID (e.g. bytes32 of "fun-base-sepolia-1")
     * @param _subscriptionId Functions subscription ID
     * @param initialOwner    Contract owner (backend deployer key)
     */
    constructor(
        address router,
        bytes32 _donId,
        uint64  _subscriptionId,
        address initialOwner
    ) FunctionsClient(router) Ownable(initialOwner) {
        donId = _donId;
        subscriptionId = _subscriptionId;
    }

    // ============================================
    // Admin
    // ============================================

    /**
     * @notice Update DON configuration.
     */
    function setConfig(
        bytes32 _donId,
        uint64  _subscriptionId,
        uint32  _gasLimit
    ) external onlyOwner {
        donId = _donId;
        subscriptionId = _subscriptionId;
        gasLimit = _gasLimit;
        emit ConfigUpdated(_donId, _subscriptionId, _gasLimit);
    }

    /**
     * @notice Set the JavaScript source code executed by the DON.
     * @dev    The source receives lead attributes as `args[]` and returns
     *         ABI-encoded `(string[] matchedPoolIds, bool matchFound)`.
     */
    function setSourceCode(string calldata source) external onlyOwner {
        _matchSource = source;
        emit SourceCodeUpdated();
    }

    // ============================================
    // External: Request Match
    // ============================================

    /**
     * @notice Request the DON to evaluate bounty criteria for a lead.
     *
     * @param leadIdHash  keccak256 of the platform lead ID string
     * @param args        String array of lead attributes:
     *                      [0] leadId
     *                      [1] qualityScore    (uint, 0-10000)
     *                      [2] creditScore     (uint, 300-850)
     *                      [3] geoState        (2-letter code or empty)
     *                      [4] geoCountry      (2-letter code or empty)
     *                      [5] leadAgeHours    (uint)
     *                      [6] criteriaJSON    (JSON array of pool criteria)
     *
     * @return requestId  The Chainlink Functions request ID
     *
     * @dev Only callable by the contract owner (backend deployer key).
     *      Reverts if the lead already has a fulfilled or pending match.
     */
    function requestBountyMatch(
        bytes32  leadIdHash,
        string[] calldata args
    ) external onlyOwner returns (bytes32 requestId) {
        require(bytes(_matchSource).length > 0, "BM: Source not set");
        require(args.length >= 7, "BM: Need 7 args");
        require(
            _results[leadIdHash].status == MatchStatus.NONE,
            "BM: Already requested"
        );

        // Build Chainlink Functions request
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(_matchSource);
        req.setArgs(args);

        // Pre-store result for synchronous mock callbacks
        _results[leadIdHash] = MatchResult({
            requestId: bytes32(0),
            matchedPoolIds: new string[](0),
            matchFound: false,
            status: MatchStatus.PENDING,
            requestedAt: uint40(block.timestamp),
            fulfilledAt: 0
        });
        _pendingLeadIdHash = leadIdHash;

        // Send to DON
        requestId = _sendRequest(
            req.encodeCBOR(),
            subscriptionId,
            gasLimit,
            donId
        );

        // Map requestId -> lead
        _requestToLead[requestId] = leadIdHash;
        _results[leadIdHash].requestId = requestId;
        _pendingLeadIdHash = bytes32(0);

        emit BountyMatchRequested(leadIdHash, requestId, args.length);
    }

    // ============================================
    // Internal: Chainlink Functions Callback
    // ============================================

    /**
     * @notice Called by the Functions router with the DON's response.
     * @dev    The DON returns a comma-separated string of matched pool IDs
     *         via `Functions.encodeString()`. An empty string means no matches.
     *         Example: "pool-1,pool-3" → ["pool-1", "pool-3"], matchFound = true
     *         Example: ""              → [],                     matchFound = false
     */
    function fulfillRequest(
        bytes32 requestId,
        bytes memory response,
        bytes memory err
    ) internal override {
        // Locate lead (async or sync)
        bytes32 leadIdHash = _requestToLead[requestId];
        if (leadIdHash == bytes32(0)) {
            leadIdHash = _pendingLeadIdHash;
        }
        require(leadIdHash != bytes32(0), "BM: Unknown request");

        MatchResult storage result = _results[leadIdHash];
        require(result.status == MatchStatus.PENDING, "BM: Not pending");

        result.fulfilledAt = uint40(block.timestamp);

        // Handle DON error
        if (err.length > 0) {
            result.status = MatchStatus.FAILED;
            emit BountyMatchFailed(leadIdHash, requestId);
            return;
        }

        // Decode response: comma-separated pool IDs as a string
        string memory csv = string(response);
        bool found = response.length > 0;

        if (found) {
            string[] memory poolIds = _splitCSV(csv);
            result.matchedPoolIds = poolIds;
            result.matchFound = true;
            result.status = MatchStatus.FULFILLED;
            emit BountyMatchCompleted(leadIdHash, requestId, true, poolIds.length);
        } else {
            result.matchFound = false;
            result.status = MatchStatus.FULFILLED;
            emit BountyMatchCompleted(leadIdHash, requestId, false, 0);
        }
    }

    /**
     * @dev Split a comma-separated string into an array.
     *      Handles: "a,b,c" → ["a","b","c"], "a" → ["a"], "" → []
     *      Gas-optimised: single pass to count, single pass to extract.
     */
    function _splitCSV(string memory csv) internal pure returns (string[] memory) {
        bytes memory b = bytes(csv);
        if (b.length == 0) return new string[](0);

        // Count commas to determine array size
        uint256 count = 1;
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] == 0x2C) count++; // ','
        }

        string[] memory parts = new string[](count);
        uint256 partIndex = 0;
        uint256 start = 0;

        for (uint256 i = 0; i <= b.length; i++) {
            if (i == b.length || b[i] == 0x2C) {
                uint256 len = i - start;
                bytes memory part = new bytes(len);
                for (uint256 j = 0; j < len; j++) {
                    part[j] = b[start + j];
                }
                parts[partIndex] = string(part);
                partIndex++;
                start = i + 1;
            }
        }

        return parts;
    }

    // ============================================
    // View
    // ============================================

    /**
     * @notice Check if a lead has a verified match result.
     */
    function isMatchVerified(bytes32 leadIdHash) external view returns (bool) {
        MatchResult storage r = _results[leadIdHash];
        return r.status == MatchStatus.FULFILLED && r.matchFound;
    }

    /**
     * @notice Read the full match result for a lead.
     */
    function getMatchResult(bytes32 leadIdHash) external view returns (MatchResult memory) {
        return _results[leadIdHash];
    }

    /**
     * @notice Check the current match status for a lead.
     */
    function getMatchStatus(bytes32 leadIdHash) external view returns (MatchStatus) {
        return _results[leadIdHash].status;
    }
}
