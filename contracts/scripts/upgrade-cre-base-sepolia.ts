import { ethers } from "hardhat";

/**
 * Redeploy ONLY the CREVerifier contract on Base Sepolia.
 *
 * This replaces the old CREVerifier with the updated version that includes
 * computeQualityScoreFromParams() — a pure on-chain scoring function.
 *
 * Run:
 *   npx hardhat run scripts/upgrade-cre-base-sepolia.ts --network baseSepolia
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const bal = await ethers.provider.getBalance(deployer.address);

    console.log("═".repeat(60));
    console.log("🔄 CREVerifier UPGRADE — Base Sepolia");
    console.log("═".repeat(60));
    console.log(`Deployer:  ${deployer.address}`);
    console.log(`Balance:   ${ethers.formatEther(bal)} ETH`);
    console.log();

    // ── Existing addresses ──────────────────────────────────────
    const LEAD_NFT_ADDRESS = "0x37414bc0341e0AAb94e51E89047eD73C7086E303";

    // Chainlink Functions (Base Sepolia)
    const CHAINLINK_ROUTER = "0xf9B8fc078197181C841c296C876945aaa425B278";
    const DON_ID = ethers.encodeBytes32String("fun-base-sepolia-1");

    const OLD_CRE = "0x86C8f348d816c35Fc0bd364e4A9Fa8a1E0fd930e";
    console.log(`Old CREVerifier:  ${OLD_CRE}`);
    console.log();

    // ── Deploy new CREVerifier ──────────────────────────────────
    console.log("📦  Deploying updated CREVerifier...");
    const CREVerifier = await ethers.getContractFactory("CREVerifier");
    const cre = await CREVerifier.deploy(
        CHAINLINK_ROUTER,
        DON_ID,
        0,                   // subscriptionId — set later via setChainlinkSubscription()
        LEAD_NFT_ADDRESS,
        deployer.address
    );
    await cre.waitForDeployment();
    const creAddr = await cre.getAddress();

    console.log(`   ✅ New CREVerifier: ${creAddr}`);
    console.log(`      TX: ${cre.deploymentTransaction()!.hash}`);
    console.log();

    // ── Summary ─────────────────────────────────────────────────
    console.log("═".repeat(60));
    console.log("📋  UPDATE THESE ENV VARS:");
    console.log("═".repeat(60));
    console.log(`CRE_CONTRACT_ADDRESS=${creAddr}`);
    console.log(`CRE_CONTRACT_ADDRESS_BASE_SEPOLIA=${creAddr}`);
    console.log();
    console.log("Update in: local .env, Render, and Vercel.");
    console.log("Old address (no longer active): " + OLD_CRE);
    console.log("═".repeat(60));
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
