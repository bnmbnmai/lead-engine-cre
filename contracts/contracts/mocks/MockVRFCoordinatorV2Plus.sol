// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/**
 * @title MockVRFCoordinatorV2Plus
 * @notice Implements IVRFCoordinatorV2Plus for Hardhat tests.
 *         requestRandomWords immediately fulfills with a deterministic value.
 */
contract MockVRFCoordinatorV2Plus is IVRFCoordinatorV2Plus {

    uint256 private _nextRequestId;
    uint256 private _nextSubId;

    event RandomWordsRequested(uint256 indexed requestId, address indexed consumer);
    event RandomWordsFulfilled(uint256 indexed requestId);

    // ─── requestRandomWords (the one that matters) ───

    function requestRandomWords(
        VRFV2PlusClient.RandomWordsRequest calldata /* req */
    ) external override returns (uint256 requestId) {
        requestId = ++_nextRequestId;
        address consumer = msg.sender;

        emit RandomWordsRequested(requestId, consumer);

        // Deterministic pseudo-random for tests
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = uint256(keccak256(abi.encodePacked(
            requestId,
            block.timestamp,
            block.prevrandao,
            consumer
        )));

        // Fulfill immediately via rawFulfillRandomWords on the consumer
        (bool success, bytes memory reason) = consumer.call(
            abi.encodeWithSignature(
                "rawFulfillRandomWords(uint256,uint256[])",
                requestId,
                randomWords
            )
        );
        if (!success) {
            // Bubble up the revert reason for debugging
            if (reason.length > 0) {
                assembly { revert(add(reason, 32), mload(reason)) }
            }
            revert("MockVRF: fulfill failed");
        }

        emit RandomWordsFulfilled(requestId);
    }

    // ─── IVRFSubscriptionV2Plus stubs ───

    function createSubscription() external override returns (uint256 subId) {
        subId = ++_nextSubId;
    }

    function addConsumer(uint256, address) external override {}
    function removeConsumer(uint256, address) external override {}
    function cancelSubscription(uint256, address) external override {}
    function acceptSubscriptionOwnerTransfer(uint256) external override {}
    function requestSubscriptionOwnerTransfer(uint256, address) external override {}

    function getSubscription(uint256) external pure override
        returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers)
    {
        return (0, 0, 0, address(0), new address[](0));
    }

    function pendingRequestExists(uint256) external pure override returns (bool) {
        return false;
    }

    function getActiveSubscriptionIds(uint256, uint256) external pure override returns (uint256[] memory) {
        return new uint256[](0);
    }

    function fundSubscriptionWithNative(uint256) external payable override {}
}
