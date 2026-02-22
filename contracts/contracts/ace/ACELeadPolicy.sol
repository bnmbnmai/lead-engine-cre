// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Policy} from "./vendor/core/Policy.sol";
import {IPolicyEngine} from "./vendor/interfaces/IPolicyEngine.sol";

interface IACECompliance {
    function isCompliant(address wallet) external view returns (bool);
}

/**
 * @title ACELeadPolicy
 * @notice A Chainlink ACE policy that gates LeadNFTv2.mintLead() and
 *         LeadNFTv2.transferFrom() using the existing ACECompliance registry.
 * @dev Deployed as a standalone contract and registered with the LeadNFTv2
 *      via `attachPolicyEngine` (the PolicyEngine pattern is lightweight here —
 *      LeadNFTv2 calls this policy's run() directly for the demo).
 *      Returns PolicyResult.Allowed when the caller is compliant;
 *      reverts with IPolicyEngine.PolicyRejected when not.
 */
contract ACELeadPolicy is Policy {
    string public constant override typeAndVersion = "ACELeadPolicy 1.0.0";

    address public aceCompliance;

    /**
     * @param policyEngine  Address of the PolicyEngine (or address(0) for direct mode).
     * @param initialOwner  Deployer / admin address.
     * @param aceCompliance_ Address of the deployed ACECompliance registry.
     */
    constructor(
        address policyEngine,
        address initialOwner,
        address aceCompliance_
    ) Policy(policyEngine, initialOwner, abi.encode(aceCompliance_)) {}

    function configure(bytes memory parameters) internal override {
        address ace = abi.decode(parameters, (address));
        require(ace != address(0), "ACELeadPolicy: zero ACECompliance");
        aceCompliance = ace;
    }

    /**
     * @notice Policy run hook. Called by the PolicyEngine before every protected function,
     *         or called directly by LeadNFTv2._runACEPolicy() in direct-call mode.
     * @param caller The msg.sender of the protected function (minter / transferrer).
     * @return PolicyResult.Allowed when caller is compliant.
     * @dev Reverts with IPolicyEngine.PolicyRejected when caller is not compliant.
     */
    function run(
        address caller,
        address, /*subject*/
        bytes4, /*selector*/
        bytes[] calldata, /*parameters*/
        bytes calldata /*context*/
    ) public view override returns (IPolicyEngine.PolicyResult) {
        if (!IACECompliance(aceCompliance).isCompliant(caller)) {
            revert IPolicyEngine.PolicyRejected("ACE: caller not compliant");
        }
        return IPolicyEngine.PolicyResult.Allowed;
    }
}
