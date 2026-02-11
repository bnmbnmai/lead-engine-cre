// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockV3Aggregator
 * @dev Mock Chainlink AggregatorV3Interface for testing VerticalNFT price feed
 * @notice Returns configurable price data; owner can update answers
 */
contract MockV3Aggregator {
    uint8 public decimals;
    int256 public latestAnswer;
    uint256 public latestTimestamp;
    uint80 public latestRound;
    string public description;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        latestAnswer = _initialAnswer;
        latestTimestamp = block.timestamp;
        latestRound = 1;
        description = "Mock Price Feed";
    }

    /**
     * @dev Update the mock price (simulates real oracle update)
     */
    function updateAnswer(int256 _answer) external {
        latestAnswer = _answer;
        latestTimestamp = block.timestamp;
        latestRound++;
    }

    /**
     * @dev AggregatorV3Interface.latestRoundData()
     */
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (
            latestRound,
            latestAnswer,
            latestTimestamp,
            latestTimestamp,
            latestRound
        );
    }

    /**
     * @dev AggregatorV3Interface.getRoundData()
     */
    function getRoundData(uint80 _roundId)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (
            _roundId,
            latestAnswer,
            latestTimestamp,
            latestTimestamp,
            _roundId
        );
    }
}
