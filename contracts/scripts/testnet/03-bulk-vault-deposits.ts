/**
 * 03-bulk-vault-deposits.ts — Deposit USDC into PersonalEscrowVault
 *
 * === LOW-BALANCE PHASE 1 TEST SUITE (0.158 ETH TOTAL) ===
 *
 * Uses 7 faucet wallets (wallets 4–10) as buyers.
 * Each buyer: approve(vault, 55 USDC) → vault.deposit(55 USDC)
 * Keeps 5 USDC per buyer as wallet reserve (not in vault).
 *
 * Budget: 7 × 55 = 385 USDC total deposited into vaults.
 * Each buyer can afford ~3 winning bids at ~$15 each + $1 fee.
 *
 * Requires:
 *   - Wallets funded by 01-fund-wallets.ts
 *   - PersonalEscrowVault deployed at 0x11bb8AFe21…
 *
 * Usage:
 *   npx hardhat run scripts/testnet/03-bulk-vault-deposits.ts --network baseSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Configuration ──────────────────────────────
const USDC_PER_DEPOSIT = "55";        // USDC to deposit (keep 5 as wallet reserve)
const BUYER_WALLET_START = 3;           // Index 3 = wallet 4
const BUYER_WALLET_COUNT = 7;

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const VAULT_ADDRESS = "0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4";
const DRY_RUN = process.env.DRY_RUN === "true";

const USDC_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
];

const VAULT_ABI = [
    "function deposit(uint256 amount) external",
    "function balanceOf(address user) view returns (uint256)",
    "function totalBalanceOf(address user) view returns (uint256)",
    "function totalDeposited() view returns (uint256)",
];

// ── Helpers ────────────────────────────────────
function parseWalletFile(): { address: string; pk: string }[] {
    const filePath = path.join(__dirname, "..", "..", "..", "faucet-wallets.txt");
    const raw = fs.readFileSync(filePath, "utf-8");
    const wallets: { address: string; pk: string }[] = [];
    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const addrMatch = trimmed.match(/:\s*(0x[a-fA-F0-9]{40})/);
        const pkMatch = trimmed.match(/PK:\s*(0x[a-fA-F0-9]{64})/);
        if (addrMatch && pkMatch) wallets.push({ address: addrMatch[1], pk: pkMatch[1] });
    }
    return wallets;
}

async function sendTx(label: string, txFn: () => Promise<any>, retries = 3): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const tx = await txFn();
            if (tx?.wait) {
                const receipt = await tx.wait();
                console.log(`  ✅ ${label} — tx: ${receipt.hash.slice(0, 20)}… (gas: ${receipt.gasUsed})`);
                return receipt;
            }
            return tx;
        } catch (err: any) {
            const msg = err?.shortMessage || err?.message || String(err);
            console.warn(`  ⚠️  ${label} attempt ${attempt}/${retries}: ${msg.slice(0, 120)}`);
            if (attempt === retries) throw err;
            await new Promise(r => setTimeout(r, 2000 * attempt));
        }
    }
}

// ── Main ───────────────────────────────────────
async function main() {
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const provider = ethers.provider;

    console.log("=== LOW-BALANCE PHASE 1 TEST SUITE (0.158 ETH TOTAL) ===\n");
    console.log("═".repeat(60));
    console.log("🏦 03-BULK-VAULT-DEPOSITS — Fund 7 Buyer Vaults");
    console.log("═".repeat(60));
    console.log(`Chain:         ${chainId}`);
    console.log(`Vault:         ${VAULT_ADDRESS}`);
    console.log(`Deposit/buyer: ${USDC_PER_DEPOSIT} USDC`);
    console.log(`Dry Run:       ${DRY_RUN}`);

    // Verify vault contract
    const vaultCode = await provider.getCode(VAULT_ADDRESS);
    if (vaultCode === "0x") throw new Error(`No contract at vault ${VAULT_ADDRESS}`);

    const allWallets = parseWalletFile();
    const buyerWallets = allWallets.slice(BUYER_WALLET_START, BUYER_WALLET_START + BUYER_WALLET_COUNT);
    console.log(`\nBuyers: ${buyerWallets.length} (wallets ${BUYER_WALLET_START + 1}–${BUYER_WALLET_START + BUYER_WALLET_COUNT})`);

    const depositAmount = ethers.parseUnits(USDC_PER_DEPOSIT, 6);

    // ── Pre-deposit balances ──
    console.log("\n📊 Pre-Deposit State:");
    console.log("─".repeat(60));
    console.log(`| # | Wallet       | ETH       | USDC    | Vault   |`);
    console.log(`|---|--------------|-----------|---------|---------|`);

    for (let i = 0; i < buyerWallets.length; i++) {
        const addr = buyerWallets[i].address;
        const signer = new ethers.Wallet(buyerWallets[i].pk, provider);
        const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
        const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);

        const ethBal = ethers.formatEther(await provider.getBalance(addr)).slice(0, 9);
        const usdcBal = ethers.formatUnits(await usdc.balanceOf(addr), 6);
        const vBal = ethers.formatUnits(await vault.balanceOf(addr), 6);
        console.log(`| ${i + 1} | ${addr.slice(0, 12)}… | ${ethBal} | ${usdcBal.padStart(7)} | ${vBal.padStart(7)} |`);
    }

    if (DRY_RUN) {
        console.log("\n🏜️  DRY RUN — no transactions sent");
        return;
    }

    // ── Execute deposits ──
    interface DepResult { wallet: string; approveTx: string; depositTx: string; before: string; after: string }
    const results: DepResult[] = [];
    let totalGas = 0n;

    for (let i = 0; i < buyerWallets.length; i++) {
        const { address: addr, pk } = buyerWallets[i];
        const signer = new ethers.Wallet(pk, provider);
        const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
        const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);

        console.log(`\n🏦 Buyer ${i + 1}/${buyerWallets.length}: ${addr}`);

        // Check USDC balance
        const usdcBal = await usdc.balanceOf(addr);
        if (usdcBal < depositAmount) {
            console.log(`  ⚠️  Insufficient USDC: ${ethers.formatUnits(usdcBal, 6)} < ${USDC_PER_DEPOSIT}`);
            continue;
        }

        // Check if already deposited
        const vaultBefore = await vault.balanceOf(addr);
        if (vaultBefore >= depositAmount) {
            console.log(`  ⏭️  Already has ${ethers.formatUnits(vaultBefore, 6)} in vault, skipping`);
            results.push({
                wallet: addr, approveTx: "skip", depositTx: "skip",
                before: ethers.formatUnits(vaultBefore, 6), after: ethers.formatUnits(vaultBefore, 6)
            });
            continue;
        }

        // Approve
        const aReceipt = await sendTx(
            `Approve ${USDC_PER_DEPOSIT} USDC`,
            () => usdc.approve(VAULT_ADDRESS, depositAmount)
        );

        // Deposit
        const dReceipt = await sendTx(
            `Deposit ${USDC_PER_DEPOSIT} USDC`,
            () => vault.deposit(depositAmount)
        );

        const vaultAfter = await vault.balanceOf(addr);
        totalGas += (aReceipt?.gasUsed || 0n) + (dReceipt?.gasUsed || 0n);

        results.push({
            wallet: addr,
            approveTx: aReceipt?.hash || "—",
            depositTx: dReceipt?.hash || "—",
            before: ethers.formatUnits(vaultBefore, 6),
            after: ethers.formatUnits(vaultAfter, 6),
        });
        console.log(`  📊 Vault: ${ethers.formatUnits(vaultBefore, 6)} → ${ethers.formatUnits(vaultAfter, 6)} USDC`);

        if (i < buyerWallets.length - 1) await new Promise(r => setTimeout(r, 1500));
    }

    // Summary
    console.log("\n" + "═".repeat(60));
    console.log("📋 VAULT DEPOSIT SUMMARY");
    console.log("═".repeat(60));
    console.log(`\n| # | Wallet       | Before | After  | Deposit Tx |`);
    console.log(`|---|--------------|--------|--------|------------|`);
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const link = r.depositTx === "skip" ? "skip" : `[tx](https://sepolia.basescan.org/tx/${r.depositTx})`;
        console.log(`| ${i + 1} | ${r.wallet.slice(0, 12)}… | ${r.before.padStart(6)} | ${r.after.padStart(6)} | ${link} |`);
    }

    const totalDeposited = await (new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider)).totalDeposited();
    console.log(`\nTotal vault deposits (all time): ${ethers.formatUnits(totalDeposited, 6)} USDC`);
    console.log(`Gas used: ${totalGas}`);
    console.log("\n✅ 03-bulk-vault-deposits complete");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Vault deposits failed:", error.message || error);
        process.exit(1);
    });
