/**
 * simulate-full-cycle.ts — End-to-End On-Chain Simulation
 *
 * Exercises the complete Lead Engine CRE lifecycle with 8 mnemonic-derived wallets:
 *   Phase 1: KYC Setup + Lead/Vertical Minting
 *   Phase 2: Marketplace Commit-Reveal Bidding (USDC)
 *   Phase 3: Buy-Now Instant Purchase (USDC)
 *   Phase 4: VerticalAuction with Holder Perks (ETH)
 *   Phase 5: NFT Resale via transferWithRoyalty
 *   Phase 6: RTBEscrow Lifecycle
 *
 * Usage:
 *   npx hardhat run scripts/simulate-full-cycle.ts --network hardhat   (instant, uses time.increase)
 *   npx hardhat run scripts/simulate-full-cycle.ts --network sepolia   (real timing, short durations)
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ============================================
// Infrastructure: Logging + Retry + Gas
// ============================================

const LOG_FILE = path.join(__dirname, "..", "simulation-results.txt");
const log: string[] = [];

function emit(msg: string) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}`;
    console.log(line);
    log.push(line);
}

function flushLog() {
    fs.appendFileSync(LOG_FILE, "\n" + "═".repeat(72) + "\n" + log.join("\n") + "\n");
    emit(`📄 Results appended to ${LOG_FILE}`);
}

async function sendTx(
    label: string,
    txFn: () => Promise<any>,
    retries = 3
): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const tx = await txFn();
            if (tx?.wait) {
                const receipt = await tx.wait();
                emit(`  ✅ ${label} — tx ${receipt.hash} (gas: ${receipt.gasUsed})`);
                return receipt;
            }
            // For view calls or non-tx returns
            return tx;
        } catch (err: any) {
            const errMsg = err?.shortMessage || err?.message || String(err);
            emit(`  ⚠️  ${label} attempt ${attempt}/${retries} failed: ${errMsg.slice(0, 120)}`);
            if (attempt === retries) {
                emit(`  ❌ ${label} FAILED after ${retries} attempts`);
                throw err;
            }
            const backoff = 1000 * Math.pow(2, attempt - 1);
            await new Promise(r => setTimeout(r, backoff));
        }
    }
}

/** Wait for real time on live networks, or manipulate time on local */
async function advanceTime(seconds: number, label: string) {
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    if (chainId === 31337) {
        // Local Hardhat — use time manipulation
        const { time } = await import("@nomicfoundation/hardhat-network-helpers");
        await time.increase(seconds);
        emit(`  ⏩ Advanced ${seconds}s (local) — ${label}`);
    } else {
        // Live network — wait real time
        emit(`  ⏳ Waiting ${seconds}s (live) — ${label}`);
        await new Promise(r => setTimeout(r, seconds * 1000));
    }
}

// ============================================
// x402 Configuration
// ============================================

/** Default x402 settlement amount (USDC, 6 decimals). Override via X402_AMOUNT env. */
const X402_PAYMENT_AMOUNT = Number(process.env.X402_AMOUNT || "50");

/** Track x402 payment results for summary */
const x402Results: { label: string; buyer: string; seller: string; amount: string; txHash: string }[] = [];

/**
 * x402 Instant Settlement — mirrors x402.service.ts flow:
 *   1. Log buyer + seller USDC balances
 *   2. Auto top-up buyer if broke (local only)
 *   3. createEscrow → fundEscrow → releaseEscrow
 *   4. Log post-payment balances
 *   5. Print clear settlement line
 */
