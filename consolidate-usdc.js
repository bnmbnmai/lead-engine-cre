const { ethers } = require('ethers');

const RPC = 'https://eth-sepolia.g.alchemy.com/v2/T5X9VboAQSGophgdJ8dmv';
const USDC_ADDR = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const TARGET = '0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70';
const DEPLOYER_PK = '0x3c71393d753e82190f9eb1e5f5934d2f9e4c798b6cdcf8c970a300673db699e1';

const USDC_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
];

// Only wallets that have 20 USDC
const FUNDED_WALLETS = [
    { idx: 1, pk: '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439' },
    { idx: 2, pk: '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618' },
    { idx: 5, pk: '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7' },
    { idx: 7, pk: '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510' },
    { idx: 8, pk: '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd' },
    { idx: 9, pk: '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c' },
    { idx: 10, pk: '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382' },
];

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC);
    const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
    const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, provider);

    console.log(`Deployer: ${deployer.address}`);
    console.log(`Target:   ${TARGET}\n`);

    // Step 1: Send gas ETH to each funded wallet
    console.log('=== Step 1: Sending gas ETH to funded wallets ===');
    const GAS_AMOUNT = ethers.parseEther('0.005'); // ~0.005 ETH per wallet for gas

    for (const w of FUNDED_WALLETS) {
        const addr = new ethers.Wallet(w.pk).address;
        const ethBal = await provider.getBalance(addr);
        if (ethBal >= GAS_AMOUNT) {
            console.log(`  Wallet ${w.idx} (${addr.slice(0, 10)}): already has ETH, skipping`);
            continue;
        }
        console.log(`  Wallet ${w.idx} (${addr.slice(0, 10)}): sending 0.005 ETH for gas...`);
        const tx = await deployer.sendTransaction({ to: addr, value: GAS_AMOUNT });
        await tx.wait();
        console.log(`    ✓ tx: ${tx.hash}`);
    }

    // Step 2: Transfer USDC from each wallet to target
    console.log('\n=== Step 2: Transferring USDC to target ===');
    let totalTransferred = 0n;

    for (const w of FUNDED_WALLETS) {
        const wallet = new ethers.Wallet(w.pk, provider);
        const balance = await usdc.balanceOf(wallet.address);
        if (balance === 0n) {
            console.log(`  Wallet ${w.idx} (${wallet.address.slice(0, 10)}): 0 USDC, skipping`);
            continue;
        }
        console.log(`  Wallet ${w.idx} (${wallet.address.slice(0, 10)}): transferring ${Number(balance) / 1e6} USDC...`);
        const usdcWithSigner = new ethers.Contract(USDC_ADDR, USDC_ABI, wallet);
        const tx = await usdcWithSigner.transfer(TARGET, balance);
        await tx.wait();
        totalTransferred += balance;
        console.log(`    ✓ tx: ${tx.hash}`);
    }

    // Final balance check
    const finalBalance = await usdc.balanceOf(TARGET);
    console.log(`\n=== Done ===`);
    console.log(`Transferred: ${Number(totalTransferred) / 1e6} USDC`);
    console.log(`Target balance: ${Number(finalBalance) / 1e6} USDC`);
}

main().catch(console.error);
