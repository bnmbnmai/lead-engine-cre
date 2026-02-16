import { ethers } from "hardhat";

/**
 * Set the Chainlink Functions subscription ID on the CREVerifier contract.
 * 
 * Reads CRE_SUBSCRIPTION_ID from backend/.env
 * CREVerifier address: 0x86C8f348d816c35Fc0bd364e4A9Fa8a1E0fd930e (Base Sepolia)
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    const CRE_VERIFIER_ADDRESS = "0x86C8f348d816c35Fc0bd364e4A9Fa8a1E0fd930e";
    const subscriptionId = Number(process.env.CRE_SUBSCRIPTION_ID || "0");

    if (subscriptionId === 0) {
        console.error("❌ CRE_SUBSCRIPTION_ID is not set (or is 0). Update backend/.env first.");
        process.exit(1);
    }

    console.log(`\nSetting CREVerifier subscription ID to: ${subscriptionId}`);
    console.log(`CREVerifier: ${CRE_VERIFIER_ADDRESS}`);

    const creVerifier = await ethers.getContractAt("CREVerifier", CRE_VERIFIER_ADDRESS);

    const tx = await creVerifier.setChainlinkSubscription(subscriptionId);
    console.log(`TX hash: ${tx.hash}`);
    await tx.wait();

    // Verify it was set
    const currentSubId = await creVerifier.subscriptionId();
    console.log(`\n✅ Subscription ID set to: ${currentSubId}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Failed:", error);
        process.exit(1);
    });
