import { ethers } from 'ethers';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: './backend/.env' });

const RPC = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';
const provider = new ethers.JsonRpcProvider(RPC);
const DEPLOYER_PK = (process.env.DEPLOYER_PRIVATE_KEY || '').startsWith('0x')
    ? process.env.DEPLOYER_PRIVATE_KEY
    : '0x' + process.env.DEPLOYER_PRIVATE_KEY;
const deployer = new ethers.Wallet(DEPLOYER_PK, provider);

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const OLD_VAULT = '0xf09cf1d4389A1Af11542F96280dc91739E866e74';
const NEW_VAULT = '0x56bB31bE214C54ebeCA55cd86d86512b94310F8C';
const OLD_VAULT2 = '0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4';
const RTB_ESCROW = '0xf3fCB43f882b5aDC43c2E7ae92c3ec5005e4cBa2';

const usdcAbi = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
];
const vaultAbi = [
    'function balanceOf(address) view returns (uint256)',
    'function lockedBalances(address) view returns (uint256)',
    'function withdraw(uint256) external',
];

const usdc = new ethers.Contract(USDC, usdcAbi, provider);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const WALLETS = [
    { l: 'W1', a: '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9', pk: '0x19216c3bfe31894b4e665dcf027d5c6981bdf653ad804cf4a9cfaeae8c0e5439' },
    { l: 'W2', a: '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC', pk: '0x386ada6171840866e14a842b7343140c0a7d5f22d09199203cacc0d1f03f6618' },
    { l: 'W3', a: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58', pk: '0xd4c33251ccbdfb62e5aa960f09ffb795ce828ead9ffdfeb5a96d0e74a04eb33e' },
    { l: 'W4', a: '0x424CaC929939377f221348af52d4cb1247fE4379', pk: '0x0dde9bf7cda4f0a0075ed0cf481572cdebe6e1a7b8cf0d83d6b31c5dcf6d4ca7' },
    { l: 'W5', a: '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d', pk: '0xf683cedd280564b34242d5e234916f388e08ae83e4254e03367292ddf2adcea7' },
    { l: 'W6', a: '0x089B6Bdb4824628c5535acF60aBF80683452e862', pk: '0x17455af639c289b4d9347efabb3c0162db3f89e270f62813db7cf6802a988a75' },
    { l: 'W7', a: '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE', pk: '0xe5342ff07832870aecb195cd10fd3f5e34d26a3e16a9f125182adf4f93b3d510' },
    { l: 'W8', a: '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C', pk: '0x0a1a294a4b5ad500d87fc19a97fa8eb55fea675d72fe64f8081179af014cc7fd' },
    { l: 'W9', a: '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf', pk: '0x8b760a87e83e10e1a173990c6cd6b4aab700dd303ddf17d3701ab00e4b09750c' },
    { l: 'W10', a: '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad', pk: '0x2014642678f5d0670148d8cddb76260857bb24bca6482d8f5174c962c6626382' },
    { l: 'W11', a: '0x9Bb15F98982715E33a2113a35662036528eE0A36', pk: '0x618bee99ca60f5511dad533a998344f3a0a7b2339db5726ae33d56fd543294ce' },
];

async function ensureGas(addr) {
    const eth = await provider.getBalance(addr);
    if (eth < ethers.parseEther('0.0005')) {
        const tx = await deployer.sendTransaction({ to: addr, value: ethers.parseEther('0.001') });
        await tx.wait();
        console.log(`  gas topped up for ${addr.slice(0, 10)}`);
    }
}

async function main() {
    // --- AUDIT FIRST ---
    console.log('=== FULL USDC AUDIT ===\n');
    const allVaults = [
        { l: 'Old Vault  (0xf09cf1d4)', a: OLD_VAULT },
        { l: 'New Vault  (0x56bB31bE)', a: NEW_VAULT },
        { l: 'Old Vault2 (0x11bb8AF)', a: OLD_VAULT2 },
        { l: 'RTBEscrow  (0xf3fCB43)', a: RTB_ESCROW },
    ];
    let contractSum = 0n;
    for (const v of allVaults) {
        const b = await usdc.balanceOf(v.a);
        console.log(v.l, '-> $' + Number(b) / 1e6);
        contractSum += b;
    }

    const oldV = new ethers.Contract(OLD_VAULT, vaultAbi, provider);
    const newV = new ethers.Contract(NEW_VAULT, vaultAbi, provider);
    const oldV2 = new ethers.Contract(OLD_VAULT2, vaultAbi, provider);

    console.log('\nWallet balances:');
    console.log('Label      | raw USDC  | oldV free | newV free | oldV2 free | newV locked');

    let totalRaw = 0n, totalNewFree = 0n, totalNewLock = 0n, totalOld2Free = 0n, totalOldFree = 0n;
    const allWallets = [{ l: 'Deployer', a: deployer.address, pk: null }, ...WALLETS];
    for (const w of allWallets) {
        const raw = await usdc.balanceOf(w.a);
        const of = await oldV.balanceOf(w.a).catch(() => 0n);
        const nf = await newV.balanceOf(w.a).catch(() => 0n);
        const nl = await newV.lockedBalances(w.a).catch(() => 0n);
        const o2f = await oldV2.balanceOf(w.a).catch(() => 0n);
        totalRaw += raw; totalOldFree += of; totalNewFree += nf; totalNewLock += nl; totalOld2Free += o2f;
        const any = raw > 0n || of > 0n || nf > 0n || nl > 0n || o2f > 0n;
        if (any || w.l === 'Deployer')
            console.log(w.l.padEnd(10), '|', ('$' + Number(raw) / 1e6).padStart(9), '|', ('$' + Number(of) / 1e6).padStart(9), '|', ('$' + Number(nf) / 1e6).padStart(9), '|', ('$' + Number(o2f) / 1e6).padStart(10), '|', ('$' + Number(nl) / 1e6).padStart(11));
    }
    console.log('\nTOTALS     | raw=$' + Number(totalRaw) / 1e6, '| newV free=$' + Number(totalNewFree) / 1e6, '| newV locked=$' + Number(totalNewLock) / 1e6, '| oldV2 free=$' + Number(totalOld2Free) / 1e6);
    console.log('Contract holdings: $' + Number(contractSum) / 1e6);
    console.log('GRAND TOTAL (raw wallets + contracts): $' + Number(totalRaw + contractSum) / 1e6);

    // --- SWEEP ---
    const deployerBefore = await usdc.balanceOf(deployer.address);
    console.log('\n=== SWEEP ===');
    console.log('Deployer before: $' + Number(deployerBefore) / 1e6);
    let swept = 0n;

    // Step A: drain oldV2 per-wallet free balances
    for (const w of WALLETS) {
        const free = await oldV2.balanceOf(w.a).catch(() => 0n);
        if (free === 0n) continue;
        console.log(`${w.l} oldV2 free=$${Number(free) / 1e6} — withdrawing`);
        await ensureGas(w.a);
        const sgn = new ethers.Wallet(w.pk, provider);
        const v2s = new ethers.Contract(OLD_VAULT2, vaultAbi, sgn);
        try {
            const tx = await v2s.withdraw(free, { gasLimit: 200000 });
            await tx.wait();
        } catch (e) { console.log(`  withdraw failed: ${e.message?.slice(0, 70)}`); continue; }
        await sleep(400);
        const walBal = await usdc.balanceOf(w.a);
        if (walBal > 0n) {
            const us = new ethers.Contract(USDC, usdcAbi, sgn);
            const tx2 = await us.transfer(deployer.address, walBal);
            await tx2.wait();
            console.log(`  swept $${Number(walBal) / 1e6}`);
            swept += walBal;
        }
        await sleep(300);
    }

    // Step B: sweep any raw wallet USDC
    for (const w of WALLETS) {
        const bal = await usdc.balanceOf(w.a);
        if (bal === 0n) continue;
        console.log(`${w.l} raw=$${Number(bal) / 1e6} — sweeping`);
        await ensureGas(w.a);
        const sgn = new ethers.Wallet(w.pk, provider);
        const us = new ethers.Contract(USDC, usdcAbi, sgn);
        try {
            const tx = await us.transfer(deployer.address, bal);
            await tx.wait();
            console.log(`  swept $${Number(bal) / 1e6}`);
            swept += bal;
        } catch (e) { console.log(`  failed: ${e.message?.slice(0, 70)}`); }
        await sleep(300);
    }

    // Step C: deployer's own free balance in new vault
    const depNewFree = await newV.balanceOf(deployer.address).catch(() => 0n);
    console.log(`Deployer newV free: $${Number(depNewFree) / 1e6}`);

    const deployerAfter = await usdc.balanceOf(deployer.address);
    console.log(`\nSwept: $${Number(swept) / 1e6}`);
    console.log(`Deployer after: $${Number(deployerAfter) / 1e6} (net +$${Number(deployerAfter - deployerBefore) / 1e6})`);

    // Re-audit vaults
    console.log('\n=== REMAINING IN VAULTS ===');
    for (const v of allVaults) {
        const b = await usdc.balanceOf(v.a);
        console.log(v.l, '-> $' + Number(b) / 1e6);
    }
}
main().catch(e => console.error('ERROR:', e.message));
