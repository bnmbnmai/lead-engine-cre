// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockFunctionsRouter
 * @dev Mock Chainlink Functions router for testing CREVerifier
 * @notice Simulates fulfillRequest callbacks without real Chainlink DON
 */
contract MockFunctionsRouter {
    struct PendingRequest {
        address client;
        bytes32 requestId;
        bool fulfilled;
    }

    uint64 private _nextRequestId;
    mapping(bytes32 => PendingRequest) public requests;

    event RequestSent(bytes32 indexed requestId, address indexed client);
    event RequestFulfilled(bytes32 indexed requestId);

    /**
     * @dev Called by FunctionsClient._sendRequest()
     * Returns a deterministic requestId
     */
    function sendRequest(
        uint64, /* subscriptionId */
        bytes calldata, /* data */
        uint16, /* dataVersion */
        uint32, /* callbackGasLimit */
        bytes32 /* donId */
    ) external returns (bytes32 requestId) {
        requestId = keccak256(abi.encodePacked(msg.sender, block.timestamp, _nextRequestId++));
        requests[requestId] = PendingRequest({
            client: msg.sender,
            requestId: requestId,
            fulfilled: false
        });
        emit RequestSent(requestId, msg.sender);
        return requestId;
    }

    /**
     * @dev Test helper: simulate a successful fulfillment callback
     * Calls handleOracleFulfillment on the client contract
     */
    function simulateFulfillment(
        bytes32 requestId,
        bytes calldata response,
        bytes calldata err
    ) external {
        PendingRequest storage req = requests[requestId];
        require(req.client != address(0), "MockRouter: Unknown request");
        require(!req.fulfilled, "MockRouter: Already fulfilled");
        req.fulfilled = true;

        // Call the client's handleOracleFulfillment
        (bool success, ) = req.client.call(
            abi.encodeWithSignature(
                "handleOracleFulfillment(bytes32,bytes,bytes)",
                requestId,
                response,
                err
            )
        );
        require(success, "MockRouter: Callback failed");
        emit RequestFulfilled(requestId);
    }
}
