/**
 * scripts/audit-usdc-deep.mjs
 *
 * Read-only deep audit — checks USDC balance at EVERY known address:
 *   • All 11 demo wallets (wallet-level)
 *   • Vault v2 (active): free + locked per wallet, plus USDC held by contract itself
 *   • Vault v1 (retired): same
 *   • All other contracts: LeadNFT, RTBEscrow, ACE, CRE, Marketplace,
 *     VerticalNFT, VerticalAuction, CustomLeadFeed
 *   • Deployer wallet
 *
 * No transactions. Safe to run anytime.
 */

import { ethers } from 'ethers';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dir, '../backend/.env') });

const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';
const USDC_ADDR = process.env.USDC_CONTRACT_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const VAULT_V2 = process.env.VAULT_ADDRESS_BASE_SEPOLIA || '0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4';
const VAULT_V1 = '0xcB949C0867B39C5adDDe45031E6C760A0Aa0CE13';

const DEPLOYER_PK = (process.env.DEPLOYER_PRIVATE_KEY || '').startsWith('0x')
    ? process.env.DEPLOYER_PRIVATE_KEY
    : '0x' + (process.env.DEPLOYER_PRIVATE_KEY || '');

const provider = new ethers.JsonRpcProvider(RPC_URL);
const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
const DEPLOYER_ADDR = deployer.address;

// All demo wallets
const WALLETS = [
    { label: 'Wallet 1  (buyer)', addr: '0xa75d76b27fF9511354c78Cb915cFc106c6b23Dd9' },
    { label: 'Wallet 2  (buyer)', addr: '0x55190CE8A38079d8415A1Ba15d001BC1a52718eC' },
    { label: 'Wallet 3  (buyer)', addr: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58' },
    { label: 'Wallet 4  (buyer)', addr: '0x424CaC929939377f221348af52d4cb1247fE4379' },
    { label: 'Wallet 5  (buyer)', addr: '0x3a9a41078992734ab24Dfb51761A327eEaac7b3d' },
    { label: 'Wallet 6  (buyer)', addr: '0x089B6Bdb4824628c5535acF60aBF80683452e862' },
    { label: 'Wallet 7  (buyer)', addr: '0xc92A0A5080077fb8C2B756f8F52419Cb76d99afE' },
    { label: 'Wallet 8  (buyer)', addr: '0xb9eDEEB25bf7F2db79c03E3175d71E715E5ee78C' },
    { label: 'Wallet 9  (buyer)', addr: '0xE10a5ba5FE03Adb833B8C01fF12CEDC4422f0fdf' },
    { label: 'Wallet 10 (buyer)', addr: '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad' },
    { label: 'Wallet 11 (seller)', addr: '0x9Bb15F98982715E33a2113a35662036528eE0A36' },
];

// All contracts that could possibly hold USDC
const CONTRACTS = [
    { label: 'Vault v2 (active)', addr: VAULT_V2 },
    { label: 'Vault v1 (retired)', addr: VAULT_V1 },
    { label: 'LeadNFT (Base Sepolia)', addr: process.env.LEAD_NFT_CONTRACT_ADDRESS_BASE_SEPOLIA || '0x37414bc0341e0AAb94e51E89047eD73C7086E303' },
    { label: 'RTBEscrow (Base Sepolia)', addr: process.env.ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA || '0xff5d18a9fff7682a5285ccdafd0253e34761DbDB' },
    { label: 'ACE (Base Sepolia)', addr: process.env.ACE_CONTRACT_ADDRESS_BASE_SEPOLIA || '0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6' },
    { label: 'CRE (Base Sepolia)', addr: process.env.CRE_CONTRACT_ADDRESS_BASE_SEPOLIA || '0xe21F29e36c1884D5AbAa259E69c047332EeB4d67' },
    { label: 'Marketplace (Base Sepolia)', addr: process.env.MARKETPLACE_CONTRACT_ADDRESS_BASE_SEPOLIA || '0xfDf961C1E6687593E3aad9C6f585be0e44f96905' },
    { label: 'VerticalNFT (Base Sepolia)', addr: process.env.VERTICAL_NFT_CONTRACT_ADDRESS_BASE_SEPOLIA || '0x60c248c24cC5ba0848b8306424eBaFE1fD07EC5b' },
    { label: 'VerticalAuction', addr: process.env.VERTICAL_AUCTION_CONTRACT_ADDRESS_BASE_SEPOLIA || '0x40504235526e3Bf07684b06Cfc7bafbCfef71003' },
    { label: 'CustomLeadFeed', addr: process.env.CUSTOM_LEAD_FEED_CONTRACT_ADDRESS_BASE_SEPOLIA || '0x195346968854049db1dee868C7b914D4Bb3C6d61' },
    // Sepolia (legacy) contracts
    { label: 'ACE (Sepolia legacy)', addr: process.env.ACE_CONTRACT_ADDRESS || '0x746245858A5A5bCccfd0bdAa228b1489908b9546' },
    { label: 'LeadNFT (Sepolia legacy)', addr: process.env.LEAD_NFT_CONTRACT_ADDRESS || '0xB93A1Ff499BdEaf74710F760Eb2B6bc5b62f8546' },
    { label: 'RTBEscrow (Sepolia legacy)', addr: process.env.ESCROW_CONTRACT_ADDRESS || '0x19B7a082e93B096B0516FA46E67d4168DdCD9004' },
    { label: 'Marketplace (Sepolia legacy)', addr: process.env.MARKETPLACE_CONTRACT_ADDRESS || '0x3b1bBb196e65BE66c2fB18DB70A3513c1dDeB288' },
];

const USDC_ABI = ['function balanceOf(address) view returns (uint256)'];
const VAULT_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function lockedBalances(address) view returns (uint256)',
];

