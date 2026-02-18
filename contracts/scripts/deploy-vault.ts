import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    const bal = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(bal), "ETH");

    // USDC on Base Sepolia
    const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

    console.log("\n📦 Deploying PersonalEscrowVault...");
    const Vault = await ethers.getContractFactory("PersonalEscrowVault");
    const vault = await Vault.deploy(
        USDC_BASE_SEPOLIA,     // USDC token
        deployer.address,       // Platform wallet (fee recipient)
        deployer.address        // Initial owner
    );
    const vaultTx = vault.deploymentTransaction()!;
    console.log("Vault TX hash:", vaultTx.hash);
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    console.log("✅ PersonalEscrowVault deployed to:", vaultAddr);

    // Authorize the deployer as a backend caller
    console.log("\n🔑 Authorizing deployer as backend caller...");
    const authTx = await vault.setAuthorizedCaller(deployer.address, true);
    await authTx.wait();
    console.log("✅ Deployer authorized");

    console.log("\n" + "═".repeat(50));
    console.log("📋 DEPLOYMENT SUMMARY");
    console.log("═".repeat(50));
    console.log(`PersonalEscrowVault: ${vaultAddr}`);
    console.log(`Vault TX:            ${vaultTx.hash}`);
    console.log(`USDC Token:          ${USDC_BASE_SEPOLIA}`);
    console.log(`Platform Wallet:     ${deployer.address}`);
    console.log(`Owner:               ${deployer.address}`);

    const remainingBal = await ethers.provider.getBalance(deployer.address);
    console.log(`\nRemaining balance: ${ethers.formatEther(remainingBal)} ETH`);

    console.log("\n📝 Add to your .env:");
    console.log(`VAULT_ADDRESS_BASE_SEPOLIA=${vaultAddr}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
