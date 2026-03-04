/**
 * Deploy PersonalEscrowVaultUpkeep to Base Sepolia
 *
 * Usage:
 *   npx hardhat run scripts/deploy-automation-upkeep.ts --network baseSepolia
 *
 * Prerequisites:
 *   - DEPLOYER_PRIVATE_KEY env var set
 *   - PersonalEscrowVault already deployed at known address
 *
 * After deployment:
 *   1. Register upkeep at https://automation.chain.link
 *   2. Select "Custom logic" upkeep type
 *   3. Target contract: <deployed address>
 *   4. Gas limit: 500000
 *   5. Fund with 5+ LINK (testnet)
 *   6. Set AUTOMATION_UPKEEP_CONTRACT_ADDRESS in backend .env
 */

import { ethers } from "hardhat";

// Base Sepolia PersonalEscrowVault address
const VAULT_ADDRESS = "0x56bB31bE214C54ebeCA55cd86d86512b94310F8C";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying PersonalEscrowVaultUpkeep with account:", deployer.address);
    console.log("Target vault:", VAULT_ADDRESS);

    const Upkeep = await ethers.getContractFactory("PersonalEscrowVaultUpkeep");
    const upkeep = await Upkeep.deploy(VAULT_ADDRESS);

    await upkeep.waitForDeployment();
    const address = await upkeep.getAddress();

    console.log("");
    console.log("=".repeat(60));
    console.log("PersonalEscrowVaultUpkeep deployed!");
    console.log("=".repeat(60));
    console.log("  Contract:      ", address);
    console.log("  Target Vault:  ", VAULT_ADDRESS);
    console.log("  Network:        Base Sepolia");
    console.log("");
    console.log("NEXT STEPS:");
    console.log("  1. Verify contract on Basescan:");
    console.log(`     npx hardhat verify --network baseSepolia ${address} "${VAULT_ADDRESS}"`);
    console.log("  2. Register upkeep at https://automation.chain.link");
    console.log("     - Type: Custom logic");
    console.log(`     - Target: ${address}`);
    console.log("     - Gas limit: 500000");
    console.log("     - Fund with 5+ LINK");
    console.log("  3. Set AUTOMATION_UPKEEP_CONTRACT_ADDRESS in backend .env:");
    console.log(`     AUTOMATION_UPKEEP_CONTRACT_ADDRESS=${address}`);
    console.log("=".repeat(60));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
