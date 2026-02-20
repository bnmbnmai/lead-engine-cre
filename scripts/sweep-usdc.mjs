/**
 * sweep-usdc.mjs — Consolidate all Base Sepolia USDC from faucet wallets into deployer
 *
 * Usage: node sweep-usdc.mjs
 *
 * Steps per wallet:
 *   1. Check USDC balance
 *   2. If > 0: ensure gas (top-up 0.001 ETH from deployer if needed)
 *   3. Transfer full USDC balance to deployer
 * Retry up to 3x with 20% gas escalation on failure.
 */

import { ethers } from 'ethers';

// ── Config ─────────────────────────────────────
const RPC_URL = 'https://sepolia.base.org';
const DEPLOYER_PK = '3c71393d753e82190f9eb1e5f5934d2f9e4c798b6cdcf8c970a300673db699e1';
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const FAUCET_WALLETS = [
    { addr: '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9', pk: '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439' }, // Wallet 1 (buyer)
    { addr: '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC', pk: '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618' }, // Wallet 2 (buyer)
    { addr: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58', pk: '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e' }, // Wallet 3 (buyer)
    { addr: '0x424CaC929939377f221348af52d4cb1247fE4379', pk: '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7' }, // Wallet 4 (buyer)
    { addr: '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d', pk: '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7' }, // Wallet 5 (buyer)
    { addr: '0x089B6Bdb4824628c5535acF60aBF80683452e862', pk: '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75' }, // Wallet 6 (buyer)
    { addr: '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE', pk: '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510' }, // Wallet 7 (buyer)
    { addr: '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C', pk: '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd' }, // Wallet 8 (buyer)
    { addr: '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf', pk: '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c' }, // Wallet 9 (buyer)
    { addr: '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad', pk: '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382' }, // Wallet 10 (buyer)
    { addr: '0x9Bb15F98982715E33a2113a35662036528eE0A36', pk: '0x618bee99ca60f5511dad533a998344f3a0a7b2339db5726ae33d56fd543294ce' }, // Wallet 11 (SELLER ONLY — added 2026-02-19)
];

const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployerKey = DEPLOYER_PK.startsWith('0x') ? DEPLOYER_PK : '0x' + DEPLOYER_PK;
    const deployer = new ethers.Wallet(deployerKey, provider);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  USDC Consolidation — Base Sepolia`);
    console.log(`  Deployer: ${deployer.address}`);
    console.log(`  RPC:      ${RPC_URL}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Snapshot deployer balance before sweep
    const deployerUsdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, deployer);
    const beforeBal = await deployerUsdcContract.balanceOf(deployer.address);
    console.log(`📊 Deployer USDC before sweep: $${ethers.formatUnits(beforeBal, 6)}\n`);

    const network = await provider.getNetwork();
    console.log(`🌐 Connected to chainId ${network.chainId}\n`);

    let totalSwept = 0n;

    for (const { addr, pk } of FAUCET_WALLETS) {
        console.log(`─── ${addr.slice(0, 10)}… ─────────────────────────────`);

        const walletSigner = new ethers.Wallet(pk, provider);
        const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, walletSigner);

        // Check USDC balance
        const bal = await usdc.balanceOf(addr);
        if (bal === 0n) {
            console.log(`  ⏭  $0.00 — skipping`);
            continue;
        }
        console.log(`  💰 Balance: $${ethers.formatUnits(bal, 6)} USDC`);

        // Check ETH for gas
        const ethBal = await provider.getBalance(addr);
        console.log(`  ⛽ ETH:     ${ethers.formatEther(ethBal)}`);

        if (ethBal < ethers.parseEther('0.0003')) {
            console.log(`  🔼 Topping up ETH from deployer…`);
            try {
                const gasTx = await deployer.sendTransaction({
                    to: addr,
                    value: ethers.parseEther('0.001'),
                });
                await gasTx.wait();
                console.log(`  ✅ ETH top-up confirmed`);
            } catch (e) {
                console.log(`  ❌ ETH top-up failed: ${e.message?.slice(0, 80)}`);
                continue;
            }
        }

        // Transfer with retry
        let swept = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const feeData = await provider.getFeeData();
                const gasPrice = feeData.gasPrice
                    ? (feeData.gasPrice * BigInt(100 + (attempt - 1) * 20)) / 100n
                    : undefined;

                // Re-read live balance before transfer (in case something changed)
                const liveBal = await usdc.balanceOf(addr);
                if (liveBal === 0n) { swept = true; break; }

                const tx = await usdc.transfer(deployer.address, liveBal, gasPrice ? { gasPrice } : {});
                const receipt = await tx.wait();
                console.log(`  ✅ Transferred $${ethers.formatUnits(liveBal, 6)} → deployer (attempt ${attempt}, tx: ${receipt.hash.slice(0, 10)}…)`);
                totalSwept += liveBal;
                swept = true;
                break;
            } catch (e) {
                const msg = e.message?.slice(0, 80) ?? 'unknown';
                if (attempt < 3) {
                    console.log(`  ⚠️  Attempt ${attempt}/3 failed: ${msg} — retrying in ${1500 * attempt}ms…`);
                    await sleep(1500 * attempt);
                } else {
                    console.log(`  ❌ All 3 attempts failed for ${addr.slice(0, 10)}…: ${msg}`);
                }
            }
        }
    }

    // Final deployer balance
    const afterBal = await deployerUsdcContract.balanceOf(deployer.address);
    const netGain = afterBal - beforeBal;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ✅ Sweep complete`);
    console.log(`  Before:       $${ethers.formatUnits(beforeBal, 6)}`);
    console.log(`  After:        $${ethers.formatUnits(afterBal, 6)}`);
    console.log(`  Net received: $${ethers.formatUnits(netGain > 0n ? netGain : 0n, 6)}`);
    console.log(`  Total swept:  $${ethers.formatUnits(totalSwept, 6)}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Also log deployer ETH balance
    const deployerEth = await provider.getBalance(deployer.address);
    console.log(`  Deployer ETH (Base Sepolia): ${ethers.formatEther(deployerEth)} ETH`);
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
