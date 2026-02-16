/**
 * Bridge ETH from Sepolia → Base Sepolia via the official Base L1StandardBridge.
 *
 * Usage:  npx tsx scripts/bridge-eth-to-base.ts
 *
 * The bridged ETH typically arrives on Base Sepolia within ~1-2 minutes on testnet.
 */

import { ethers } from 'ethers';

// ── Config ──
const SEPOLIA_RPC = 'https://eth-sepolia.g.alchemy.com/v2/T5X9VboAQSGophgdJ8dmv';
const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';
const DEPLOYER_KEY = '3c71393d753e82190f9eb1e5f5934d2f9e4c798b6cdcf8c970a300673db699e1';

// Official Base Sepolia L1StandardBridge on Sepolia L1
// See: https://docs.base.org/docs/base-contracts
const L1_STANDARD_BRIDGE = '0x3154Cf16ccdb4C6d922629664174b904d80F2C35';

const BRIDGE_ABI = [
    'function depositETH(uint32 _minGasLimit, bytes _extraData) payable',
];

// How much ETH to bridge (leave some for Sepolia gas)
const BRIDGE_AMOUNT = ethers.parseEther('0.04'); // bridge 0.04 ETH, keep ~0.004 for Sepolia gas

async function main() {
    const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
    const baseProvider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC);
    const deployer = new ethers.Wallet(DEPLOYER_KEY, sepoliaProvider);

    console.log(`\n🌉 Bridge ETH: Sepolia → Base Sepolia`);
    console.log(`   Wallet:  ${deployer.address}`);
    console.log(`   Amount:  ${ethers.formatEther(BRIDGE_AMOUNT)} ETH`);
    console.log(`   Bridge:  ${L1_STANDARD_BRIDGE}\n`);

    // Check balances before
    const sepoliaBalBefore = await sepoliaProvider.getBalance(deployer.address);
    const baseBalBefore = await baseProvider.getBalance(deployer.address);
    console.log(`📊 Sepolia ETH BEFORE:      ${ethers.formatEther(sepoliaBalBefore)} ETH`);
    console.log(`📊 Base Sepolia ETH BEFORE: ${ethers.formatEther(baseBalBefore)} ETH`);

    if (sepoliaBalBefore < BRIDGE_AMOUNT + ethers.parseEther('0.002')) {
        console.log(`\n❌ Insufficient Sepolia ETH. Have ${ethers.formatEther(sepoliaBalBefore)}, need ${ethers.formatEther(BRIDGE_AMOUNT)} + gas`);
        return;
    }

    // Call depositETH on the L1StandardBridge
    const bridge = new ethers.Contract(L1_STANDARD_BRIDGE, BRIDGE_ABI, deployer);

    console.log(`\n📤 Sending depositETH transaction...`);
    const tx = await bridge.depositETH(
        200000,      // _minGasLimit — generous for simple ETH deposit
        '0x',        // _extraData — none needed
        { value: BRIDGE_AMOUNT }
    );

    console.log(`   Tx hash: ${tx.hash}`);
    console.log(`   Waiting for L1 confirmation...`);

    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt!.blockNumber} (gas used: ${receipt!.gasUsed})`);

    // Check Sepolia balance after
    const sepoliaBalAfter = await sepoliaProvider.getBalance(deployer.address);
    console.log(`\n📊 Sepolia ETH AFTER:       ${ethers.formatEther(sepoliaBalAfter)} ETH`);
    console.log(`\n⏳ The ETH should arrive on Base Sepolia within ~1-2 minutes.`);
    console.log(`   Monitor: https://sepolia.basescan.org/address/${deployer.address}`);

    // Wait and poll for Base Sepolia balance update
    console.log(`\n🔄 Polling Base Sepolia balance (checking every 15s for up to 5 minutes)...`);
    const startTime = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    while (Date.now() - startTime < timeout) {
        await new Promise(r => setTimeout(r, 15000));
        const baseBalNow = await baseProvider.getBalance(deployer.address);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`   [${elapsed}s] Base Sepolia: ${ethers.formatEther(baseBalNow)} ETH`);

        if (baseBalNow > baseBalBefore) {
            console.log(`\n✅ Bridge complete! Base Sepolia balance increased by ${ethers.formatEther(baseBalNow - baseBalBefore)} ETH`);
            console.log(`   Final Base Sepolia balance: ${ethers.formatEther(baseBalNow)} ETH`);
            return;
        }
    }

    console.log(`\n⚠️  Timed out waiting for bridge. The deposit was confirmed on L1 — it may still be processing.`);
    console.log(`   Check manually: https://sepolia.basescan.org/address/${deployer.address}`);
}

main().catch(console.error);
