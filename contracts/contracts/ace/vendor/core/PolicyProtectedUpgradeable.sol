// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import {IPolicyEngine} from "../interfaces/IPolicyEngine.sol";

/**
 * @title PolicyProtectedUpgradeable
 * @dev Minimal ERC-7201 storage mixin that gates function execution through a
 *      PolicyEngine. Provides a `runPolicy` modifier and policy engine management.
 *
 *      This vendored adaptation strips the OwnableUpgradeable / ERC165Upgradeable
 *      base classes so it can safely mix with non-upgradeable OpenZeppelin ERC721
 *      without _msgSender / supportsInterface diamond conflicts. Access control for
 *      attachPolicyEngine() and setContext() is expected to be enforced by the
 *      inheriting contract (e.g. onlyOwner).
 *
 * Source: github.com/smartcontractkit/chainlink-ace
 *         packages/policy-management/src/core/PolicyProtectedUpgradeable.sol
 *         — adapted for non-upgradeable ERC721 compatibility.
 *
 * @custom:vendored-at 2026-02-21
 */
abstract contract PolicyProtectedUpgradeable {
    /// @custom:storage-location erc7201:chainlink.ace.PolicyProtectedUpgradeable
    struct PolicyProtectedStorage {
        address policyEngine;
        bytes context;
    }

    // keccak256(abi.encode(uint256(keccak256("chainlink.ace.PolicyProtectedUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _STORAGE_SLOT =
        0x6d2b0c5f3a9d8e7b1f0a4c8e2d5b7a9f3c1e0d8b6a4f2e0c8d6b4a2f0e8c6100;

    function _getPolicyProtectedStorage() private pure returns (PolicyProtectedStorage storage $) {
        assembly {
            $.slot := _STORAGE_SLOT
        }
    }

    // ── Internal init ────────────────────────────────────────────────────────────

    function __PolicyProtected_init(address policyEngine) internal {
        if (policyEngine != address(0)) {
            _setPolicyEngine(policyEngine);
        }
    }

    // ── Internal helpers ─────────────────────────────────────────────────────────

    function _setPolicyEngine(address pe) internal {
        _getPolicyProtectedStorage().policyEngine = pe;
    }

    function _getPolicyEngine() internal view returns (address) {
        return _getPolicyProtectedStorage().policyEngine;
    }

    function _setContext(bytes memory ctx) internal {
        _getPolicyProtectedStorage().context = ctx;
    }

    function _getContext() internal view returns (bytes memory) {
        return _getPolicyProtectedStorage().context;
    }

    // ── Policy run ───────────────────────────────────────────────────────────────

    function _runPolicy() internal {
        PolicyProtectedStorage storage $ = _getPolicyProtectedStorage();
        if ($.policyEngine == address(0)) return; // no engine — default allow

        IPolicyEngine($.policyEngine).run(
            IPolicyEngine.Payload({
                selector: msg.sig,
                sender: msg.sender,
                data: msg.data,
                context: $.context
            })
        );
    }

    modifier runPolicy() {
        _runPolicy();
        _;
    }
}