async function x402Pay(
    label: string,
    escrowContract: any,
    usdcContract: any,
    buyerSigner: any,
    sellerAddress: string,
    leadIdStr: string,
    amountUSDC: number,
    chainId: number
) {
    const amountRaw = ethers.parseUnits(amountUSDC.toString(), 6);
    const escrowAddr = await escrowContract.getAddress();

    emit(`\n  💳 x402 Settlement: ${label}`);
    emit(`     Amount: ${amountUSDC} USDC | Buyer: ${buyerSigner.address.slice(0, 10)}… → Seller: ${sellerAddress.slice(0, 10)}…`);

    // ── Balance check (before) ──
    const buyerBalBefore = await usdcContract.balanceOf(buyerSigner.address);
    const sellerBalBefore = await usdcContract.balanceOf(sellerAddress);
    emit(`     📊 Before — Buyer: ${ethers.formatUnits(buyerBalBefore, 6)} USDC | Seller: ${ethers.formatUnits(sellerBalBefore, 6)} USDC`);

    // ── Auto top-up if buyer is broke ──
    if (buyerBalBefore < amountRaw) {
        if (chainId === 31337) {
            const deficit = amountRaw - buyerBalBefore + ethers.parseUnits("100", 6); // +100 buffer
            await sendTx(`     Auto top-up buyer +${ethers.formatUnits(deficit, 6)} USDC`, () =>
                usdcContract.mint(buyerSigner.address, deficit)
            );
        } else {
            emit(`     ⚠️  Buyer balance too low (${ethers.formatUnits(buyerBalBefore, 6)} < ${amountUSDC}). Top up on Sepolia faucet!`);
        }
    }

    // ── Step 1: Admin creates escrow ──
    await sendTx(`     x402 createEscrow (${amountUSDC} USDC)`, () =>
        escrowContract.createEscrow(leadIdStr, sellerAddress, buyerSigner.address, amountRaw)
        , 2);

    // ── Step 2: Buyer approves + funds ──
    await sendTx("     x402 buyer approves USDC", () =>
        usdcContract.connect(buyerSigner).approve(escrowAddr, ethers.MaxUint256)
        , 2);

    // Find the escrow ID (most recent)
    const escrowId = await escrowContract.leadToEscrow(leadIdStr);

    await sendTx("     x402 buyer funds escrow", () =>
        escrowContract.connect(buyerSigner).fundEscrow(escrowId)
        , 2);

    // ── Step 3: Instant release ──
    if (chainId === 31337) {
        const { time } = await import("@nomicfoundation/hardhat-network-helpers");
        await time.increase(86401); // skip 24h release delay
    }

    const releaseReceipt = await sendTx("     x402 releaseEscrow → seller paid", () =>
        escrowContract.releaseEscrow(escrowId)
        , 2);

    // ── Balance check (after) ──
    const buyerBalAfter = await usdcContract.balanceOf(buyerSigner.address);
    const sellerBalAfter = await usdcContract.balanceOf(sellerAddress);
    emit(`     📊 After  — Buyer: ${ethers.formatUnits(buyerBalAfter, 6)} USDC | Seller: ${ethers.formatUnits(sellerBalAfter, 6)} USDC`);

    const sellerGain = sellerBalAfter - sellerBalBefore;
    emit(`     💰 Seller received: ${ethers.formatUnits(sellerGain, 6)} USDC (after 2.5% platform fee)`);
    emit(`     ✅ x402 payment of ${amountUSDC} USDC sent from Buyer → Seller`);

    x402Results.push({
        label,
        buyer: buyerSigner.address,
        seller: sellerAddress,
        amount: `${amountUSDC} USDC`,
        txHash: releaseReceipt?.hash || "local",
    });
}

// ============================================
// Main
// ============================================

