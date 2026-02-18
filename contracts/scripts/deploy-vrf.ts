/**
 * Deploy VRFTieBreaker to Base Sepolia
 *
 * Usage:
 *   npx hardhat run scripts/deploy-vrf.ts --network baseSepolia
 *
 * Prerequisites:
 *   - DEPLOYER_PRIVATE_KEY env var set
 *   - VRF_SUBSCRIPTION_ID env var set (create at https://vrf.chain.link)
 *   - Subscription funded with LINK or native ETH
 *   - Consumer added to subscription after deploy
 */

import { ethers } from "hardhat";

// Base Sepolia VRF v2.5 parameters
const VRF_COORDINATOR = "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE";
const KEY_HASH = "0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying VRFTieBreaker with account:", deployer.address);

    const subscriptionId = process.env.VRF_SUBSCRIPTION_ID;
    if (!subscriptionId) {
        console.error("ERROR: Set VRF_SUBSCRIPTION_ID env var");
        console.error("Create a subscription at https://vrf.chain.link");
        process.exit(1);
    }

    const VRFTieBreaker = await ethers.getContractFactory("VRFTieBreaker");
    const tieBreaker = await VRFTieBreaker.deploy(
        VRF_COORDINATOR,
        BigInt(subscriptionId),
        KEY_HASH
    );

    await tieBreaker.waitForDeployment();
    const address = await tieBreaker.getAddress();

    console.log("");
    console.log("=".repeat(60));
    console.log("VRFTieBreaker deployed!");
    console.log("=".repeat(60));
    console.log("  Contract:       ", address);
    console.log("  VRF Coordinator:", VRF_COORDINATOR);
    console.log("  Key Hash:       ", KEY_HASH);
    console.log("  Subscription ID:", subscriptionId);
    console.log("  Network:         Base Sepolia");
    console.log("");
    console.log("NEXT STEPS:");
    console.log("  1. Add this consumer to your VRF subscription:");
    console.log(`     https://vrf.chain.link (add consumer: ${address})`);
    console.log("  2. Fund the subscription with LINK or native ETH");
    console.log("  3. Set VRF_TIE_BREAKER_ADDRESS in backend .env:");
    console.log(`     VRF_TIE_BREAKER_ADDRESS=${address}`);
    console.log("=".repeat(60));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
