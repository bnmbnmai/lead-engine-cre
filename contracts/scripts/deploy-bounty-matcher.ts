/**
 * Deploy BountyMatcher to Base Sepolia
 *
 * Usage:
 *   npx hardhat run scripts/deploy-bounty-matcher.ts --network baseSepolia
 *
 * Prerequisites:
 *   - DEPLOYER_PRIVATE_KEY env var set
 *   - Existing Functions subscription (same as CREVerifier)
 *   - FUNCTIONS_SUBSCRIPTION_ID env var set
 */

import { ethers } from "hardhat";

// Base Sepolia Chainlink Functions parameters
const FUNCTIONS_ROUTER = "0xf9B8fc078197181C841c296C876945aaa425B278";
const DON_ID = ethers.encodeBytes32String("fun-base-sepolia-1");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying BountyMatcher with account:", deployer.address);

    const subscriptionId = process.env.FUNCTIONS_SUBSCRIPTION_ID;
    if (!subscriptionId) {
        console.error("ERROR: Set FUNCTIONS_SUBSCRIPTION_ID env var");
        console.error("Use the same subscription as CREVerifier, or create a new one at https://functions.chain.link");
        process.exit(1);
    }

    const BountyMatcher = await ethers.getContractFactory("BountyMatcher");
    const matcher = await BountyMatcher.deploy(
        FUNCTIONS_ROUTER,
        DON_ID,
        BigInt(subscriptionId),
        deployer.address
    );

    await matcher.waitForDeployment();
    const address = await matcher.getAddress();

    console.log("");
    console.log("=".repeat(60));
    console.log("BountyMatcher deployed!");
    console.log("=".repeat(60));
    console.log("  Contract:          ", address);
    console.log("  Functions Router:  ", FUNCTIONS_ROUTER);
    console.log("  DON ID:            ", "fun-base-sepolia-1");
    console.log("  Subscription ID:   ", subscriptionId);
    console.log("  Network:            Base Sepolia");
    console.log("");
    console.log("NEXT STEPS:");
    console.log("  1. Add this consumer to your Functions subscription:");
    console.log(`     https://functions.chain.link (add consumer: ${address})`);
    console.log("  2. Upload the matching source code:");
    console.log("     npx hardhat run scripts/upload-bounty-source.ts --network baseSepolia");
    console.log("  3. Set BOUNTY_MATCHER_ADDRESS in backend .env:");
    console.log(`     BOUNTY_MATCHER_ADDRESS=${address}`);
    console.log("  4. Optionally set requireFunctionsAttestation on VerticalBountyPool:");
    console.log("     bountyPool.setBountyMatcher(bountyMatcherAddress)");
    console.log("=".repeat(60));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
