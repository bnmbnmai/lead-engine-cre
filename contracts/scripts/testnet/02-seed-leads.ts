/**
 * 02-seed-leads.ts — Seed Marketplace with Leads via Backend API
 *
 * === LOW-BALANCE PHASE 1 TEST SUITE (0.158 ETH TOTAL) ===
 *
 * Submits 20 leads across 3 verticals (solar, roofing, insurance) via
 * POST /api/marketplace/leads/public/submit (no auth required).
 *
 * Lower reserve prices ($8–$18) to keep bids affordable with 60 USDC budgets.
 *
 * Requires:
 *   - Backend running on localhost:3001
 *
 * Usage:
 *   npx hardhat run scripts/testnet/02-seed-leads.ts --network baseSepolia
 */

import * as fs from "fs";
import * as path from "path";

// ── Configuration ──────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
const LEADS_COUNT = 20;
const DELAY_MS = 8_000; // 8s between leads for CRE scoring
const DRY_RUN = process.env.DRY_RUN === "true";

// ── Seller wallets (first 3 faucet wallets) ──
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

// ── Lead data ──────────────────────────────────
const VERTICALS = ["solar", "roofing", "insurance"];
const STATES = ["CA", "TX", "FL", "NY", "AZ", "CO", "NV", "OR", "WA", "NC"];
const CITIES: Record<string, string[]> = {
    CA: ["Los Angeles", "San Diego", "San Jose"], TX: ["Houston", "Dallas", "Austin"],
    FL: ["Miami", "Tampa", "Orlando"], NY: ["New York", "Buffalo", "Albany"],
    AZ: ["Phoenix", "Tucson", "Scottsdale"], CO: ["Denver", "Boulder", "Aurora"],
    NV: ["Las Vegas", "Reno", "Henderson"], OR: ["Portland", "Eugene", "Salem"],
    WA: ["Seattle", "Tacoma", "Spokane"], NC: ["Charlotte", "Raleigh", "Durham"],
};

function makeLead(idx: number) {
    const vertical = VERTICALS[idx % VERTICALS.length];
    const state = STATES[idx % STATES.length];
    const city = (CITIES[state] || ["TestCity"])[idx % 3];
    const reserve = 8 + Math.floor(Math.random() * 10); // $8–18

    const baseParams: Record<string, any> = { testIndex: idx, ts: new Date().toISOString() };

    if (vertical === "solar") {
        Object.assign(baseParams, {
            monthlyBill: 150 + idx * 20,
            roofAge: 5 + (idx % 20),
            ownership: "own",
            creditScore: ["excellent", "good", "fair"][idx % 3],
            homeType: ["single_family", "townhouse", "condo"][idx % 3],
        });
    } else if (vertical === "roofing") {
        Object.assign(baseParams, {
            projectType: ["full_replacement", "repair", "inspection"][idx % 3],
            roofAge: 10 + (idx % 25),
            urgency: ["immediate", "within_month", "within_3_months"][idx % 3],
            roofType: ["asphalt_shingle", "metal", "tile"][idx % 3],
        });
    } else {
        Object.assign(baseParams, {
            insuranceType: ["home", "auto", "bundle"][idx % 3],
            coverageLevel: ["standard", "premium"][idx % 2],
            hasExistingPolicy: idx % 2 === 0,
            householdSize: 1 + (idx % 5),
        });
    }

    return { vertical, state, city, reserve, params: baseParams };
}

// ── Ensure seller exists via demo panel ──
async function ensureSeller(walletAddress: string): Promise<string> {
    try {
        // Inject a demo lead to auto-create seller
        await fetch(`${BACKEND_URL}/api/v1/demo-panel/lead`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                vertical: "solar",
                geo: { country: "US", state: "CA" },
                sellerWallet: walletAddress,
            }),
        });
    } catch { /* seller may already exist */ }

    // Look up the user ID from the demo-panel
    try {
        const resp = await fetch(`${BACKEND_URL}/api/v1/demo-panel/buyers-sellers`);
        if (resp.ok) {
            const data: any = await resp.json();
            const match = (data.sellers || []).find((s: any) =>
                s.walletAddress?.toLowerCase() === walletAddress.toLowerCase()
            );
            if (match) return match.userId;
        }
    } catch { /* fallback */ }

    return walletAddress; // fallback
}

