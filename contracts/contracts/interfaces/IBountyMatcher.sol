// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IBountyMatcher
 * @notice Interface for the BountyMatcher Functions consumer.
 * @dev    Used by VerticalBountyPool to check Functions attestation.
 */
interface IBountyMatcher {
    /**
     * @notice Check if a lead has a verified match result from the DON.
     * @param leadIdHash keccak256 of the platform lead ID string
     */
    function isMatchVerified(bytes32 leadIdHash) external view returns (bool);
}
