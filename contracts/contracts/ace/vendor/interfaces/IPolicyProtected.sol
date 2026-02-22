// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title IPolicyProtected
 * @dev Interface for attaching a policy engine to a smart contract.
 * Source: github.com/smartcontractkit/chainlink-ace
 *         packages/policy-management/src/interfaces/IPolicyProtected.sol
 */
interface IPolicyProtected is IERC165 {
    event PolicyEngineAttached(address indexed policyEngine);
    event PolicyEngineDetachFailed(address indexed policyEngine, bytes reason);

    function attachPolicyEngine(address policyEngine) external;
    function getPolicyEngine() external view returns (address);
    function setContext(bytes calldata context) external;
    function getContext() external view returns (bytes memory);
    function clearContext() external;
}