// ── Main ───────────────────────────────────────
async function main() {
    console.log("=== LOW-BALANCE PHASE 1 TEST SUITE (0.158 ETH TOTAL) ===\n");
    console.log("═".repeat(60));
    console.log("🌱 02-SEED-LEADS — Submit 20 Leads to Marketplace");
    console.log("═".repeat(60));
    console.log(`Backend:   ${BACKEND_URL}`);
    console.log(`Leads:     ${LEADS_COUNT}`);
    console.log(`Delay:     ${DELAY_MS / 1000}s`);
    console.log(`Dry Run:   ${DRY_RUN}`);

    const wallets = parseWalletFile();
    const sellerWallets = wallets.slice(0, 3).map(w => w.address);

    // Ensure sellers exist
    console.log("\n🔧 Ensuring seller profiles...");
    const sellerIds: string[] = [];
    for (const w of sellerWallets) {
        const id = await ensureSeller(w);
        sellerIds.push(id);
        console.log(`  ✅ ${w.slice(0, 12)}… → ${id.slice(0, 16)}`);
    }

    // Submit leads
    interface LeadResult {
        idx: number; vertical: string; state: string; city: string;
        reserve: number; leadId: string; status: string; error?: string;
    }
    const results: LeadResult[] = [];
    let ok = 0, fail = 0;

    for (let i = 0; i < LEADS_COUNT; i++) {
        const lead = makeLead(i);
        const sellerWallet = sellerWallets[i % sellerWallets.length];

        if (DRY_RUN) {
            console.log(`  [${i + 1}] DRY: ${lead.vertical}/${lead.state}/${lead.city} $${lead.reserve}`);
            results.push({ idx: i + 1, ...lead, leadId: "dry", status: "DRY_RUN" });
            continue;
        }

        try {
            // Use demo-panel/lead endpoint which auto-creates sellers from wallet
            // and handles CRE scoring, auction room creation, etc.
            const resp = await fetch(`${BACKEND_URL}/api/v1/demo-panel/lead`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sellerWallet,
                    vertical: lead.vertical,
                }),
            });

            const data: any = await resp.json();
            if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 100)}`);

            const leadId = data.lead?.id || "?";
            const status = data.success ? "IN_AUCTION" : "submitted";
            console.log(`  [${i + 1}] ✅ ${lead.vertical} | ${lead.state}/${lead.city} | $${lead.reserve} → ${leadId} (${status})`);
            results.push({ idx: i + 1, ...lead, leadId, status });
            ok++;
        } catch (err: any) {
            console.log(`  [${i + 1}] ❌ ${lead.vertical} | ${lead.state}: ${(err.message || "").slice(0, 80)}`);
            results.push({ idx: i + 1, ...lead, leadId: "—", status: "FAILED", error: err.message });
            fail++;
        }

        if (i < LEADS_COUNT - 1) {
            process.stdout.write(`  ⏳ ${DELAY_MS / 1000}s...`);
            await new Promise(r => setTimeout(r, DELAY_MS));
            process.stdout.write(" ✓\n");
        }
    }

    // Summary
    console.log("\n" + "═".repeat(60));
    console.log("📋 LEAD SEEDING SUMMARY");
    console.log("═".repeat(60));
    console.log(`Submitted: ${results.length} | Success: ${ok} | Failed: ${fail}`);
    console.log(`\n| # | Vertical | State | City | Reserve | Lead ID | Status |`);
    console.log(`|---|----------|-------|------|---------|---------|--------|`);
    for (const r of results) {
        console.log(`| ${r.idx} | ${r.vertical} | ${r.state} | ${r.city} | $${r.reserve} | ${r.leadId.slice(0, 14)} | ${r.status} |`);
    }
    console.log("\n✅ 02-seed-leads complete");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Lead seeding failed:", error.message || error);
        process.exit(1);
    });
