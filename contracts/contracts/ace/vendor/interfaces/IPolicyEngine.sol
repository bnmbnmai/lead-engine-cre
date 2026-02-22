// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

/**
 * @title IPolicyEngine
 * @dev Interface for the policy engine.
 * Source: github.com/smartcontractkit/chainlink-ace
 *         packages/policy-management/src/interfaces/IPolicyEngine.sol
 */
interface IPolicyEngine {
    error TargetNotAttached(address target);
    error TargetAlreadyAttached(address target);
    error PolicyEngineUndefined();
    error PolicyRunRejected(address policy, string rejectReason, Payload payload);
    error PolicyMapperError(address policy, bytes errorReason, Payload payload);
    error PolicyRejected(string rejectReason);
    error PolicyRunError(address policy, bytes errorReason, Payload payload);
    error PolicyRunUnauthorizedError(address account);
    error PolicyPostRunError(address policy, bytes errorReason, Payload payload);
    error UnsupportedSelector(bytes4 selector);
    error PolicyActionError(address policy, bytes errorReason);
    error PolicyConfigurationError(address policy, bytes errorReason);
    error PolicyConfigurationVersionError(address policy, uint256 expectedVersion, uint256 actualVersion);
    error ExtractorError(address extractor, bytes errorReason, Payload payload);

    event TargetAttached(address indexed target);
    event TargetDetached(address indexed target);
    event PolicyConfigured(
        address indexed policy, uint256 indexed configVersion, bytes4 indexed configSelector, bytes configData
    );
    event PolicyRunComplete(
        address indexed sender,
        address indexed target,
        bytes4 indexed selector,
        Parameter[] extractedParameters,
        bytes context
    );
    event PolicyAdded(
        address indexed target, bytes4 indexed selector, address policy, uint256 position, bytes32[] policyParameterNames
    );
    event PolicyAddedAt(
        address indexed target,
        bytes4 indexed selector,
        address policy,
        uint256 position,
        bytes32[] policyParameterNames,
        address[] policies
    );
    event PolicyRemoved(address indexed target, bytes4 indexed selector, address policy);
    event ExtractorSet(bytes4 indexed selector, address indexed extractor);
    event PolicyMapperSet(address indexed policy, address indexed mapper);
    event PolicyParametersSet(address indexed policy, bytes[] parameters);
    event DefaultPolicyAllowSet(bool defaultAllow);
    event TargetDefaultPolicyAllowSet(address indexed target, bool defaultAllow);

    enum PolicyResult {
        None,
        Allowed,
        Continue
    }

    struct Payload {
        bytes4 selector;
        address sender;
        bytes data;
        bytes context;
    }

    struct Parameter {
        bytes32 name;
        bytes value;
    }

    function typeAndVersion() external pure returns (string memory);
    function attach() external;
    function detach() external;
    function setExtractor(bytes4 selector, address extractor) external;
    function setExtractors(bytes4[] calldata selectors, address extractor) external;
    function addPolicy(address target, bytes4 selector, address policy, bytes32[] calldata policyParameterNames) external;
    function removePolicy(address target, bytes4 selector, address policy) external;
    function run(Payload calldata payload) external;
    function setDefaultPolicyAllow(bool defaultAllow) external;
    function setTargetDefaultPolicyAllow(address target, bool defaultAllow) external;
}