const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, provider);
const vaultV2 = new ethers.Contract(VAULT_V2, VAULT_ABI, provider);
const vaultV1 = new ethers.Contract(VAULT_V1, VAULT_ABI, provider);

function fmt(raw) { return `$${(Number(raw) / 1e6).toFixed(2)}`; }

async function safeBalance(contract, addr) {
    try { return await contract.balanceOf(addr); } catch { return 0n; }
}
async function safeLocked(contract, addr) {
    try { return await contract.lockedBalances(addr); } catch { return 0n; }
}

const W = 44;
const sep = '─'.repeat(90);

console.log('\n' + '═'.repeat(90));
console.log('  🔍  DEEP USDC AUDIT — Base Sepolia');
console.log(`  ${new Date().toISOString()}`);
console.log('═'.repeat(90));
console.log(`\n  USDC contract: ${USDC_ADDR}`);
console.log(`  Vault v2:      ${VAULT_V2}`);
console.log(`  Vault v1:      ${VAULT_V1}\n`);

let grandTotal = 0n;

// ── 1. Deployer ───────────────────────────────────────────────────────────────
const deployerWallet = await safeBalance(usdc, DEPLOYER_ADDR);
grandTotal += deployerWallet;
console.log(sep);
console.log(`  DEPLOYER: ${DEPLOYER_ADDR}`);
console.log(`    Wallet USDC: ${fmt(deployerWallet)}`);
console.log();

// ── 2. Demo wallets — wallet + vault v2 (free + locked) + vault v1 ────────────
console.log(sep);
console.log(`  ${'Wallet'.padEnd(W)} ${'Wallet USDC'.padStart(14)} ${'Vault v2 free'.padStart(14)} ${'Vault v2 locked'.padStart(16)} ${'Vault v1 free'.padStart(14)}`);
console.log('  ' + '─'.repeat(88));

let totalWalletUsdc = 0n;
let totalV2Free = 0n;
let totalV2Locked = 0n;
let totalV1Free = 0n;

for (const w of WALLETS) {
    const walletBal = await safeBalance(usdc, w.addr);
    const v2Free = await safeBalance(vaultV2, w.addr);
    const v2Locked = await safeLocked(vaultV2, w.addr);
    const v1Free = await safeBalance(vaultV1, w.addr);
    totalWalletUsdc += walletBal;
    totalV2Free += v2Free;
    totalV2Locked += v2Locked;
    totalV1Free += v1Free;
    const rowTotal = walletBal + v2Free + v2Locked + v1Free;
    grandTotal += rowTotal;
    const locked = v2Locked > 0n ? ` ⚠️  LOCKED: ${fmt(v2Locked)}` : '';
    console.log(`  ${w.label.padEnd(W)} ${fmt(walletBal).padStart(14)} ${fmt(v2Free).padStart(14)} ${fmt(v2Locked).padStart(16)} ${fmt(v1Free).padStart(14)}${locked}`);
}
console.log('  ' + '─'.repeat(88));
console.log(`  ${'SUBTOTALS'.padEnd(W)} ${fmt(totalWalletUsdc).padStart(14)} ${fmt(totalV2Free).padStart(14)} ${fmt(totalV2Locked).padStart(16)} ${fmt(totalV1Free).padStart(14)}`);
console.log();

// ── 3. Contracts — USDC balance ────────────────────────────────────────────────
console.log(sep);
console.log('  CONTRACT USDC BALANCES');
console.log('  ' + '─'.repeat(70));

let totalContractUsdc = 0n;
for (const c of CONTRACTS) {
    const bal = await safeBalance(usdc, c.addr);
    grandTotal += bal;
    totalContractUsdc += bal;
    const flag = bal > 0n ? ' ◀ FUNDS HERE' : '';
    console.log(`  ${c.label.padEnd(40)} ${c.addr.slice(0, 10)}…  ${fmt(bal).padStart(12)}${flag}`);
}
console.log('  ' + '─'.repeat(70));
console.log(`  ${'TOTAL in contracts'.padEnd(40)}            ${fmt(totalContractUsdc).padStart(12)}`);
console.log();

// ── 4. Grand total ─────────────────────────────────────────────────────────────
const allFree = deployerWallet + totalWalletUsdc + totalV2Free + totalV1Free + totalContractUsdc;
const allLocked = totalV2Locked;

console.log('═'.repeat(90));
console.log(`  GRAND TOTAL USDC FOUND:        ${fmt(grandTotal).padStart(12)}`);
console.log(`    Free (accessible):           ${fmt(allFree).padStart(12)}`);
console.log(`    Locked in Vault v2:          ${fmt(allLocked).padStart(12)}`);
console.log('═'.repeat(90));
console.log();
