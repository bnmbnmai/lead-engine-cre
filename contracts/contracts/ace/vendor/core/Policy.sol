// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IPolicy} from "../interfaces/IPolicy.sol";
import {IPolicyEngine} from "../interfaces/IPolicyEngine.sol";


/**
 * @title Policy
 * @dev Abstract base contract for ACE policies.
 *      Uses standard OpenZeppelin Ownable + ERC165 (non-upgradeable) so it
 *      compiles alongside non-upgradeable ERC721 without inheritance conflicts.
 *
 * Source: github.com/smartcontractkit/chainlink-ace
 *         packages/policy-management/src/core/Policy.sol
 *         — adapted: OwnableUpgradeable → Ownable, Initializable removed.
 *
 * @custom:vendored-at 2026-02-21
 */
abstract contract Policy is Ownable, ERC165, IPolicy {
    address private _policyEngine;

    function typeAndVersion() external pure virtual returns (string memory);

    /**
     * @dev Constructor-based initialization (non-upgradeable variant).
     * @param policyEngine  Address of the PolicyEngine contract.
     * @param initialOwner  Owner of this policy.
     * @param configParams  ABI-encoded config passed to configure().
     */
    constructor(
        address policyEngine,
        address initialOwner,
        bytes memory configParams
    ) Ownable(initialOwner) {
        _policyEngine = policyEngine;
        if (configParams.length > 0) {
            configure(configParams);
        }
    }

    /// @dev Override to store policy-specific configuration.
    function configure(bytes memory parameters) internal virtual {}

    /// @inheritdoc IPolicy
    function onInstall(bytes4 /*selector*/) external virtual override {}

    /// @inheritdoc IPolicy
    function onUninstall(bytes4 /*selector*/) external virtual override {}

    /// @inheritdoc IPolicy
    function postRun(
        address, /*caller*/
        address, /*subject*/
        bytes4, /*selector*/
        bytes[] calldata, /*parameters*/
        bytes calldata /*context*/
    ) external virtual override {}

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC165, IERC165)
        returns (bool)
    {
        return interfaceId == type(IPolicy).interfaceId || super.supportsInterface(interfaceId);
    }

    function getPolicyEngine() external view returns (address) {
        return _policyEngine;
    }
}
