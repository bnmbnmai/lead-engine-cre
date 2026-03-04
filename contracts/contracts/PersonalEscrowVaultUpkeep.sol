// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";

/**
 * @title PersonalEscrowVaultUpkeep
 * @notice Dedicated Chainlink Automation upkeep contract for PersonalEscrowVault.
 *
 *         This lightweight contract implements AutomationCompatibleInterface and
 *         delegates the real work to the existing PersonalEscrowVault:
 *           - Proof-of-Reserves check every 24 hours
 *           - Expired bid-lock refunds after 7 days (batch max 50)
 *
 *         Best practice: separating upkeep logic into a dedicated contract avoids
 *         complex inheritance issues with the Chainlink Automation dashboard verifier.
 *
 * @dev Target vault must expose: verifyReserves(), lastPorCheck(), checkUpkeep(),
 *      performUpkeep() as public/external functions.
 */

interface IPersonalEscrowVault {
    function lastPorCheck() external view returns (uint256);
    function lastPorSolvent() external view returns (bool);
    function activeLockCount() external view returns (uint256);
    function verifyReserves() external returns (bool solvent);
    function checkUpkeep(bytes calldata checkData)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData);
    function performUpkeep(bytes calldata performData) external;
}

contract PersonalEscrowVaultUpkeep is AutomationCompatibleInterface {
    /// @notice The PersonalEscrowVault this upkeep monitors
    IPersonalEscrowVault public immutable vault;

    /// @notice PoR check interval (matches vault constant)
    uint256 public constant POR_INTERVAL = 24 hours;

    /// @notice Lock expiry period (matches vault constant)
    uint256 public constant LOCK_EXPIRY = 7 days;

    /// @notice Deployer / owner for administrative functions
    address public immutable owner;

    /// @notice Timestamp of last upkeep execution (for monitoring)
    uint256 public lastUpkeepRun;

    /// @notice Total upkeep executions (for monitoring)
    uint256 public upkeepCount;

    event UpkeepPerformed(uint8 action, uint256 timestamp);

    constructor(address _vault) {
        require(_vault != address(0), "Zero vault");
        vault = IPersonalEscrowVault(_vault);
        owner = msg.sender;
    }

    /**
     * @notice Called by Chainlink Automation to check if upkeep is needed.
     * @dev Delegates to the vault's checkUpkeep for the actual logic.
     *      Gas-efficient: only reads vault state variables.
     * @return upkeepNeeded True if PoR is due or expired locks exist
     * @return performData Encoded action type (1 = PoR, 2 = refund, 3 = both)
     */
    function checkUpkeep(bytes calldata checkData)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        // Delegate to vault's existing checkUpkeep logic
        return vault.checkUpkeep(checkData);
    }

    /**
     * @notice Called by Chainlink Automation to perform upkeep.
     * @dev Delegates to the vault's performUpkeep for the actual execution.
     * @param performData Encoded action type from checkUpkeep
     */
    function performUpkeep(bytes calldata performData) external override {
        // Delegate to vault's existing performUpkeep logic
        vault.performUpkeep(performData);

        // Track upkeep execution for monitoring
        lastUpkeepRun = block.timestamp;
        upkeepCount++;

        uint8 action = abi.decode(performData, (uint8));
        emit UpkeepPerformed(action, block.timestamp);
    }
}
