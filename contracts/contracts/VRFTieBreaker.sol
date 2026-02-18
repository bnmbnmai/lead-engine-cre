// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/**
 * @title VRFTieBreaker
 * @author Lead Engine CRE
 * @notice Uses Chainlink VRF v2.5 to fairly resolve auction ties and bounty
 *         allocation conflicts. When two or more bidders submit identical
 *         effective bids, or multiple bounty pools match the same lead with
 *         equal amounts, this contract requests verifiable randomness and
 *         selects a winner/recipient with zero bias.
 *
 * @dev Flow:
 *   1. Backend calls `requestResolution(leadIdHash, candidates, resolveType)`
 *   2. VRF Coordinator returns randomness via `fulfillRandomWords`
 *   3. Winner = candidates[randomWord % candidates.length]
 *   4. Backend reads `getResolution(leadIdHash)` to proceed
 */
contract VRFTieBreaker is VRFConsumerBaseV2Plus {

    // ============================================
    // Types
    // ============================================

    enum ResolveType {
        AUCTION_TIE,        // Two+ bidders tied on effectiveBid
        BOUNTY_ALLOCATION   // Two+ bounty pools matched with equal amounts
    }

    enum RequestStatus {
        NONE,       // Default: no request exists
        PENDING,    // VRF request sent, awaiting callback
        FULFILLED   // VRF callback received, winner selected
    }

    struct Resolution {
        uint256     requestId;
        ResolveType resolveType;
        address[]   candidates;
        address     winner;
        uint256     randomWord;
        RequestStatus status;
    }

    // ============================================
    // State
    // ============================================

    /// @notice VRF subscription ID (v2.5 uses uint256)
    uint256 public s_subscriptionId;

    /// @notice Key hash for the gas lane (Base Sepolia 100 gwei)
    bytes32 public s_keyHash;

    /// @notice Callback gas limit for fulfillRandomWords
    uint32 public constant CALLBACK_GAS_LIMIT = 100_000;

    /// @notice Number of block confirmations before VRF response
    uint16 public constant REQUEST_CONFIRMATIONS = 3;

    /// @notice We only need 1 random word per resolution
    uint32 public constant NUM_WORDS = 1;

    /// @dev VRF requestId -> leadIdHash (for reverse lookup in callback)
    mapping(uint256 => bytes32) private s_requestToLead;

    /// @dev leadIdHash -> Resolution result
    mapping(bytes32 => Resolution) private s_resolutions;

    /// @dev Transient: set before coordinator call so synchronous callbacks can find the lead
    bytes32 private _pendingLeadIdHash;

    // ============================================
    // Events
    // ============================================

    event ResolutionRequested(
        bytes32 indexed leadIdHash,
        uint256 indexed requestId,
        ResolveType     resolveType,
        uint256         candidateCount
    );

    event TieResolved(
        bytes32 indexed leadIdHash,
        address indexed winner,
        uint256 indexed requestId,
        ResolveType     resolveType,
        uint256         randomWord
    );

    event ConfigUpdated(uint256 subscriptionId, bytes32 keyHash);

    // ============================================
    // Constructor
    // ============================================

    /**
     * @param coordinator  VRF Coordinator address
     *                     Base Sepolia: 0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE
     * @param subscriptionId VRF subscription ID
     * @param keyHash      Gas lane key hash
     */
    constructor(
        address coordinator,
        uint256 subscriptionId,
        bytes32 keyHash
    ) VRFConsumerBaseV2Plus(coordinator) {
        s_subscriptionId = subscriptionId;
        s_keyHash = keyHash;
    }

    // ============================================
    // External: Request Resolution
    // ============================================

    /**
     * @notice Request VRF randomness to break a tie.
     * @param leadIdHash   keccak256 of the platform lead ID string
     * @param candidates   Array of tied addresses (bidder wallets or bounty pool owners)
     * @param resolveType  AUCTION_TIE or BOUNTY_ALLOCATION
     * @return requestId   The VRF request ID
     *
     * @dev Only callable by the contract owner (backend deployer key).
     *      Reverts if the lead has already been resolved to prevent double-resolution.
     */
    function requestResolution(
        bytes32 leadIdHash,
        address[] calldata candidates,
        ResolveType resolveType
    ) external onlyOwner returns (uint256 requestId) {
        require(candidates.length >= 2, "Need 2+ candidates");
        require(candidates.length <= 10, "Max 10 candidates");
        require(
            s_resolutions[leadIdHash].status != RequestStatus.FULFILLED,
            "Already resolved"
        );
        require(
            s_resolutions[leadIdHash].status == RequestStatus.NONE,
            "Request pending"
        );

        // Store candidates BEFORE the coordinator call.
        // The mock coordinator fulfills synchronously inside requestRandomWords,
        // so fulfillRandomWords needs this data to already exist. On mainnet
        // the callback arrives in a later tx, so the order wouldn't matter,
        // but pre-storing is safe in both scenarios (Checks-Effects-Interactions).
        s_resolutions[leadIdHash] = Resolution({
            requestId: 0,   // Will be set after we get the ID
            resolveType: resolveType,
            candidates: candidates,
            winner: address(0),
            randomWord: 0,
            status: RequestStatus.PENDING
        });

        // Store the pending leadIdHash so fulfillRandomWords can find it
        _pendingLeadIdHash = leadIdHash;

        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: s_keyHash,
                subId: s_subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: CALLBACK_GAS_LIMIT,
                numWords: NUM_WORDS,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );

        // Map request ID -> lead (for async fulfillment on mainnet)
        s_requestToLead[requestId] = leadIdHash;
        s_resolutions[leadIdHash].requestId = requestId;

        // Clear transient state
        _pendingLeadIdHash = bytes32(0);

        emit ResolutionRequested(leadIdHash, requestId, resolveType, candidates.length);
    }

    // ============================================
    // Internal: VRF Callback
    // ============================================

    /**
     * @notice Called by VRF Coordinator with verified randomness.
     * @dev Selects winner = candidates[randomWord % candidates.length].
     *      Pure modular arithmetic -- no bias for small candidate counts.
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        // Look up lead by requestId (async mainnet case) or pending hash (sync mock case)
        bytes32 leadIdHash = s_requestToLead[requestId];
        if (leadIdHash == bytes32(0)) {
            leadIdHash = _pendingLeadIdHash;
        }
        require(leadIdHash != bytes32(0), "Unknown request");

        Resolution storage res = s_resolutions[leadIdHash];
        require(res.status == RequestStatus.PENDING, "Not pending");

        uint256 randomWord = randomWords[0];
        uint256 winnerIndex = randomWord % res.candidates.length;
        address winner = res.candidates[winnerIndex];

        res.randomWord = randomWord;
        res.winner = winner;
        res.status = RequestStatus.FULFILLED;

        emit TieResolved(leadIdHash, winner, requestId, res.resolveType, randomWord);
    }

    // ============================================
    // View
    // ============================================

    /**
     * @notice Read the resolution result for a lead.
     * @param leadIdHash keccak256 of the platform lead ID
     * @return resolution The full resolution struct
     */
    function getResolution(bytes32 leadIdHash)
        external
        view
        returns (Resolution memory resolution)
    {
        return s_resolutions[leadIdHash];
    }

    /**
     * @notice Check if a lead has been resolved.
     * @param leadIdHash keccak256 of the platform lead ID
     * @return True if VRF callback has been received
     */
    function isResolved(bytes32 leadIdHash) external view returns (bool) {
        return s_resolutions[leadIdHash].status == RequestStatus.FULFILLED;
    }

    // ============================================
    // Admin
    // ============================================

    /**
     * @notice Update VRF subscription and key hash.
     * @param subscriptionId New subscription ID
     * @param keyHash New gas lane key hash
     */
    function setConfig(uint256 subscriptionId, bytes32 keyHash) external onlyOwner {
        s_subscriptionId = subscriptionId;
        s_keyHash = keyHash;
        emit ConfigUpdated(subscriptionId, keyHash);
    }
}
