/**
 * deploy-vault-only.ts
 *
 * Targeted one-shot deploy of PersonalEscrowVault only.
 * Use this when LeadNFTv2 and RTBEscrow are already deployed correctly
 * and only the vault is missing.
 */
import { ethers } from "hardhat";

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    const bal = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(bal), "ETH");
    console.log("Nonce (deploy slot):", await ethers.provider.getTransactionCount(deployer.address));

    console.log("\n📦 Deploying PersonalEscrowVault...");
    const VaultFactory = await ethers.getContractFactory("PersonalEscrowVault");
    const vault = await VaultFactory.deploy(
        USDC_BASE_SEPOLIA,
        deployer.address,   // Platform wallet (fee recipient)
        deployer.address    // Initial owner
    );
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    const vaultTx = vault.deploymentTransaction()!.hash;
    const feedAddr = '0x71041dDDaD3595f9Ced3d1F5861e2931857B2deF'; // Base Sepolia USDC/ETH feed (from constructor)

    const W = "═".repeat(60);
    console.log(`\n${W}`);
    console.log("✅ PersonalEscrowVault deployed");
    console.log(W);
    console.log(`Address   : ${vaultAddr}`);
    console.log(`TX hash   : ${vaultTx}`);
    console.log(`usdcEthFeed: ${feedAddr}`);
    console.log(W);
    console.log(`\nRemaining ETH: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`);

    console.log(`\n🔍 Basescan Verify Command:\n`);
    console.log(`npx hardhat verify --network baseSepolia ${vaultAddr} "${USDC_BASE_SEPOLIA}" "${deployer.address}" "${deployer.address}"`);

    console.log(`\n📝 Update backend/.env:\n`);
    console.log(`VAULT_ADDRESS_BASE_SEPOLIA=${vaultAddr}`);
    console.log(`PERSONAL_ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA=${vaultAddr}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error.message ?? error);
        process.exit(1);
    });
