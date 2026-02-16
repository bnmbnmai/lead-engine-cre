import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    const bal = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(bal), "ETH");

    // Deploy LeadNFTv2
    console.log("\n📦 Deploying LeadNFTv2...");
    const LeadNFTv2 = await ethers.getContractFactory("LeadNFTv2");
    const leadNFT = await LeadNFTv2.deploy(deployer.address);
    const leadTx = leadNFT.deploymentTransaction()!;
    console.log("LeadNFTv2 TX hash:", leadTx.hash);
    await leadNFT.waitForDeployment();
    const leadAddr = await leadNFT.getAddress();
    console.log("✅ LeadNFTv2 deployed to:", leadAddr);

    // Deploy RTBEscrow
    console.log("\n📦 Deploying RTBEscrow...");
    const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    const RTBEscrow = await ethers.getContractFactory("RTBEscrow");
    const escrow = await RTBEscrow.deploy(
        USDC_BASE_SEPOLIA,
        deployer.address,  // Fee recipient
        250,               // 2.5% platform fee
        deployer.address   // Initial owner
    );
    const escrowTx = escrow.deploymentTransaction()!;
    console.log("RTBEscrow TX hash:", escrowTx.hash);
    await escrow.waitForDeployment();
    const escrowAddr = await escrow.getAddress();
    console.log("✅ RTBEscrow deployed to:", escrowAddr);

    console.log("\n" + "═".repeat(50));
    console.log("📋 DEPLOYMENT SUMMARY (Base Sepolia)");
    console.log("═".repeat(50));
    console.log(`LeadNFTv2:  ${leadAddr}`);
    console.log(`LeadNFT TX: ${leadTx.hash}`);
    console.log(`RTBEscrow:  ${escrowAddr}`);
    console.log(`Escrow TX:  ${escrowTx.hash}`);

    const remainingBal = await ethers.provider.getBalance(deployer.address);
    console.log(`\nRemaining balance: ${ethers.formatEther(remainingBal)} ETH`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
