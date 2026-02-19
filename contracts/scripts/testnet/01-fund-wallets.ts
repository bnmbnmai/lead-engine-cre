/**
 * 01-fund-wallets.ts — Distribute ETH + USDC to Faucet Wallets
 *
 * === LOW-BALANCE PHASE 1 TEST SUITE (0.158 ETH TOTAL) ===
 *
 * Budget-conscious distribution:
 *   • 0.012 ETH per wallet  (10 wallets = 0.12 ETH, leaves ~0.038 for deployer gas)
 *   • 60 USDC per buyer     (7 buyers = 420 USDC, leaves 630 USDC with deployer)
 *   • Sellers (wallets 1-3) get ETH only — they don't need USDC
 *
 * Safety:
 *   - Hard pre-flight check aborts if deployer has < required ETH or USDC
 *   - DRY_RUN=true shows plan without sending
 *   - Skip wallets that already have sufficient funds
 *
 * Usage:
 *   npx hardhat run scripts/testnet/01-fund-wallets.ts --network baseSepolia
 *   DRY_RUN=true npx hardhat run scripts/testnet/01-fund-wallets.ts --network baseSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Budget Configuration ───────────────────────
const ETH_PER_WALLET = "0.012";    // ETH for gas
const USDC_PER_BUYER = "60";       // USDC for vault deposits + bids
const SELLER_COUNT = 3;          // Wallets 1-3 = sellers (ETH only)
const BUYER_COUNT = 7;          // Wallets 4-10 = buyers (ETH + USDC)
const MIN_DEPLOYER_GAS_ETH = "0.02";    // Reserve for deployer's own gas costs

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DRY_RUN = process.env.DRY_RUN === "true";

const USDC_ABI = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)",
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
                console.log(`  ✅ ${label} — tx: ${receipt.hash} (gas: ${receipt.gasUsed})`);
                return receipt;
            }
            return tx;
        } catch (err: any) {
            const msg = err?.shortMessage || err?.message || String(err);
            console.warn(`  ⚠️  ${label} attempt ${attempt}/${retries}: ${msg.slice(0, 140)}`);
            if (attempt === retries) throw err;
            await new Promise(r => setTimeout(r, 2000 * attempt));
        }
    }
}

// ── Main ───────────────────────────────────────
async function main() {
    const [deployer] = await ethers.getSigners();
    const chainId = Number((await ethers.provider.getNetwork()).chainId);

    console.log("=== LOW-BALANCE PHASE 1 TEST SUITE (0.158 ETH TOTAL) ===\n");
    console.log("═".repeat(60));
    console.log("💰 01-FUND-WALLETS — Conservative Base Sepolia Distribution");
    console.log("═".repeat(60));
    console.log(`Deployer:     ${deployer.address}`);
    console.log(`Chain ID:     ${chainId}`);
    console.log(`Dry Run:      ${DRY_RUN}`);
    console.log(`ETH/wallet:   ${ETH_PER_WALLET} (×10 = ${parseFloat(ETH_PER_WALLET) * 10} ETH)`);
    console.log(`USDC/buyer:   ${USDC_PER_BUYER} (×${BUYER_COUNT} = ${parseFloat(USDC_PER_BUYER) * BUYER_COUNT} USDC)`);
    console.log(`Sellers:      ${SELLER_COUNT} (ETH only, no USDC)`);
    console.log(`Buyers:       ${BUYER_COUNT} (ETH + USDC)`);

    // ── Load wallets ──
    const wallets = parseWalletFile();
    console.log(`\nWallets loaded: ${wallets.length}`);
    if (wallets.length < SELLER_COUNT + BUYER_COUNT) {
        throw new Error(`Need ${SELLER_COUNT + BUYER_COUNT} wallets, found ${wallets.length}`);
    }

    // ── Pre-flight balance check ──────────────────────────────────
    const deployerETH = await ethers.provider.getBalance(deployer.address);
    const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, deployer);
    const deployerUSDC = await usdc.balanceOf(deployer.address);

    const totalETHNeeded = ethers.parseEther(ETH_PER_WALLET) * BigInt(wallets.length)
        + ethers.parseEther(MIN_DEPLOYER_GAS_ETH);
    const totalUSDCNeeded = ethers.parseUnits(USDC_PER_BUYER, 6) * BigInt(BUYER_COUNT);

    console.log(`\n╔══════════════ PRE-FLIGHT CHECK ══════════════╗`);
    console.log(`║ Deployer ETH:    ${ethers.formatEther(deployerETH).padEnd(24)} ║`);
    console.log(`║ Deployer USDC:   ${ethers.formatUnits(deployerUSDC, 6).padEnd(24)} ║`);
    console.log(`║ Total ETH need:  ${ethers.formatEther(totalETHNeeded).padEnd(24)} ║`);
    console.log(`║ Total USDC need: ${ethers.formatUnits(totalUSDCNeeded, 6).padEnd(24)} ║`);

    if (deployerETH < totalETHNeeded) {
        console.log(`║                                              ║`);
        console.log(`║ ❌ ABORT: INSUFFICIENT ETH                   ║`);
        console.log(`║ Have: ${ethers.formatEther(deployerETH).padEnd(14)} Need: ${ethers.formatEther(totalETHNeeded).padEnd(14)}  ║`);
        console.log(`║ Shortfall: ${ethers.formatEther(totalETHNeeded - deployerETH).padEnd(30)} ║`);
        console.log(`╚══════════════════════════════════════════════╝`);
        throw new Error(
            `INSUFFICIENT ETH.\n` +
            `  Have:      ${ethers.formatEther(deployerETH)} ETH\n` +
            `  Need:      ${ethers.formatEther(totalETHNeeded)} ETH\n` +
            `  Shortfall: ${ethers.formatEther(totalETHNeeded - deployerETH)} ETH\n` +
            `  Action:    Get testnet ETH from https://www.alchemy.com/faucets/base-sepolia`
        );
    }

    if (deployerUSDC < totalUSDCNeeded) {
        console.log(`║                                              ║`);
        console.log(`║ ❌ ABORT: INSUFFICIENT USDC                  ║`);
        console.log(`╚══════════════════════════════════════════════╝`);
        throw new Error(
            `INSUFFICIENT USDC.\n` +
            `  Have:      ${ethers.formatUnits(deployerUSDC, 6)} USDC\n` +
            `  Need:      ${ethers.formatUnits(totalUSDCNeeded, 6)} USDC\n` +
            `  Shortfall: ${ethers.formatUnits(totalUSDCNeeded - deployerUSDC, 6)} USDC`
        );
    }

    console.log(`║ ✅ Sufficient funds — proceed                 ║`);
    console.log(`╚══════════════════════════════════════════════╝`);

    if (DRY_RUN) {
        console.log("\n🏜️  DRY RUN — no transactions will be sent\n");
        for (let i = 0; i < wallets.length; i++) {
            const isBuyer = i >= SELLER_COUNT;
            const bal = await ethers.provider.getBalance(wallets[i].address);
            const uBal = await usdc.balanceOf(wallets[i].address);
            console.log(`  [${i + 1}] ${wallets[i].address} (${isBuyer ? "BUYER" : "SELLER"})`);
            console.log(`      Current: ${ethers.formatEther(bal)} ETH | ${ethers.formatUnits(uBal, 6)} USDC`);
            console.log(`      Will get: ${ETH_PER_WALLET} ETH${isBuyer ? ` + ${USDC_PER_BUYER} USDC` : ""}`);
        }
        return;
    }

    // ── Send funds ──
    interface FundResult {
        idx: number;
        wallet: string;
        role: string;
        ethTx: string;
        usdcTx: string;
        ethBal: string;
        usdcBal: string;
    }
    const results: FundResult[] = [];

    for (let i = 0; i < wallets.length; i++) {
        const addr = wallets[i].address;
        const isBuyer = i >= SELLER_COUNT;
        const role = isBuyer ? "BUYER" : "SELLER";

        console.log(`\n📤 [${i + 1}/${wallets.length}] ${addr} (${role})`);

        // ── Check if wallet already has enough ──
        const currentETH = await ethers.provider.getBalance(addr);
        const currentUSDC = await usdc.balanceOf(addr);
        const ethNeeded = ethers.parseEther(ETH_PER_WALLET);
        const usdcNeeded = isBuyer ? ethers.parseUnits(USDC_PER_BUYER, 6) : 0n;

        if (currentETH >= ethNeeded && currentUSDC >= usdcNeeded) {
            console.log(`  ⏭️  Already funded: ${ethers.formatEther(currentETH)} ETH | ${ethers.formatUnits(currentUSDC, 6)} USDC`);
            results.push({
                idx: i + 1, wallet: addr, role, ethTx: "skip", usdcTx: "skip",
                ethBal: ethers.formatEther(currentETH), usdcBal: ethers.formatUnits(currentUSDC, 6)
            });
            continue;
        }

        // Send ETH
        let ethTx = "skip";
        if (currentETH < ethNeeded) {
            const ethReceipt = await sendTx(
                `${ETH_PER_WALLET} ETH → ${addr.slice(0, 10)}…`,
                () => deployer.sendTransaction({ to: addr, value: ethNeeded })
            );
            ethTx = ethReceipt.hash;
        }

        // Send USDC (buyers only)
        let usdcTx = "skip";
        if (isBuyer && currentUSDC < usdcNeeded) {
            const usdcReceipt = await sendTx(
                `${USDC_PER_BUYER} USDC → ${addr.slice(0, 10)}…`,
                () => usdc.transfer(addr, usdcNeeded)
            );
            usdcTx = usdcReceipt.hash;
        }

        // Confirm final balances
        const finalETH = await ethers.provider.getBalance(addr);
        const finalUSDC = await usdc.balanceOf(addr);
        results.push({
            idx: i + 1, wallet: addr, role, ethTx, usdcTx,
            ethBal: ethers.formatEther(finalETH),
            usdcBal: ethers.formatUnits(finalUSDC, 6),
        });
        console.log(`  📊 Final: ${ethers.formatEther(finalETH)} ETH | ${ethers.formatUnits(finalUSDC, 6)} USDC`);

        // Brief pause to avoid nonce issues
        if (i < wallets.length - 1) await new Promise(r => setTimeout(r, 1000));
    }

    // ── Summary ──
    console.log("\n" + "═".repeat(60));
    console.log("📋 FUNDING SUMMARY");
    console.log("═".repeat(60));
    console.log(`\n| # | Wallet | Role | ETH | USDC | ETH Tx | USDC Tx |`);
    console.log(`|---|--------|------|-----|------|--------|---------|`);
    for (const r of results) {
        const ethLink = r.ethTx === "skip" ? "skip" : `[tx](https://sepolia.basescan.org/tx/${r.ethTx})`;
        const usdcLink = r.usdcTx === "skip" ? "—" : `[tx](https://sepolia.basescan.org/tx/${r.usdcTx})`;
        console.log(`| ${r.idx} | ${r.wallet.slice(0, 10)}… | ${r.role} | ${r.ethBal} | ${r.usdcBal} | ${ethLink} | ${usdcLink} |`);
    }

    const deployerFinalETH = await ethers.provider.getBalance(deployer.address);
    const deployerFinalUSDC = await usdc.balanceOf(deployer.address);
    const ethSent = results.filter(r => r.ethTx !== "skip").length;
    const usdcSent = results.filter(r => r.usdcTx !== "skip").length;

    console.log(`\nDeployer remaining: ${ethers.formatEther(deployerFinalETH)} ETH | ${ethers.formatUnits(deployerFinalUSDC, 6)} USDC`);
    console.log(`ETH transfers:  ${ethSent}/${wallets.length}`);
    console.log(`USDC transfers: ${usdcSent}/${BUYER_COUNT}`);
    console.log("\n✅ 01-fund-wallets complete");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Funding failed:", error.message || error);
        process.exit(1);
    });
