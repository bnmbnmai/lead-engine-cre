/**
 * Deploy VerticalBountyPool to Base Sepolia
 *
 * Usage:
 *   npx hardhat run scripts/deploy-bounty-pool.ts --network baseSepolia
 *
 * Prerequisites:
 *   - DEPLOYER_PRIVATE_KEY env var set (or ../backend/.env)
 *   - Deployer must have ETH on Base Sepolia for gas
 */

import { ethers } from "hardhat";

// Base Sepolia USDC (Circle official)
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying VerticalBountyPool with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");

    const VerticalBountyPool = await ethers.getContractFactory("VerticalBountyPool");
    const pool = await VerticalBountyPool.deploy(
        USDC_ADDRESS,         // _paymentToken (USDC)
        deployer.address,     // _platformWallet (deployer receives 5% platform cut)
        deployer.address,     // _initialOwner (Ownable)
    );

    await pool.waitForDeployment();
    const address = await pool.getAddress();

    // Authorize deployer as caller (so backend can call releaseBounty)
    console.log("\nAuthorizing deployer as caller...");
    const authTx = await pool.setAuthorizedCaller(deployer.address, true);
    await authTx.wait();
    console.log("  ✅ Deployer authorized as caller");

    // Approve the pool to spend deployer's USDC (for depositBounty)
    const usdc = await ethers.getContractAt(
        ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"],
        USDC_ADDRESS,
        deployer,
    );
    console.log("\nApproving USDC spend for bounty pool...");
    const approveTx = await usdc.approve(address, ethers.parseUnits("100000", 6)); // 100k USDC max
    await approveTx.wait();
    console.log("  ✅ USDC approved (100,000 USDC)");

    console.log("");
    console.log("=".repeat(60));
    console.log("VerticalBountyPool deployed!");
    console.log("=".repeat(60));
    console.log("  Contract:       ", address);
    console.log("  Payment Token:  ", USDC_ADDRESS, "(USDC)");
    console.log("  Platform Wallet:", deployer.address);
    console.log("  Owner:          ", deployer.address);
    console.log("  Network:         Base Sepolia");
    console.log("");
    console.log("ENV VARS TO SET:");
    console.log(`  BOUNTY_POOL_ADDRESS=${address}`);
    console.log("");
    console.log("Basescan:");
    console.log(`  https://sepolia.basescan.org/address/${address}`);
    console.log("=".repeat(60));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
