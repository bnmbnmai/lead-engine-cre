/**
 * 05-verify-por-fix.ts — Verify PoR remains SOLVENT after auctions
 *
 * Quick 3-cycle test focusing on PoR accounting:
 *   Cycle: deposit → lockForBid × 3 → settleBid (winner) → refundBid × 2 → verifyReserves
 *
 * Budget: ~30 USDC (one buyer), minimal ETH gas
 *
 * Usage:
 *   npx hardhat run scripts/testnet/05-verify-por-fix.ts --network baseSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Configuration ──────────────────────────────
const VAULT_ADDRESS = "0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEPOSIT_AMOUNT = "30"; // 30 USDC
const BID_AMOUNT = 5;        // $5 per bid
const CYCLES = 3;

const VAULT_ABI = [
    "function deposit(uint256 amount) external",
    "function balanceOf(address user) view returns (uint256)",
    "function lockedBalances(address user) view returns (uint256)",
    "function totalObligations() view returns (uint256)",
    "function totalDeposited() view returns (uint256)",
    "function totalWithdrawn() view returns (uint256)",
    "function lockForBid(address user, uint256 bidAmount) external returns (uint256)",
    "function settleBid(uint256 lockId, address seller) external",
    "function refundBid(uint256 lockId) external",
    "function verifyReserves() external returns (bool)",
    "function lastPorSolvent() view returns (bool)",
    "event BidLocked(uint256 indexed lockId, address indexed user, uint256 amount, uint256 fee)",
    "event ReservesVerified(uint256 contractBalance, uint256 claimedTotal, bool solvent, uint256 timestamp)",
];

const USDC_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
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
    const provider = ethers.provider;
    const [deployer] = await ethers.getSigners();
    const allWallets = parseWalletFile();

    // Use deployer as both bidder and authorized caller
    // (buyer wallets have USDC stuck in old vault — deployer has ~630 USDC)
    const sellerAddr = allWallets[0].address;

    console.log("═".repeat(60));
    console.log("🔍 05-VERIFY-POR-FIX — PoR Accounting Validation");
    console.log("═".repeat(60));
    console.log(`Vault:      ${VAULT_ADDRESS}`);
    console.log(`Bidder:     ${deployer.address} (deployer)`);
    console.log(`Seller:     ${sellerAddr}`);
    console.log(`Deployer:   ${deployer.address}`);
    console.log(`Deposit:    ${DEPOSIT_AMOUNT} USDC`);
    console.log(`Bid:        $${BID_AMOUNT}/bid × 3 locks × ${CYCLES} cycles`);
    console.log();

    const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, deployer);
    const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, deployer);

    // ── Step 1: Deposit USDC into vault ──
    const currentVaultBal = await vault.balanceOf(deployer.address);
    const depositAmount = ethers.parseUnits(DEPOSIT_AMOUNT, 6);

    if (currentVaultBal < depositAmount) {
        console.log(`\n📥 Depositing ${DEPOSIT_AMOUNT} USDC into vault...`);
        await sendTx("Approve USDC", () => usdc.approve(VAULT_ADDRESS, depositAmount));
        await sendTx("Deposit USDC", () => vault.deposit(depositAmount));
    } else {
        console.log(`\n⏭️  Deployer already has ${ethers.formatUnits(currentVaultBal, 6)} USDC in vault`);
    }

    // ── Step 2: Pre-cycle PoR check ──
    console.log("\n📊 Pre-Cycle State:");
    const preObl = await vault.totalObligations();
    const preBal = await usdc.balanceOf(VAULT_ADDRESS);
    console.log(`  Contract USDC:    ${ethers.formatUnits(preBal, 6)}`);
    console.log(`  totalObligations: ${ethers.formatUnits(preObl, 6)}`);
    console.log(`  totalDeposited:   ${ethers.formatUnits(await vault.totalDeposited(), 6)}`);
    console.log(`  PoR margin:       ${ethers.formatUnits(preBal - preObl, 6)} USDC`);

    // ── Step 3: Run auction cycles ──
    const bidAmountUsdc = ethers.parseUnits(String(BID_AMOUNT), 6);
    let totalGas = 0n;
    let lockIdCounter = 0;

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
        console.log(`\n${"─".repeat(50)}`);
        console.log(`🔄 Cycle ${cycle}/${CYCLES}`);
        console.log(`${"─".repeat(50)}`);

        // Lock 3 bids (simulating 3 bidders, all from same buyer for simplicity)
        const lockIds: number[] = [];
        for (let b = 0; b < 3; b++) {
            const receipt = await sendTx(
                `Lock bid #${b + 1} ($${BID_AMOUNT})`,
                () => vault.lockForBid(deployer.address, bidAmountUsdc)
            );
            totalGas += receipt.gasUsed;

            // Extract lockId from BidLocked event
            const iface = new ethers.Interface(VAULT_ABI);
            for (const log of receipt.logs) {
                try {
                    const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
                    if (parsed?.name === "BidLocked") {
                        lockIds.push(Number(parsed.args[0]));
                    }
                } catch { /* skip other events */ }
            }
        }

        console.log(`  Lock IDs: [${lockIds.join(", ")}]`);

        // Settle winner (first lock)
        const winnerLockId = lockIds[0];
        const settleReceipt = await sendTx(
            `Settle winner (lock #${winnerLockId} → seller)`,
            () => vault.settleBid(winnerLockId, sellerAddr)
        );
        totalGas += settleReceipt.gasUsed;

        // Refund losers
        for (let r = 1; r < lockIds.length; r++) {
            const refundReceipt = await sendTx(
                `Refund loser (lock #${lockIds[r]})`,
                () => vault.refundBid(lockIds[r])
            );
            totalGas += refundReceipt.gasUsed;
        }

        // PoR check
        const porReceipt = await sendTx("verifyReserves()", () => vault.verifyReserves());
        totalGas += porReceipt.gasUsed;

        const solvent = await vault.lastPorSolvent();
        const actual = await usdc.balanceOf(VAULT_ADDRESS);
        const obligations = await vault.totalObligations();

        const status = solvent ? "✅ SOLVENT" : "❌ INSOLVENT";
        console.log(`\n  🏦 PoR Result: ${status}`);
        console.log(`     Contract USDC:    ${ethers.formatUnits(actual, 6)}`);
        console.log(`     totalObligations: ${ethers.formatUnits(obligations, 6)}`);
        console.log(`     Margin:           ${ethers.formatUnits(actual - obligations, 6)} USDC`);
        console.log(`     Bidder balance:   ${ethers.formatUnits(await vault.balanceOf(deployer.address), 6)} USDC`);
        console.log(`     Bidder locked:    ${ethers.formatUnits(await vault.lockedBalances(deployer.address), 6)} USDC`);

        if (!solvent) {
            console.error(`\n❌ CYCLE ${cycle}: PoR FAILED — contract is INSOLVENT!`);
            process.exit(1);
        }
    }

    // ── Final Summary ──
    console.log("\n" + "═".repeat(60));
    console.log("📋 VERIFICATION SUMMARY");
    console.log("═".repeat(60));

    const finalActual = await usdc.balanceOf(VAULT_ADDRESS);
    const finalObl = await vault.totalObligations();
    const finalSolvent = await vault.lastPorSolvent();
    const finalDeposited = await vault.totalDeposited();

    console.log(`\nCycles completed:    ${CYCLES}/${CYCLES}`);
    console.log(`Settlements:         ${CYCLES}`);
    console.log(`Refunds:             ${CYCLES * 2}`);
    console.log(`Total gas:           ${totalGas}`);
    console.log(`\nContract USDC:       ${ethers.formatUnits(finalActual, 6)}`);
    console.log(`totalObligations:    ${ethers.formatUnits(finalObl, 6)}`);
    console.log(`totalDeposited:      ${ethers.formatUnits(finalDeposited, 6)} (info-only)`);
    console.log(`PoR status:          ${finalSolvent ? "✅ SOLVENT" : "❌ INSOLVENT"}`);
    console.log(`\nBidder vault balance: ${ethers.formatUnits(await vault.balanceOf(deployer.address), 6)} USDC`);
    console.log(`Deployer ETH:         ${ethers.formatEther(await provider.getBalance(deployer.address))} ETH`);

    console.log("\n✅ 05-verify-por-fix COMPLETE — all cycles SOLVENT");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Verification failed:", error.message || error);
        process.exit(1);
    });