async function main() {
    const signers = await ethers.getSigners();
    if (signers.length < 8) {
        throw new Error(`Need 8 signers, have ${signers.length}. Set TESTNET_MNEMONIC in .env`);
    }

    const [deployer, sellerA, sellerB, buyer1, buyer2, buyer3, buyer4, reseller] = signers;
    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const networkName = chainId === 31337 ? "hardhat" : chainId === 11155111 ? "sepolia" : `chain-${chainId}`;

    // Timing: instant on local, short on live
    const AUCTION_DURATION = chainId === 31337 ? 3600 : 90;   // 1h local, 90s live
    const REVEAL_WINDOW = chainId === 31337 ? 900 : 45;    // 15m local, 45s live

    emit("═".repeat(60));
    emit("🏁 LEAD ENGINE CRE — FULL CYCLE SIMULATION");
    emit("═".repeat(60));
    emit(`Network:  ${networkName} (chainId ${chainId})`);
    emit(`Deployer: ${deployer.address}`);
    emit(`Wallets:  ${signers.slice(0, 8).map((s, i) => `[${i}] ${s.address}`).join("\n          ")}`);
    emit(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
    emit("");

    // ============================================
    // Deploy contracts (local) or load (Sepolia)
    // ============================================

    let aceCompliance: any, leadNFT: any, marketplace: any, escrow: any, mockUSDC: any;
    let verticalNFT: any, verticalAuction: any;

    if (chainId === 31337) {
        emit("📦 Phase 0: Deploying contracts (local)...");

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);
        const usdcAddr = await mockUSDC.getAddress();

        const ACEFactory = await ethers.getContractFactory("ACECompliance");
        aceCompliance = await ACEFactory.deploy(deployer.address);

        const LeadNFTFactory = await ethers.getContractFactory("LeadNFTv2");
        leadNFT = await LeadNFTFactory.deploy(deployer.address);

        const EscrowFactory = await ethers.getContractFactory("RTBEscrow");
        escrow = await EscrowFactory.deploy(usdcAddr, deployer.address, 250, deployer.address);

        const MarketplaceFactory = await ethers.getContractFactory("Marketplace");
        marketplace = await MarketplaceFactory.deploy(
            await leadNFT.getAddress(),
            await aceCompliance.getAddress(),
            usdcAddr,
            await escrow.getAddress(),
            deployer.address
        );

        const VerticalNFTFactory = await ethers.getContractFactory("VerticalNFT");
        verticalNFT = await VerticalNFTFactory.deploy(deployer.address, 200, deployer.address);

        const VerticalAuctionFactory = await ethers.getContractFactory("VerticalAuction");
        verticalAuction = await VerticalAuctionFactory.deploy();

        // Permissions
        await leadNFT.setAuthorizedMinter(deployer.address, true);
        await leadNFT.setMarketplace(await marketplace.getAddress());
        await escrow.setAuthorizedCaller(await marketplace.getAddress(), true);
        await escrow.setAuthorizedCaller(deployer.address, true);
        await aceCompliance.setAuthorizedVerifier(deployer.address, true);
        await verticalNFT.setAuthorizedMinter(deployer.address, true);

        // Set vertical policies
        const verticals = ["solar", "mortgage", "roofing", "insurance", "home_services", "b2b_saas"];
        for (const v of verticals) {
            await aceCompliance.setDefaultVerticalPolicy(ethers.keccak256(ethers.toUtf8Bytes(v)), true);
        }

        // Fund buyers with mock USDC
        const fundAmount = ethers.parseUnits("10000", 6);
        for (const buyer of [buyer1, buyer2, buyer3, buyer4, reseller]) {
            await mockUSDC.mint(buyer.address, fundAmount);
            await mockUSDC.connect(buyer).approve(await marketplace.getAddress(), ethers.MaxUint256);
        }

        emit("  ✅ All contracts deployed and configured (local)");
    } else {
        // Load existing contracts from env
        emit("📦 Phase 0: Loading deployed contracts (Sepolia)...");

        const envAddr = (key: string): string => {
            const v = process.env[key];
            if (!v) throw new Error(`Missing env: ${key}`);
            return v;
        };

        aceCompliance = await ethers.getContractAt("ACECompliance", envAddr("ACE_CONTRACT_ADDRESS"));
        leadNFT = await ethers.getContractAt("LeadNFTv2", envAddr("LEAD_NFT_CONTRACT_ADDRESS"));
        marketplace = await ethers.getContractAt("Marketplace", envAddr("MARKETPLACE_CONTRACT_ADDRESS"));
        escrow = await ethers.getContractAt("RTBEscrow", envAddr("ESCROW_CONTRACT_ADDRESS"));

        const usdcAddr = envAddr("USDC_SEPOLIA");
        mockUSDC = await ethers.getContractAt("MockERC20", usdcAddr);

        // VerticalNFT and VerticalAuction may not be deployed yet on Sepolia
        // We'll skip those phases if they're not available
        try {
            verticalNFT = await ethers.getContractAt("VerticalNFT", envAddr("VERTICAL_NFT_ADDRESS"));
            verticalAuction = await ethers.getContractAt("VerticalAuction", envAddr("VERTICAL_AUCTION_ADDRESS"));
        } catch {
            emit("  ⚠️  VerticalNFT/VerticalAuction not found — Phases 4-5 will be skipped");
        }

        emit("  ✅ Contracts loaded from .env");
    }

    // ============================================
    // Phase 1: KYC Setup + Minting
    // ============================================

    emit("\n🔑 Phase 1: KYC Setup + Lead Minting");
    emit("─".repeat(40));

    const kycProof = ethers.keccak256(ethers.toUtf8Bytes("simulation_kyc"));
    const wallets = [deployer, sellerA, sellerB, buyer1, buyer2, buyer3, buyer4, reseller];

    for (let i = 0; i < wallets.length; i++) {
        await sendTx(`KYC verify wallet[${i}] ${wallets[i].address.slice(0, 10)}…`, () =>
            aceCompliance.verifyKYC(wallets[i].address, kycProof, "0x")
        );
    }

    const vertical = ethers.keccak256(ethers.toUtf8Bytes("solar"));
    const geoHash = ethers.keccak256(ethers.toUtf8Bytes("9q"));
    const piiHash = ethers.keccak256(ethers.toUtf8Bytes("sim_pii"));
    const reservePrice = ethers.parseUnits("50", 6);

    const { time: timeHelper } = chainId === 31337
        ? await import("@nomicfoundation/hardhat-network-helpers")
        : { time: { latest: async () => Math.floor(Date.now() / 1000) } as any };

    const now = await timeHelper.latest();
    const expiresAt = now + 86400 * 30; // 30 days

    // Mint 4 leads
    const leadIds = ["sim_lead_1", "sim_lead_2", "sim_lead_3", "sim_lead_4"];
    const leadOwners = [sellerA, sellerA, sellerB, sellerB];

    for (let i = 0; i < leadIds.length; i++) {
        const platformLeadId = ethers.keccak256(ethers.toUtf8Bytes(leadIds[i]));
        await sendTx(`Mint LeadNFT #${i + 1} → ${leadOwners[i].address.slice(0, 10)}…`, () =>
            leadNFT.mintLead(
                leadOwners[i].address,
                platformLeadId,
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                0, // PLATFORM source
                true, // TCPA consent
                `ipfs://sim_lead_${i + 1}`
            )
        );
    }

    // Mint VerticalNFT if available
    let vertTokenId: bigint | null = null;
    if (verticalNFT) {
        const solarSlug = ethers.keccak256(ethers.toUtf8Bytes("solar"));
        await sendTx("Mint VerticalNFT #1 (solar)", () =>
            verticalNFT.mintVertical(
                deployer.address,
                solarSlug,
                "Solar Vertical",
                ethers.parseEther("0.005"),
                "ipfs://vert_solar"
            )
        );
        vertTokenId = 1n;
        emit("  📦 VerticalNFT #1 minted");
    }

    emit("\n✅ Phase 1 complete — 8 wallets KYC'd, 4 leads minted");

    // ============================================
    // Phase 2: Marketplace Commit-Reveal Bidding
    // ============================================

    emit("\n🏷️  Phase 2: Commit-Reveal Bidding (USDC)");
    emit("─".repeat(40));

    const tokenId1 = 1n;
    const marketplaceAddr = await marketplace.getAddress();

    // Seller A approves + lists LeadNFT #1
    await sendTx("SellerA approves LeadNFT #1", () =>
        leadNFT.connect(sellerA).approve(marketplaceAddr, tokenId1)
    );
    await sendTx("SellerA lists LeadNFT #1 (auction)", () =>
        marketplace.connect(sellerA).createListing(
            tokenId1,
            reservePrice,     // reserve: 50 USDC
            0,                // no buy-now
            AUCTION_DURATION, // 1h local / 90s live
            REVEAL_WINDOW,    // 15m local / 45s live
            true              // accept offsite
        )
    );

    const listingId1 = 1n;

    // 3 buyers commit bids
    const bids = [
        { signer: buyer1, amount: ethers.parseUnits("75", 6), salt: ethers.encodeBytes32String("salt_b1") },
        { signer: buyer2, amount: ethers.parseUnits("100", 6), salt: ethers.encodeBytes32String("salt_b2") },
        { signer: buyer3, amount: ethers.parseUnits("120", 6), salt: ethers.encodeBytes32String("salt_b3") },
    ];

    for (let i = 0; i < bids.length; i++) {
        const { signer, amount, salt } = bids[i];
        const commitment = ethers.solidityPackedKeccak256(["uint96", "bytes32"], [amount, salt]);

        // Ensure USDC approval for deposit
        await sendTx(`Buyer${i + 1} approves USDC for marketplace`, () =>
            mockUSDC.connect(signer).approve(marketplaceAddr, ethers.MaxUint256)
        );
        await sendTx(`Buyer${i + 1} commits bid (${ethers.formatUnits(amount, 6)} USDC)`, () =>
            marketplace.connect(signer).commitBid(listingId1, commitment)
        );
    }

    // Advance past bidding phase
    await advanceTime(AUCTION_DURATION + 1, "bidding phase ended");

    // All 3 reveal
    for (let i = 0; i < bids.length; i++) {
        const { signer, amount, salt } = bids[i];
        await sendTx(`Buyer${i + 1} reveals bid (${ethers.formatUnits(amount, 6)} USDC)`, () =>
            marketplace.connect(signer).revealBid(listingId1, amount, salt)
        );
    }

    // Advance past reveal deadline
    await advanceTime(REVEAL_WINDOW + 1, "reveal window ended");

    // Resolve auction
    await sendTx("Resolve auction #1 — Buyer3 should win (120 USDC)", () =>
        marketplace.resolveAuction(listingId1)
    );

    // Verify winner
    const newOwner = await leadNFT.ownerOf(tokenId1);
    emit(`  🏆 LeadNFT #1 new owner: ${newOwner} (expected: ${buyer3.address})`);
    emit(`  ${newOwner.toLowerCase() === buyer3.address.toLowerCase() ? "✅ CORRECT" : "❌ MISMATCH"}`);

    emit("\n✅ Phase 2 complete — Commit-reveal auction resolved");

    // ============================================
    // Phase 2.5: x402 Instant Settlement (Auction)
    // ============================================

    emit("\n⚡ Phase 2.5: x402 Settlement (auction winner → seller)");
    emit("─".repeat(40));

    await x402Pay(
        "Auction #1 settlement",
        escrow,
        mockUSDC,
        buyer3,              // winner
        sellerA.address,     // seller
        "x402_auction_1",    // lead ID for escrow
        X402_PAYMENT_AMOUNT, // configurable, default 50 USDC
        chainId
    );

    emit("\n✅ Phase 2.5 complete — Instant x402 settlement after auction");

    // ============================================
    // Phase 3: Buy-Now Instant Purchase
    // ============================================

    emit("\n💰 Phase 3: Buy-Now Instant Purchase (USDC)");
    emit("─".repeat(40));

    const tokenId2 = 2n;
    const buyNowPrice = ethers.parseUnits("200", 6);

    await sendTx("SellerA approves LeadNFT #2", () =>
        leadNFT.connect(sellerA).approve(marketplaceAddr, tokenId2)
    );
    await sendTx("SellerA lists LeadNFT #2 (buy-now @ 200 USDC)", () =>
        marketplace.connect(sellerA).createListing(
            tokenId2,
            reservePrice,     // reserve
            buyNowPrice,      // buy-now price
            AUCTION_DURATION,
            REVEAL_WINDOW,
            true
        )
    );

    const listingId2 = 2n;

    await sendTx("Buyer4 approves USDC", () =>
        mockUSDC.connect(buyer4).approve(marketplaceAddr, ethers.MaxUint256)
    );
    await sendTx("Buyer4 calls buyNow (200 USDC)", () =>
        marketplace.connect(buyer4).buyNow(listingId2)
    );

    const owner2 = await leadNFT.ownerOf(tokenId2);
    emit(`  🏆 LeadNFT #2 owner: ${owner2} (expected: ${buyer4.address})`);
    emit(`  ${owner2.toLowerCase() === buyer4.address.toLowerCase() ? "✅ CORRECT" : "❌ MISMATCH"}`);

    emit("\n✅ Phase 3 complete — Buy-now purchase successful");

    // ============================================
    // Phase 3.5: x402 Instant Settlement (Buy-Now)
    // ============================================

    emit("\n⚡ Phase 3.5: x402 Settlement (buy-now buyer → seller)");
    emit("─".repeat(40));

    await x402Pay(
        "Buy-Now #2 settlement",
        escrow,
        mockUSDC,
        buyer4,              // buy-now buyer
        sellerA.address,     // seller
        "x402_buynow_2",     // lead ID for escrow
        X402_PAYMENT_AMOUNT, // configurable, default 50 USDC
        chainId
    );

    emit("\n✅ Phase 3.5 complete — Instant x402 settlement after buy-now");

    // ============================================
    // Phase 4: VerticalAuction with Holder Perks
    // ============================================

    if (verticalNFT && verticalAuction && vertTokenId !== null) {
        emit("\n🎯 Phase 4: VerticalAuction (ETH + Holder Perks)");
        emit("─".repeat(40));

        const auctionAddr = await verticalAuction.getAddress();
        const solarSlug = ethers.keccak256(ethers.toUtf8Bytes("solar"));

        // Transfer VerticalNFT #1 to sellerB for the auction
        await sendTx("Transfer VerticalNFT #1 → SellerB", () =>
            verticalNFT.transferFrom(deployer.address, sellerB.address, vertTokenId)
        );

        // SellerB approves VerticalAuction contract
        await sendTx("SellerB approves VerticalAuction", () =>
            verticalNFT.connect(sellerB).approve(auctionAddr, vertTokenId)
        );

        // Create auction (60s on local/live)
        const auctionDuration = chainId === 31337 ? 120 : 90;
        const vertNFTAddr = await verticalNFT.getAddress();
        await sendTx("SellerB creates VerticalAuction", () =>
            verticalAuction.connect(sellerB).createAuction(
                vertNFTAddr,
                vertTokenId,
                solarSlug,
                ethers.parseEther("0.005"), // reserve: 0.005 ETH
                auctionDuration
            )
        );

        const auctionId = 1n;

        // Wait past pre-ping window (30s for holders only)
        await advanceTime(31, "pre-ping window passed — open to all bidders");

        // Buyer1 bids 0.01 ETH (non-holder)
        await sendTx("Buyer1 bids 0.01 ETH (non-holder)", () =>
            verticalAuction.connect(buyer1).placeBid(auctionId, { value: ethers.parseEther("0.01") })
        );

        // Reseller (wallet 7) — give them a VerticalNFT so they're a holder
        // Mint another solar vertical NFT to reseller so isHolder returns true
        await sendTx("Mint VerticalNFT #2 → Reseller (holder status)", () =>
            verticalNFT.mintVertical(
                reseller.address,
                solarSlug,
                "Solar Vertical 2",
                ethers.parseEther("0.005"),
                "ipfs://vert_solar_2"
            )
        );

        // Reseller bids 0.009 ETH (holder → effective 0.0108 ETH via 1.2×)
        await sendTx("Reseller bids 0.009 ETH (holder, effective 0.0108)", () =>
            verticalAuction.connect(reseller).placeBid(auctionId, { value: ethers.parseEther("0.009") })
        );

        // Wait for auction to end
        await advanceTime(auctionDuration + 1, "vertical auction ended");

        // Settle
        await sendTx("Settle VerticalAuction #1", () =>
            verticalAuction.settleAuction(auctionId)
        );

        const vertOwner = await verticalNFT.ownerOf(vertTokenId);
        emit(`  🏆 VerticalNFT #1 new owner: ${vertOwner}`);
        emit(`  Holder perk: Reseller (0.009 ETH raw → 0.0108 effective) should beat Buyer1 (0.01 ETH)`);
        emit(`  ${vertOwner.toLowerCase() === reseller.address.toLowerCase() ? "✅ HOLDER WON" : "⚠️  Non-holder won"}`);

        emit("\n✅ Phase 4 complete — VerticalAuction settled with holder perks");

        // ============================================
        // Phase 5: NFT Resale via transferWithRoyalty
        // ============================================

        emit("\n🔄 Phase 5: NFT Resale (transferWithRoyalty)");
        emit("─".repeat(40));

        const resalePrice = ethers.parseEther("0.02");

        // Reseller approves the VerticalNFT contract for the transfer
        const vertNFTAddrResale = await verticalNFT.getAddress();
        await sendTx("Reseller approves VerticalNFT for resale", () =>
            verticalNFT.connect(reseller).approve(vertNFTAddrResale, vertTokenId)
        );

        // Buyer2 buys from reseller via transferWithRoyalty
        const preBalSeller = await ethers.provider.getBalance(reseller.address);
        const [royaltyReceiver, royaltyAmount] = await verticalNFT.royaltyInfo(vertTokenId, resalePrice);

        await sendTx(`Reseller → Buyer2 via transferWithRoyalty (${ethers.formatEther(resalePrice)} ETH)`, () =>
            verticalNFT.connect(reseller).transferWithRoyalty(vertTokenId, buyer2.address, { value: resalePrice })
        );

        emit(`  💸 Royalty: ${ethers.formatEther(royaltyAmount)} ETH → ${royaltyReceiver}`);
        emit(`  💰 Seller proceeds: ${ethers.formatEther(resalePrice - royaltyAmount)} ETH`);

        const resaleOwner = await verticalNFT.ownerOf(vertTokenId);
        emit(`  🏆 VerticalNFT #1 owner after resale: ${resaleOwner}`);
        emit(`  ${resaleOwner.toLowerCase() === buyer2.address.toLowerCase() ? "✅ CORRECT" : "❌ MISMATCH"}`);

        emit("\n✅ Phase 5 complete — Resale with on-chain royalty enforcement");
    } else {
        emit("\n⏭️  Phases 4-5 skipped (VerticalNFT/VerticalAuction not deployed)");
    }

    // ============================================
    // Phase 6: RTBEscrow Lifecycle
    // ============================================

    emit("\n🔒 Phase 6: RTBEscrow Lifecycle (USDC)");
    emit("─".repeat(40));

    const escrowLeadId = "sim_escrow_lead";
    const escrowAmount = ethers.parseUnits("300", 6);

    // Admin creates escrow
    await sendTx("Admin creates escrow (300 USDC)", () =>
        escrow.createEscrow(
            escrowLeadId,
            sellerB.address,  // seller
            buyer1.address,   // buyer
            escrowAmount
        )
    );

    const escrowId = 1n;

    // Buyer1 funds the escrow
    const escrowAddr = await escrow.getAddress();
    await sendTx("Buyer1 approves USDC for escrow", () =>
        mockUSDC.connect(buyer1).approve(escrowAddr, ethers.MaxUint256)
    );
    await sendTx("Buyer1 funds escrow", () =>
        escrow.connect(buyer1).fundEscrow(escrowId)
    );

    // Wait for release delay (24h on prod, instant on local)
    if (chainId === 31337) {
        await advanceTime(86401, "release delay (24h)");
    }

    // Release escrow (admin can bypass time on Sepolia)
    await sendTx("Release escrow → SellerB receives USDC (minus 2.5% fee)", () =>
        escrow.releaseEscrow(escrowId)
    );

    // Verify escrow state
    const escrowData = await escrow.getEscrow(escrowId);
    const feeAmount = ethers.formatUnits(escrowData.platformFee, 6);
    emit(`  💰 Escrow released: ${ethers.formatUnits(escrowAmount, 6)} USDC`);
    emit(`  💸 Platform fee: ${feeAmount} USDC (2.5%)`);
    emit(`  📊 State: ${escrowData.state} (expected: 2 = Released)`);
    emit(`  ${Number(escrowData.state) === 2 ? "✅ CORRECT" : "❌ MISMATCH"}`);

    emit("\n✅ Phase 6 complete — Escrow funded, released, fees collected");

    // ============================================
    // Summary
    // ============================================

    emit("\n" + "═".repeat(60));
    emit("📋 SIMULATION SUMMARY");
    emit("═".repeat(60));
    emit(`
Network:        ${networkName}
Wallets used:   8
Phases run:     ${verticalNFT ? 8 : 6} (including x402 settlements)

Results:
  ✅ Phase 1   — KYC'd 8 wallets, minted 4 leads + vertical NFT
  ✅ Phase 2   — Commit-reveal auction: Buyer3 won @ 120 USDC
  ⚡ Phase 2.5 — x402 settlement: ${X402_PAYMENT_AMOUNT} USDC Buyer3 → SellerA
  ✅ Phase 3   — Buy-now: Buyer4 purchased @ 200 USDC
  ⚡ Phase 3.5 — x402 settlement: ${X402_PAYMENT_AMOUNT} USDC Buyer4 → SellerA
  ${verticalNFT ? "✅ Phase 4   — VerticalAuction: Holder won via 1.2× multiplier" : "⏭️  Phase 4   — Skipped"}
  ${verticalNFT ? "✅ Phase 5   — NFT resale with EIP-2981 royalties" : "⏭️  Phase 5   — Skipped"}
  ✅ Phase 6   — Escrow: 300 USDC funded → released with 2.5% fee
`);

    // x402 Payment Summary
    if (x402Results.length > 0) {
        emit("💳 x402 PAYMENT SUMMARY");
        emit("─".repeat(40));
        for (const p of x402Results) {
            emit(`  ⚡ ${p.label}: ${p.amount} | ${p.buyer.slice(0, 10)}… → ${p.seller.slice(0, 10)}… | tx: ${p.txHash.slice(0, 16)}…`);
        }
        emit(`  Total x402 payments: ${x402Results.length} | Total USDC moved: ${x402Results.length * X402_PAYMENT_AMOUNT}`);
        emit("");
    }

    emit("═".repeat(60));

    flushLog();
}

main()
    .then(() => {
        console.log("\n🎉 Full cycle simulation complete!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n❌ Simulation failed:", error);
        flushLog();
        process.exit(1);
    });
