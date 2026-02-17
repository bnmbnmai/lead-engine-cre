import { ethers } from "hardhat";

/**
 * Deploy ONLY RTBEscrow to Base Sepolia.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-RTBEscrow.ts --network baseSepolia
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    const bal = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(bal), "ETH\n");

    // Base Sepolia USDC (Circle testnet faucet)
    const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

    console.log("📦 Deploying RTBEscrow...");
    const RTBEscrow = await ethers.getContractFactory("RTBEscrow");
    const escrow = await RTBEscrow.deploy(
        USDC_BASE_SEPOLIA,
        deployer.address,  // Fee recipient
        250,               // 2.5% platform fee
        deployer.address   // Initial owner
    );
    const escrowTx = escrow.deploymentTransaction()!;
    console.log("TX hash:", escrowTx.hash);
    await escrow.waitForDeployment();
    const escrowAddr = await escrow.getAddress();

    console.log("\n" + "═".repeat(50));
    console.log("📋 DEPLOYMENT SUMMARY (Base Sepolia)");
    console.log("═".repeat(50));
    console.log(`RTBEscrow:  ${escrowAddr}`);
    console.log(`TX hash:    ${escrowTx.hash}`);
    console.log(`Fee BPS:    250 (2.5%)`);
    console.log(`Fee Rcpt:   ${deployer.address}`);
    console.log(`USDC:       ${USDC_BASE_SEPOLIA}`);

    const remaining = await ethers.provider.getBalance(deployer.address);
    console.log(`\nRemaining balance: ${ethers.formatEther(remaining)} ETH`);

    console.log("\n⚠️  Update your .env:");
    console.log(`   ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA=${escrowAddr}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
