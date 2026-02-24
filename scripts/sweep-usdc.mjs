/**
 * sweep-usdc.mjs — Sweeps all USDC from every faucet wallet to the deployer.
 * 
 * Run: node scripts/sweep-usdc.mjs
 *
 * Skips wallets with zero USDC balance. Handles gas estimation gracefully.
 * Leaves a small ETH float in each wallet (no ETH drain — gas only consumed).
 */

import { ethers } from 'ethers';

// ── Config ──────────────────────────────────────────────────────────────
const RPC_URL = 'https://sepolia.base.org';
const USDC_ADDR = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Base Sepolia USDC
const DEPLOYER = '0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70';

const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
];

// ── All source wallets (every wallet except the deployer itself) ─────────
const WALLETS = [
    // Wallets 1–10 (demo buyers)
    { name: 'Wallet 1', pk: '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439' },
    { name: 'Wallet 2', pk: '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618' },
    { name: 'Wallet 3', pk: '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e' },
    { name: 'Wallet 4', pk: '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7' },
    { name: 'Wallet 5', pk: '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7' },
    { name: 'Wallet 6', pk: '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75' },
    { name: 'Wallet 7', pk: '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510' },
    { name: 'Wallet 8', pk: '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd' },
    { name: 'Wallet 9', pk: '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c' },
    { name: 'Wallet 10', pk: '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382' },
    // Wallet 11 — seller, include in sweep (USDC goes to deployer too)
    { name: 'Wallet 11 (seller)', pk: '0x618bee99ca60f5511dad533a998344f3a0a7b2339db5726ae33d56fd543294ce' },
    // Wallets 12–31 (extra faucet wallets)
    { name: 'Wallet 12', pk: '0x0889cf6cd5d134fad9f188b3e5198c8bb3bfc1ca525baecb5ebebfb36273ffb6' },
    { name: 'Wallet 13', pk: '0xe9cb1a58b0c4d8975f5f58ae66476f313ea108e0b0f7c79758f9a3867e985d2a' },
    { name: 'Wallet 14', pk: '0xd0dd671ddf01c918eaf284a9694e3d81e05b4968ee667e01dd6189da301e1ccd' },
    { name: 'Wallet 15', pk: '0x2206fc3d962595fca97534d9fb1da1186aa40e205d8d8959760324eabe041283' },
    { name: 'Wallet 16', pk: '0x994f19fa1c0f6ede154f0fdea0bb18b63cbae4ace3efa0ce268e7b091dff8ec9' },
    { name: 'Wallet 17', pk: '0x94d9edff9216ca3b3c167d50a74e900b0fe791bc87672ebfb68d5969c2f80efc' },
    { name: 'Wallet 18', pk: '0x71d16660634ac579891c0a191e7b346fec3bdc3b5142870cbec316ad460cb2db' },
    { name: 'Wallet 19', pk: '0xc34c62ab1a30bfb012849607a5b3341662324e7a5586e94d4338c19349808d8b' },
    { name: 'Wallet 20', pk: '0x3ec08c170419c70b1fff2fda6c96534b8a9ee907028511ee5df12412cae1fa67' },
    { name: 'Wallet 21', pk: '0x50a537c401289ce27f1b9001aa6c6aa85bfecc80b65c9850674ab947ec71011b' },
    { name: 'Wallet 22', pk: '0x970aa8afe6736bf5333727d58fcc82baf5ed5083992860b31bec5ba76b9c2e14' },
    { name: 'Wallet 23', pk: '0x7d20781c4851156a831c1416501fe8ee61d4771ff3c16d649ba12c10644f4317' },
    { name: 'Wallet 24', pk: '0x11376e63cb9087f93b73bc3b3176db9cf4e1394934794cde1fb7373405eccc55' },
    { name: 'Wallet 25', pk: '0x405ec04f53336c5164139fad710097dd2ec60905bbbe53b1570bc2743a0afcda' },
    { name: 'Wallet 26', pk: '0x5210d1a51a694312f961f28cd708d1978fb0831aed5a7a13a73fe8109b804732' },
    { name: 'Wallet 27', pk: '0xdd55ac24672eb6f96d9a382fa14934cb32b5e107bedf41c5b693d1a6c307ab52' },
    { name: 'Wallet 28', pk: '0xcbd79e6ccc1ac72ca4235ca06d257ee52256c91a66a1203cf00d5481bfb683b8' },
    { name: 'Wallet 29', pk: '0x2f04af05fb35cb9057520193591b3e9cc3edaa344340d8b16819a8a192913a7c' },
    { name: 'Wallet 30', pk: '0x608c0243e5a03c67024ab534a7c005e550178671b1fbbaf04b3242fe4b833264' },
    { name: 'Wallet 31', pk: '0xbc85db2a8d67ea2d0b9d3fa74d64c240b24be4f40450f80765eea269d47156bc' },
];

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    // Print deployer balance before
    const deployerUsdc = new ethers.Contract(USDC_ADDR, USDC_ABI, provider);
    const beforeBal = await deployerUsdc.balanceOf(DEPLOYER);
    console.log(`\n💰 Deployer USDC before: $${(Number(beforeBal) / 1e6).toFixed(2)}\n`);
    console.log(`Sweeping ${WALLETS.length} wallets → ${DEPLOYER}\n${'─'.repeat(60)}`);

    let totalSwept = 0n;
    let swept = 0;
    let skipped = 0;

    for (const { name, pk } of WALLETS) {
        const wallet = new ethers.Wallet(pk, provider);
        const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, wallet);

        try {
            const bal = await usdc.balanceOf(wallet.address);
            if (bal === 0n) {
                console.log(`  ⬜ ${name} (${wallet.address.slice(0, 10)}…) — $0.00, skipping`);
                skipped++;
                continue;
            }

            const usdcAmt = (Number(bal) / 1e6).toFixed(2);

            // Check ETH for gas
            const ethBal = await provider.getBalance(wallet.address);
            if (ethBal < ethers.parseEther('0.0001')) {
                console.log(`  ⚠️  ${name} — $${usdcAmt} USDC but insufficient ETH for gas (${ethers.formatEther(ethBal)} ETH) — skipping`);
                skipped++;
                continue;
            }

            const tx = await usdc.transfer(DEPLOYER, bal, {
                maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
                maxFeePerGas: ethers.parseUnits('10', 'gwei'),
            });
            console.log(`  🔄 ${name} — sending $${usdcAmt} USDC… tx: ${tx.hash.slice(0, 20)}…`);
            await tx.wait();
            console.log(`  ✅ ${name} — $${usdcAmt} swept`);
            totalSwept += bal;
            swept++;

            // Small delay to avoid RPC rate limits
            await new Promise(r => setTimeout(r, 500));
        } catch (err) {
            console.log(`  ❌ ${name} — error: ${err.shortMessage ?? err.message.slice(0, 80)}`);
        }
    }

    const afterBal = await deployerUsdc.balanceOf(DEPLOYER);
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`✅ Done — swept ${swept} wallets, skipped ${skipped}`);
    console.log(`💸 Total swept:  $${(Number(totalSwept) / 1e6).toFixed(2)} USDC`);
    console.log(`💰 Deployer now: $${(Number(afterBal) / 1e6).toFixed(2)} USDC`);
}

main().catch(err => { console.error(err); process.exit(1); });
