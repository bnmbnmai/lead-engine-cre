/**
 * bridge-eth-to-base.ts — Bridge ETH from Sepolia → Base Sepolia
 *
 * Uses the Base L1StandardBridge on Ethereum Sepolia to deposit ETH,
 * which appears on Base Sepolia after ~2–5 minutes.
 *
 * Usage:
 *   npx hardhat run scripts/testnet/bridge-eth-to-base.ts --network sepolia
 */

import { ethers } from "hardhat";

// Base Sepolia L1StandardBridge on Ethereum Sepolia
const L1_STANDARD_BRIDGE = "0xfd0Bf71F60660E2f608ed56e1659C450eB113120";

const BRIDGE_ABI = [
    "function depositETH(uint32 _minGasLimit, bytes calldata _extraData) payable",
];

async function main() {
    const [deployer] = await ethers.getSigners();
    const balance = await ethers.provider.getBalance(deployer.address);

    console.log("═".repeat(60));
    console.log("🌉 BRIDGE ETH: Sepolia → Base Sepolia");
    console.log("═".repeat(60));
    console.log(`Deployer:    ${deployer.address}`);
    console.log(`Balance:     ${ethers.formatEther(balance)} ETH`);
    console.log(`Bridge:      ${L1_STANDARD_BRIDGE}`);

    // Keep 0.01 ETH for gas on Sepolia
    const gasReserve = ethers.parseEther("0.01");
    if (balance <= gasReserve) {
        throw new Error(`Insufficient balance. Have ${ethers.formatEther(balance)} ETH, need > 0.01 for gas`);
    }

    const bridgeAmount = balance - gasReserve;
    console.log(`Gas reserve: 0.01 ETH`);
    console.log(`Bridging:    ${ethers.formatEther(bridgeAmount)} ETH`);
    console.log();

    const bridge = new ethers.Contract(L1_STANDARD_BRIDGE, BRIDGE_ABI, deployer);

    console.log("📤 Sending bridge transaction...");
    const tx = await bridge.depositETH(
        200_000,      // minGasLimit for L2 execution
        "0x",         // no extra data
        { value: bridgeAmount }
    );

    console.log(`  Tx hash: ${tx.hash}`);
    console.log(`  ⏳ Waiting for confirmation...`);

    const receipt = await tx.wait();
    console.log(`  ✅ Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);

    const remainingBalance = await ethers.provider.getBalance(deployer.address);
    console.log(`\n📊 Remaining Sepolia balance: ${ethers.formatEther(remainingBalance)} ETH`);
    console.log(`\n🌉 ${ethers.formatEther(bridgeAmount)} ETH bridging to Base Sepolia`);
    console.log(`   Funds should arrive in ~2–5 minutes`);
    console.log(`\n🔗 Track: https://sepolia.etherscan.io/tx/${receipt.hash}`);
    console.log(`🔗 Base Sepolia: https://sepolia.basescan.org/address/${deployer.address}`);
    console.log("\n✅ Bridge transaction complete");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Bridge failed:", error.message || error);
        process.exit(1);
    });
