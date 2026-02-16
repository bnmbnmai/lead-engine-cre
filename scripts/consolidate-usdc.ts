/**
 * Consolidate USDC from all faucet wallets → single test wallet on Base Sepolia.
 * Step 1: Fund each faucet wallet with gas ETH from the deployer wallet
 * Step 2: Transfer all USDC to the target wallet
 *
 * Usage:  npx tsx scripts/consolidate-usdc.ts
 */

import { ethers } from 'ethers';

// ── Config ──
const RPC_URL = 'https://sepolia.base.org';
const RPC_URL_SEPOLIA = 'https://eth-sepolia.g.alchemy.com/v2/T5X9VboAQSGophgdJ8dmv';
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Base Sepolia USDC
const TARGET_WALLET = '0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70';
const DEPLOYER_KEY = '3c71393d753e82190f9eb1e5f5934d2f9e4c798b6cdcf8c970a300673db699e1';
const GAS_AMOUNT = ethers.parseEther('0.000025'); // 0.000025 ETH per wallet — plenty for 1 ERC20 transfer on L2

const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function transfer(address to, uint256 amount) returns (bool)',
];

const FAUCET_WALLETS = [
    { addr: '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9', pk: '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439' },
    { addr: '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC', pk: '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618' },
    { addr: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58', pk: '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e' },
    { addr: '0x424CaC929939377f221348af52d4cb1247fE4379', pk: '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7' },
    { addr: '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d', pk: '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7' },
    { addr: '0x089B6Bdb4824628c5535acF60aBF80683452e862', pk: '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75' },
    { addr: '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE', pk: '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510' },
    { addr: '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C', pk: '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd' },
    { addr: '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf', pk: '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c' },
    { addr: '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad', pk: '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382' },
];

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
    const decimals = await usdc.decimals();

    console.log(`\n🔗 Base Sepolia USDC Consolidation`);
    console.log(`   USDC:     ${USDC_ADDRESS}`);
    console.log(`   Target:   ${TARGET_WALLET}`);
    console.log(`   Deployer: ${deployer.address}`);

    // ── Check deployer balances ──
    const deployerEthBase = await provider.getBalance(deployer.address);
    console.log(`\n📊 Deployer ETH on Base Sepolia: ${ethers.formatEther(deployerEthBase)} ETH`);

    // Also check Sepolia for context
    try {
        const sepoliaProvider = new ethers.JsonRpcProvider(RPC_URL_SEPOLIA);
        const deployerEthSepolia = await sepoliaProvider.getBalance(deployer.address);
        console.log(`📊 Deployer ETH on Sepolia:      ${ethers.formatEther(deployerEthSepolia)} ETH`);
    } catch {
        console.log(`📊 Deployer ETH on Sepolia:      (couldn't check)`);
    }

    const totalGasNeeded = GAS_AMOUNT * BigInt(FAUCET_WALLETS.length);
    console.log(`\n⛽ Gas needed: ${ethers.formatEther(totalGasNeeded)} ETH (${ethers.formatEther(GAS_AMOUNT)} × ${FAUCET_WALLETS.length} wallets)`);

    if (deployerEthBase < totalGasNeeded) {
        console.log(`\n❌ Deployer has insufficient Base Sepolia ETH.`);
        console.log(`   Has:    ${ethers.formatEther(deployerEthBase)} ETH`);
        console.log(`   Needs:  ${ethers.formatEther(totalGasNeeded)} ETH`);
        console.log(`\n💡 Fund the deployer (${deployer.address}) with Base Sepolia ETH first.`);
        console.log(`   Use: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet`);
        console.log(`   Or bridge from Sepolia using: https://superbridge.app/base-sepolia`);
        return;
    }

    // Check target balance before
    const targetBefore = await usdc.balanceOf(TARGET_WALLET);
    console.log(`\n📊 Target USDC balance BEFORE: ${ethers.formatUnits(targetBefore, decimals)} USDC`);

    // ── Step 1: Fund each wallet with gas ──
    console.log(`\n━━━ Step 1: Funding gas ━━━`);
    for (const wallet of FAUCET_WALLETS) {
        const ethBal = await provider.getBalance(wallet.addr);
        if (ethBal >= GAS_AMOUNT) {
            console.log(`⏭️  ${wallet.addr.slice(0, 10)}… already has ${ethers.formatEther(ethBal)} ETH`);
            continue;
        }

        const usdcBal = await usdc.balanceOf(wallet.addr);
        if (usdcBal === 0n) {
            console.log(`⏭️  ${wallet.addr.slice(0, 10)}… has 0 USDC — no need to fund`);
            continue;
        }

        try {
            const tx = await deployer.sendTransaction({
                to: wallet.addr,
                value: GAS_AMOUNT,
            });
            console.log(`⛽ Funded ${wallet.addr.slice(0, 10)}… with ${ethers.formatEther(GAS_AMOUNT)} ETH — tx: ${tx.hash}`);
            await tx.wait();
            console.log(`   ✅ Confirmed`);
        } catch (err: any) {
            console.error(`   ❌ Failed to fund ${wallet.addr.slice(0, 10)}…: ${err.message}`);
        }
    }

    // ── Step 2: Sweep USDC ──
    console.log(`\n━━━ Step 2: Sweeping USDC ━━━`);
    let totalSent = 0n;
    let txCount = 0;

    for (const wallet of FAUCET_WALLETS) {
        const balance = await usdc.balanceOf(wallet.addr);
        if (balance === 0n) {
            console.log(`⏭️  ${wallet.addr.slice(0, 10)}… — 0 USDC, skipping`);
            continue;
        }

        const readable = ethers.formatUnits(balance, decimals);
        console.log(`💰 ${wallet.addr.slice(0, 10)}… — ${readable} USDC`);

        const signer = new ethers.Wallet(wallet.pk, provider);
        const usdcWithSigner = usdc.connect(signer) as ethers.Contract;

        try {
            const tx = await usdcWithSigner.transfer(TARGET_WALLET, balance);
            console.log(`   📤 Sending ${readable} USDC → tx: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`   ✅ Confirmed in block ${receipt!.blockNumber}`);
            totalSent += balance;
            txCount++;
        } catch (err: any) {
            console.error(`   ❌ Transfer failed: ${err.message}`);
        }
    }

    // Final summary
    const targetAfter = await usdc.balanceOf(TARGET_WALLET);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 Target balance AFTER:  ${ethers.formatUnits(targetAfter, decimals)} USDC`);
    console.log(`📤 Total sent:            ${ethers.formatUnits(totalSent, decimals)} USDC across ${txCount} transactions`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(console.error);
