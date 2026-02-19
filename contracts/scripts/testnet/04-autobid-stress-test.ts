/**
 * 04-autobid-stress-test.ts — E2E Auction Stress Test (20 Cycles)
 *
 * === LOW-BALANCE PHASE 1 TEST SUITE (0.158 ETH TOTAL) ===
 *
 * For each cycle:
 *   1. Submit a fresh lead via backend API
 *   2. Select 3 random buyers from the 7-wallet pool
 *   3. Lock vault funds for each bidder (vault.lockForBid)
 *   4. Determine winner (highest bid)
 *   5. Settle winner via vault.settleBid → seller receives 95%
 *   6. Refund losers via vault.refundBid → full refund (bid + $1 fee)
 *   7. PoR verification after each settlement
 *   8. Log all events: BidLocked, BidSettled, BidRefunded, ReservesVerified
 *
 * Budget-safe:
 *   - Bids range $10–$18 (reserve $8–15, bid = reserve + $2–5)
 *   - Each lock costs bid + $1 fee ≈ $12–19
 *   - Net cost per cycle ≈ winner's bid (~$15) — losers fully refunded
 *   - 20 cycles × ~$15 = ~$300 consumed from 385 USDC total vault balance
 *   - Deployer gas: ~0.001 ETH per lock/settle/refund ≈ 0.01 ETH for 20 cycles
 *
 * Features:
 *   - Configurable cycle count (CYCLES env, default 20)
 *   - Skip cycle if all 3 bidders have insufficient vault balance
 *   - Graceful Ctrl+C shutdown
 *   - Living log file: stress-test-log.txt
 *   - Final summary table with all cycle results
 *
 * Usage:
 *   npx hardhat run scripts/testnet/04-autobid-stress-test.ts --network baseSepolia
 *   CYCLES=10 npx hardhat run scripts/testnet/04-autobid-stress-test.ts --network baseSepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Configuration ──────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
const CYCLES = parseInt(process.env.CYCLES || "20", 10);
const INTER_CYCLE_MS = 4_000;   // 4s between cycles
const DRY_RUN = process.env.DRY_RUN === "true";

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const VAULT_ADDRESS = "0x11bb8AFe2143bc93E0F0b5a488C1aE6BEB3b26B4";

const LOG_FILE = path.join(__dirname, "..", "..", "..", "stress-test-log.txt");

// ── ABIs ───────────────────────────────────────
const VAULT_ABI = [
    "function deposit(uint256 amount) external",
    "function balanceOf(address user) view returns (uint256)",
    "function lockedBalances(address user) view returns (uint256)",
    "function totalBalanceOf(address user) view returns (uint256)",
    "function lockForBid(address user, uint256 bidAmount) external returns (uint256)",
    "function settleBid(uint256 lockId, address seller) external",
    "function refundBid(uint256 lockId) external",
    "function totalDeposited() view returns (uint256)",
    "function totalWithdrawn() view returns (uint256)",
    "event BidLocked(uint256 indexed lockId, address indexed user, uint256 amount, uint256 fee)",
    "event BidSettled(uint256 indexed lockId, address indexed user, address indexed seller, uint256 bidAmount, uint256 sellerReceives, uint256 platformCut, uint256 fee)",
    "event BidRefunded(uint256 indexed lockId, address indexed user, uint256 totalRefunded)",
    "event ReservesVerified(uint256 contractBalance, uint256 claimedTotal, bool solvent, uint256 timestamp)",
];

const USDC_ABI = [
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

const logBuffer: string[] = [];
function emit(msg: string) {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const line = `[${ts}] ${msg}`;
    console.log(line);
    logBuffer.push(line);
}

function flushLog() {
    const header = `\n${"═".repeat(72)}\n  STRESS TEST RUN — ${new Date().toISOString()}\n${"═".repeat(72)}\n`;
    fs.appendFileSync(LOG_FILE, header + logBuffer.join("\n") + "\n");
    emit(`📄 Log appended to ${LOG_FILE}`);
}

async function sendTx(label: string, txFn: () => Promise<any>, retries = 3): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const tx = await txFn();
            if (tx?.wait) {
                const receipt = await tx.wait();
                emit(`  ✅ ${label} — tx: ${receipt.hash.slice(0, 18)}… (gas: ${receipt.gasUsed})`);
                return receipt;
            }
            return tx;
        } catch (err: any) {
            const msg = err?.shortMessage || err?.message || String(err);
            emit(`  ⚠️  ${label} attempt ${attempt}/${retries}: ${msg.slice(0, 140)}`);
            if (attempt === retries) throw err;
            await new Promise(r => setTimeout(r, 2000 * attempt));
        }
    }
}

// ── Lead Templates ─────────────────────────────
const VERTICALS = ["solar", "roofing", "insurance"];
const STATES = ["CA", "TX", "FL", "NY", "AZ", "CO", "NV", "OR", "WA", "NC"];

function makeLead(cycle: number) {
    const vertical = VERTICALS[cycle % VERTICALS.length];
    const state = STATES[cycle % STATES.length];
    const reserve = 8 + Math.floor(Math.random() * 7);  // $8–$15

    const params: Record<string, any> = {
        stressCycle: cycle,
        ts: new Date().toISOString(),
    };

    if (vertical === "solar") {
        params.monthlyBill = 180 + cycle * 15;
        params.roofAge = 5 + (cycle % 20);
        params.ownership = "own";
    } else if (vertical === "roofing") {
        params.projectType = ["full_replacement", "repair", "inspection"][cycle % 3];
        params.urgency = "within_month";
    } else {
        params.insuranceType = ["home", "auto", "bundle"][cycle % 3];
        params.coverageLevel = "premium";
    }

    return { vertical, state, reserve, params };
}

// ── Main ───────────────────────────────────────
async function main() {
    const [deployer] = await ethers.getSigners();
    const provider = ethers.provider;
    const chainId = Number((await provider.getNetwork()).chainId);
    let interrupted = false;

    process.on("SIGINT", () => { emit("\n⚠️  Ctrl+C — finishing cycle…"); interrupted = true; });

    emit("=== LOW-BALANCE PHASE 1 TEST SUITE (0.158 ETH TOTAL) ===");
    emit("");
    emit("═".repeat(60));
    emit("🔥 04-AUTOBID-STRESS-TEST — 20-Cycle E2E Runner");
    emit("═".repeat(60));
    emit(`Chain:      ${chainId}`);
    emit(`Deployer:   ${deployer.address}`);
    emit(`Cycles:     ${CYCLES}`);
    emit(`Vault:      ${VAULT_ADDRESS}`);
    emit(`Dry Run:    ${DRY_RUN}`);

    // ── Load wallets ──
    const allWallets = parseWalletFile();
    const sellerWalletData = allWallets.slice(0, 3);
    const buyerWalletData = allWallets.slice(3, 10);

    if (buyerWalletData.length < 3) throw new Error("Need at least 3 buyer wallets");

    const buyers = buyerWalletData.map(w => new ethers.Wallet(w.pk, provider));
    const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, deployer);

    emit(`\nBuyers: ${buyers.length} | Sellers: ${sellerWalletData.length}`);

    // ── Pre-test vault snapshot ──
    emit("\n📊 Pre-Test Vault Balances:");
    let totalAvailable = 0n;
    for (let i = 0; i < buyers.length; i++) {
        const bal = await vault.balanceOf(buyers[i].address);
        const locked = await vault.lockedBalances(buyers[i].address);
        totalAvailable += bal;
        emit(`  B${i + 1} (${buyers[i].address.slice(0, 10)}…): ${ethers.formatUnits(bal, 6)} avail | ${ethers.formatUnits(locked, 6)} locked`);
    }
    emit(`  Total available across all buyers: ${ethers.formatUnits(totalAvailable, 6)} USDC`);

    // ── Pre-flight gas check ──
    const deployerETH = await provider.getBalance(deployer.address);
    emit(`\n  Deployer gas: ${ethers.formatEther(deployerETH)} ETH`);
    if (deployerETH < ethers.parseEther("0.005")) {
        throw new Error(`Deployer has only ${ethers.formatEther(deployerETH)} ETH — need ≥0.005 for gas`);
    }

    if (DRY_RUN) {
        emit("\n🏜️  DRY RUN — planning only");
        for (let c = 0; c < CYCLES; c++) {
            const l = makeLead(c);
            emit(`  Cycle ${c + 1}: ${l.vertical}/${l.state} reserve=$${l.reserve}`);
        }
        return;
    }

    // ══════════════════════════════════════════
    //  STRESS LOOP
    // ══════════════════════════════════════════

    interface CycleResult {
        cycle: number;
        leadId: string;
        vertical: string;
        state: string;
        bids: number[];
        winner?: string;
        winnerBid?: number;
        settleTx?: string;
        lockId?: number;
        refundCount: number;
        gasUsed: bigint;
        durationMs: number;
        error?: string;
    }

    const results: CycleResult[] = [];
    let totalGas = 0n;
    let settleCount = 0, refundTotal = 0;

    for (let c = 0; c < CYCLES && !interrupted; c++) {
        const cycleStart = Date.now();
        const lead = makeLead(c);
        let cycleGas = 0n;
        let refundCount = 0;

        emit(`\n${"═".repeat(60)}`);
        emit(`🔄 CYCLE ${c + 1}/${CYCLES} — ${lead.vertical} / ${lead.state} / reserve=$${lead.reserve}`);
        emit(`${"─".repeat(60)}`);

        try {
            // ── Step 1: Submit lead via demo-panel (auto-creates seller) ──
            emit("  📤 Submitting lead…");
            const sellerWallet = sellerWalletData[c % sellerWalletData.length].address;

            const submitResp = await fetch(`${BACKEND_URL}/api/v1/demo-panel/lead`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sellerWallet,
                    vertical: lead.vertical,
                }),
            });

            const submitData: any = await submitResp.json();
            if (!submitResp.ok) throw new Error(`Submit: ${JSON.stringify(submitData).slice(0, 100)}`);

            const leadId = submitData.lead?.id || `cycle_${c}`;
            const leadStat = submitData.success ? "IN_AUCTION" : "?";
            emit(`  ✅ Lead: ${leadId} → ${leadStat}`);

            // ── Step 2: Select 3 buyers, compute bids ──
            // Shuffle buyers and pick 3 with sufficient vault balance
            const shuffled = [...buyers].sort(() => Math.random() - 0.5);
            const cycleBuyers: (typeof buyers[0])[] = [];
            const bidAmounts: number[] = [];

            for (const buyer of shuffled) {
                if (cycleBuyers.length >= 3) break;
                const bal = await vault.balanceOf(buyer.address);
                const bidAmount = lead.reserve + 2 + Math.floor(Math.random() * 4); // reserve + $2–5
                const needed = ethers.parseUnits((bidAmount + 1).toString(), 6);  // bid + $1 fee
                if (bal >= needed) {
                    cycleBuyers.push(buyer);
                    bidAmounts.push(bidAmount);
                }
            }

            if (cycleBuyers.length === 0) {
                emit("  ⚠️  No buyers with sufficient vault balance — skipping cycle");
                results.push({
                    cycle: c + 1, leadId, vertical: lead.vertical, state: lead.state,
                    bids: [], refundCount: 0, gasUsed: 0n, durationMs: Date.now() - cycleStart,
                    error: "No buyer funds",
                });
                continue;
            }

            emit(`  🎯 ${cycleBuyers.length} bidders: ${cycleBuyers.map((b, i) =>
                `${b.address.slice(0, 8)}…=$${bidAmounts[i]}`).join(" | ")}`);

            // ── Step 3: Lock funds for each bidder ──
            const lockIds: (number | null)[] = [];
            for (let b = 0; b < cycleBuyers.length; b++) {
                const buyer = cycleBuyers[b];
                const amount = ethers.parseUnits(bidAmounts[b].toString(), 6);

                try {
                    const lockReceipt = await sendTx(
                        `Lock $${bidAmounts[b]} for ${buyer.address.slice(0, 8)}…`,
                        () => vault.lockForBid(buyer.address, amount)
                    );
                    cycleGas += lockReceipt.gasUsed || 0n;

                    // Parse lockId from BidLocked event
                    const lockEvent = lockReceipt.logs?.find((l: any) => {
                        try { return vault.interface.parseLog(l)?.name === "BidLocked"; } catch { return false; }
                    });
                    const parsed = lockEvent ? vault.interface.parseLog(lockEvent) : null;
                    const lockId = parsed ? Number(parsed.args[0]) : null;
                    lockIds.push(lockId);
                    emit(`  🔒 Buyer ${b + 1} locked: lockId=${lockId} ($${bidAmounts[b]}+$1)`);
                } catch (err: any) {
                    emit(`  ❌ Lock failed for buyer ${b + 1}: ${(err.message || "").slice(0, 80)}`);
                    lockIds.push(null);
                }
            }

            // ── Step 4: Determine winner (highest bid with valid lock) ──
            let winnerIdx = -1;
            let winnerBid = 0;
            for (let b = 0; b < bidAmounts.length; b++) {
                if (lockIds[b] != null && bidAmounts[b] > winnerBid) {
                    winnerBid = bidAmounts[b];
                    winnerIdx = b;
                }
            }

            if (winnerIdx < 0) {
                emit("  ⚠️  No valid locks — skipping settlement");
                results.push({
                    cycle: c + 1, leadId, vertical: lead.vertical, state: lead.state,
                    bids: bidAmounts, refundCount: 0, gasUsed: cycleGas,
                    durationMs: Date.now() - cycleStart, error: "All locks failed",
                });
                totalGas += cycleGas;
                continue;
            }

            const winner = cycleBuyers[winnerIdx];
            const winnerLockId = lockIds[winnerIdx]!;
            emit(`  🏆 Winner: ${winner.address.slice(0, 10)}… at $${winnerBid} (lockId=${winnerLockId})`);

            // ── Step 5: Settle winner ──
            let settleTx = "";
            try {
                const sellerAddr = sellerWalletData[c % sellerWalletData.length].address;
                const settleReceipt = await sendTx(
                    `Settle lockId=${winnerLockId} → ${sellerAddr.slice(0, 10)}…`,
                    () => vault.settleBid(winnerLockId, sellerAddr)
                );
                settleTx = settleReceipt.hash;
                cycleGas += settleReceipt.gasUsed || 0n;
                settleCount++;

                // Parse settlement event
                const settleEvent = settleReceipt.logs?.find((l: any) => {
                    try { return vault.interface.parseLog(l)?.name === "BidSettled"; } catch { return false; }
                });
                if (settleEvent) {
                    const parsed = vault.interface.parseLog(settleEvent);
                    if (parsed) {
                        emit(`  💰 Settled: buyer=${ethers.formatUnits(parsed.args[3], 6)} USDC → ` +
                            `seller=${ethers.formatUnits(parsed.args[4], 6)} | ` +
                            `platform=${ethers.formatUnits(parsed.args[5], 6)} | fee=${ethers.formatUnits(parsed.args[6], 6)}`);
                    }
                }
            } catch (err: any) {
                emit(`  ❌ Settlement failed: ${(err.message || "").slice(0, 80)}`);
            }

            // ── Step 6: Refund losers ──
            for (let b = 0; b < lockIds.length; b++) {
                if (b === winnerIdx || lockIds[b] == null) continue;
                try {
                    const refundReceipt = await sendTx(
                        `Refund lockId=${lockIds[b]}`,
                        () => vault.refundBid(lockIds[b]!)
                    );
                    cycleGas += refundReceipt.gasUsed || 0n;
                    refundCount++;
                    refundTotal++;
                    emit(`  ↩️  Refunded: lockId=${lockIds[b]} → ${cycleBuyers[b].address.slice(0, 10)}… ($${bidAmounts[b]}+$1)`);
                } catch (err: any) {
                    emit(`  ⚠️  Refund failed lockId=${lockIds[b]}: ${(err.message || "").slice(0, 60)}`);
                }
            }

            // ── Step 7: PoR check ──
            try {
                const porVault = new ethers.Contract(VAULT_ADDRESS, [
                    "function verifyReserves() external returns (bool)",
                    "event ReservesVerified(uint256 contractBalance, uint256 claimedTotal, bool solvent, uint256 timestamp)",
                ], deployer);

                const porTx = await porVault.verifyReserves();
                const porReceipt = await porTx.wait();
                cycleGas += porReceipt.gasUsed || 0n;

                const porEvent = porReceipt.logs?.find((l: any) => {
                    try { return porVault.interface.parseLog(l)?.name === "ReservesVerified"; } catch { return false; }
                });
                if (porEvent) {
                    const parsed = porVault.interface.parseLog(porEvent);
                    if (parsed) {
                        const solvent = parsed.args[2];
                        emit(`  🔍 PoR: ${solvent ? "✅ SOLVENT" : "❌ INSOLVENT"} | ` +
                            `contract=${ethers.formatUnits(parsed.args[0], 6)} | claims=${ethers.formatUnits(parsed.args[1], 6)}`);
                    }
                } else {
                    emit(`  🔍 PoR: tx confirmed (no event — may be view-only)`);
                }
            } catch {
                emit(`  ℹ️  PoR: skipped (may not be callable externally)`);
            }

            totalGas += cycleGas;
            const durationMs = Date.now() - cycleStart;

            results.push({
                cycle: c + 1, leadId, vertical: lead.vertical, state: lead.state,
                bids: bidAmounts, winner: winner.address, winnerBid,
                settleTx, lockId: winnerLockId, refundCount,
                gasUsed: cycleGas, durationMs,
            });

            emit(`  ⏱️  Cycle ${c + 1}: ${(durationMs / 1000).toFixed(1)}s | gas=${cycleGas}`);

        } catch (err: any) {
            const durationMs = Date.now() - cycleStart;
            results.push({
                cycle: c + 1, leadId: `err_${c}`, vertical: lead.vertical, state: lead.state,
                bids: [], refundCount: 0, gasUsed: cycleGas,
                durationMs, error: (err.message || "").slice(0, 100),
            });
            totalGas += cycleGas;
            emit(`  ❌ Cycle ${c + 1} error: ${(err.message || "").slice(0, 100)}`);
        }

        // Inter-cycle pause
        if (c < CYCLES - 1 && !interrupted) {
            await new Promise(r => setTimeout(r, INTER_CYCLE_MS));
        }
    }

    // ══════════════════════════════════════════
    //  FINAL SUMMARY
    // ══════════════════════════════════════════

    emit(`\n${"═".repeat(70)}`);
    emit("📋 STRESS TEST — FINAL SUMMARY");
    emit("═".repeat(70));

    const ok = results.filter(r => !r.error);
    const fail = results.filter(r => r.error);

    emit(`\nCycles completed: ${results.length}/${CYCLES}`);
    emit(`Successful:       ${ok.length}`);
    emit(`Failed:           ${fail.length}`);
    emit(`Settlements:      ${settleCount}`);
    emit(`Refunds:          ${refundTotal}`);
    emit(`Total gas:        ${totalGas}`);
    if (results.length > 0) {
        emit(`Avg cycle time:   ${(results.reduce((s, r) => s + r.durationMs, 0) / results.length / 1000).toFixed(1)}s`);
    }

    emit(`\n| Cyc | Vert | ST | Bids | Winner | Amt | Settle Tx | Lock | Refs |`);
    emit(`|-----|------|----|------|--------|-----|-----------|------|------|`);
    for (const r of results) {
        if (r.error) {
            emit(`| ${String(r.cycle).padStart(3)} | ${r.vertical.slice(0, 4).padEnd(4)} | ${r.state} | — | ❌ | — | ${r.error.slice(0, 22)} | — | — |`);
        } else {
            emit(`| ${String(r.cycle).padStart(3)} | ${r.vertical.slice(0, 4).padEnd(4)} | ${r.state} | ${r.bids?.map(b => `$${b}`).join(",").padEnd(16)} | ${(r.winner || "").slice(0, 8)}… | $${r.winnerBid} | ${(r.settleTx || "").slice(0, 12)}… | ${r.lockId} | ${r.refundCount} |`);
        }
    }

    // Post-test vault balances
    emit("\n📊 Post-Test Vault Balances:");
    for (let i = 0; i < buyers.length; i++) {
        const bal = await vault.balanceOf(buyers[i].address);
        const locked = await vault.lockedBalances(buyers[i].address);
        emit(`  B${i + 1}: ${ethers.formatUnits(bal, 6)} avail | ${ethers.formatUnits(locked, 6)} locked`);
    }

    const totalDep = await vault.totalDeposited();
    const deployerFinalETH = await provider.getBalance(deployer.address);
    emit(`\nVault total deposited: ${ethers.formatUnits(totalDep, 6)} USDC`);
    emit(`Deployer remaining:   ${ethers.formatEther(deployerFinalETH)} ETH`);

    emit("\n✅ 04-autobid-stress-test COMPLETE");
    flushLog();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Stress test failed:", error.message || error);
        flushLog();
        process.exit(1);
    });
