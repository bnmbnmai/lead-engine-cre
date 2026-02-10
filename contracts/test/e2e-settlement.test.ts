/**
 * E2E Settlement Test — Full On-Chain Lifecycle
 *
 * Exercises the complete flow with 5 wallets:
 *   deployer · seller · buyer1 · buyer2 · feeRecipient
 *
 * Flow:
 *   1. Deploy stack (MockERC20 → ACE → LeadNFTv2 → RTBEscrow → Marketplace)
 *   2. Seller mints lead NFT → lists on Marketplace
 *   3. Two buyers commit sealed bids → reveal → auction resolved
 *   4. RTBEscrow: winner funds → release after delay → balance assertions
 *   5. Dispute path: new escrow → fund → dispute → refund
 *   6. Buy-now instant settlement path
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
    Marketplace,
    LeadNFTv2,
    ACECompliance,
    RTBEscrow,
    MockERC20,
} from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("E2E Settlement — Full Lifecycle", function () {
    // ─── Wallets ───────────────────────────────
    let deployer: SignerWithAddress;
    let seller: SignerWithAddress;
    let buyer1: SignerWithAddress;
    let buyer2: SignerWithAddress;
    let feeRecipient: SignerWithAddress;

    // ─── Contracts ─────────────────────────────
    let usdc: MockERC20;
    let ace: ACECompliance;
    let leadNFT: LeadNFTv2;
    let escrow: RTBEscrow;
    let marketplace: Marketplace;

    // ─── Constants ─────────────────────────────
    const vertical = ethers.keccak256(ethers.toUtf8Bytes("solar"));
    const geoHash = ethers.keccak256(ethers.toUtf8Bytes("9q")); // CA
    const piiHash = ethers.keccak256(ethers.toUtf8Bytes("e2e_pii"));
    const reservePrice = ethers.parseUnits("50", 6); // 50 USDC
    const buyNowPrice = ethers.parseUnits("200", 6);
    const platformFeeBps = 250n; // 2.5 %
    const DEPOSIT_BPS = 1000n; // 10 %

    // ─── Helpers ───────────────────────────────

    async function deployStack() {
        [deployer, seller, buyer1, buyer2, feeRecipient] =
            await ethers.getSigners();

        // 1. MockUSDC
        const ERC20 = await ethers.getContractFactory("MockERC20");
        usdc = await ERC20.deploy("USD Coin", "USDC", 6);
        await usdc.waitForDeployment();

        // 2. ACE Compliance
        const ACE = await ethers.getContractFactory("ACECompliance");
        ace = await ACE.deploy(deployer.address);
        await ace.waitForDeployment();

        // 3. LeadNFTv2
        const NFT = await ethers.getContractFactory("LeadNFTv2");
        leadNFT = await NFT.deploy(deployer.address);
        await leadNFT.waitForDeployment();

        // 4. RTBEscrow
        const Escrow = await ethers.getContractFactory("RTBEscrow");
        escrow = await Escrow.deploy(
            await usdc.getAddress(),
            feeRecipient.address,
            platformFeeBps,
            deployer.address
        );
        await escrow.waitForDeployment();

        // 5. Marketplace
        const MKT = await ethers.getContractFactory("Marketplace");
        marketplace = await MKT.deploy(
            await leadNFT.getAddress(),
            await ace.getAddress(),
            await usdc.getAddress(),
            await escrow.getAddress(),
            deployer.address
        );
        await marketplace.waitForDeployment();

        // ── Permissions ────
        await leadNFT.setAuthorizedMinter(deployer.address, true);
        await leadNFT.setMarketplace(await marketplace.getAddress());
        await ace.setAuthorizedVerifier(deployer.address, true);
        await escrow.setAuthorizedCaller(deployer.address, true);

        // ── KYC every participant ────
        const kycProof = ethers.keccak256(ethers.toUtf8Bytes("kyc"));
        await ace.verifyKYC(seller.address, kycProof, "0x");
        await ace.verifyKYC(buyer1.address, kycProof, "0x");
        await ace.verifyKYC(buyer2.address, kycProof, "0x");
        await ace.setDefaultVerticalPolicy(vertical, true);

        // ── Fund buyers ────
        const buyerFund = ethers.parseUnits("10000", 6);
        await usdc.mint(buyer1.address, buyerFund);
        await usdc.mint(buyer2.address, buyerFund);
        await usdc
            .connect(buyer1)
            .approve(await marketplace.getAddress(), ethers.MaxUint256);
        await usdc
            .connect(buyer2)
            .approve(await marketplace.getAddress(), ethers.MaxUint256);
    }

    async function mintLeadTo(to: SignerWithAddress) {
        const platformId = ethers.keccak256(
            ethers.toUtf8Bytes(`lead_${Date.now()}_${Math.random()}`)
        );
        const expiry = (await time.latest()) + 86400 * 7;

        await leadNFT.mintLead(
            to.address,
            platformId,
            vertical,
            geoHash,
            piiHash,
            reservePrice,
            expiry,
            0, // PLATFORM source
            true, // TCPA consent
            "ipfs://e2e-test"
        );
        return await leadNFT.totalSupply();
    }

    // ═══════════════════════════════════════════
    // Test Suite 1: Full Auction → Escrow Settlement
    // ═══════════════════════════════════════════

    describe("Full Auction → Escrow Settlement", function () {
        beforeEach(deployStack);

        it("completes the full 6-step lifecycle", async function () {
            // ── Step 1: Mint Lead NFT ──
            const tokenId = await mintLeadTo(seller);
            expect(await leadNFT.ownerOf(tokenId)).to.equal(seller.address);

            // ── Step 2: Seller lists on marketplace ──
            await leadNFT
                .connect(seller)
                .approve(await marketplace.getAddress(), tokenId);
            await marketplace
                .connect(seller)
                .createListing(
                    tokenId,
                    reservePrice,
                    0n,
                    3600,
                    900,
                    true
                );
            const listingId = 1n;

            // NFT now held by marketplace
            expect(await leadNFT.ownerOf(tokenId)).to.equal(
                await marketplace.getAddress()
            );

            // ── Step 3: Two buyers commit sealed bids ──
            const bid1Amt = ethers.parseUnits("100", 6);
            const salt1 = ethers.encodeBytes32String("buyer1_salt");
            const commit1 = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [bid1Amt, salt1]
            );

            const bid2Amt = ethers.parseUnits("150", 6);
            const salt2 = ethers.encodeBytes32String("buyer2_salt");
            const commit2 = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [bid2Amt, salt2]
            );

            // Record pre-bid balances (deposit = reserve * 10%)
            const deposit = (reservePrice * DEPOSIT_BPS) / 10000n;
            const b1BalBefore = await usdc.balanceOf(buyer1.address);
            const b2BalBefore = await usdc.balanceOf(buyer2.address);

            await marketplace.connect(buyer1).commitBid(listingId, commit1);
            await marketplace.connect(buyer2).commitBid(listingId, commit2);

            // Each buyer paid a 10% deposit
            expect(await usdc.balanceOf(buyer1.address)).to.equal(
                b1BalBefore - deposit
            );
            expect(await usdc.balanceOf(buyer2.address)).to.equal(
                b2BalBefore - deposit
            );

            // ── Step 4: Time-warp to reveal window ──
            await time.increase(3601);

            await marketplace
                .connect(buyer1)
                .revealBid(listingId, bid1Amt, salt1);
            await marketplace
                .connect(buyer2)
                .revealBid(listingId, bid2Amt, salt2);

            // ── Step 5: Resolve auction ──
            await time.increase(901); // past reveal deadline

            // Approve buyer2 for remaining payment
            await usdc
                .connect(buyer2)
                .approve(await marketplace.getAddress(), ethers.MaxUint256);

            const tx = await marketplace.resolveAuction(listingId);
            await expect(tx)
                .to.emit(marketplace, "AuctionResolved")
                .withArgs(listingId, buyer2.address, bid2Amt);

            // NFT transferred to winner
            expect(await leadNFT.ownerOf(tokenId)).to.equal(buyer2.address);

            // Loser's bid status should be REJECTED (can withdraw deposit)
            const loserBid = await marketplace.getBid(
                listingId,
                buyer1.address
            );
            expect(loserBid.status).to.equal(4); // REJECTED

            // ── Step 6: RTBEscrow settlement ──
            // escrowContract received the full winning bid amount
            const escrowBal = await usdc.balanceOf(await escrow.getAddress());
            expect(escrowBal).to.equal(bid2Amt);

            // Create escrow record for the settlement
            const escrowTx = await escrow.createEscrow(
                "lead-e2e-1",
                seller.address,
                buyer2.address,
                bid2Amt
            );
            await expect(escrowTx).to.emit(escrow, "EscrowCreated");

            // Fund the escrow (buyer deposits)
            await usdc.mint(buyer2.address, bid2Amt); // mint fresh for escrow funding
            await usdc
                .connect(buyer2)
                .approve(await escrow.getAddress(), bid2Amt);
            await escrow.connect(buyer2).fundEscrow(1);

            // Time-warp past release delay (24h)
            await time.increase(86401);

            // Release funds to seller
            const sellerBalBefore = await usdc.balanceOf(seller.address);
            const feeRecBefore = await usdc.balanceOf(feeRecipient.address);

            await escrow.releaseEscrow(1);

            const expectedFee = (bid2Amt * platformFeeBps) / 10000n;
            const sellerExpected = bid2Amt - expectedFee;

            expect(await usdc.balanceOf(seller.address)).to.equal(
                sellerBalBefore + sellerExpected
            );
            expect(await usdc.balanceOf(feeRecipient.address)).to.equal(
                feeRecBefore + expectedFee
            );
        });

        it("handles losing bidder deposit withdrawal", async function () {
            const tokenId = await mintLeadTo(seller);
            await leadNFT
                .connect(seller)
                .approve(await marketplace.getAddress(), tokenId);
            await marketplace
                .connect(seller)
                .createListing(tokenId, reservePrice, 0n, 3600, 900, true);

            const bid1Amt = ethers.parseUnits("100", 6);
            const salt1 = ethers.encodeBytes32String("s1");
            const commit1 = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [bid1Amt, salt1]
            );
            const bid2Amt = ethers.parseUnits("200", 6);
            const salt2 = ethers.encodeBytes32String("s2");
            const commit2 = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [bid2Amt, salt2]
            );

            await marketplace.connect(buyer1).commitBid(1n, commit1);
            await marketplace.connect(buyer2).commitBid(1n, commit2);

            await time.increase(3601);
            await marketplace.connect(buyer1).revealBid(1n, bid1Amt, salt1);
            await marketplace.connect(buyer2).revealBid(1n, bid2Amt, salt2);

            await time.increase(901);
            await marketplace.resolveAuction(1n);

            // Buyer1 lost — withdraw deposit
            const deposit = (reservePrice * DEPOSIT_BPS) / 10000n;
            const balBefore = await usdc.balanceOf(buyer1.address);

            await marketplace.connect(buyer1).withdrawBid(1n);

            expect(await usdc.balanceOf(buyer1.address)).to.equal(
                balBefore + deposit
            );
        });
    });

    // ═══════════════════════════════════════════
    // Test Suite 2: RTBEscrow Dispute → Refund
    // ═══════════════════════════════════════════

    describe("RTBEscrow Dispute → Refund", function () {
        beforeEach(deployStack);

        it("processes dispute and refunds buyer", async function () {
            const amount = ethers.parseUnits("100", 6);

            // Create and fund escrow
            await escrow.createEscrow(
                "disputed-lead",
                seller.address,
                buyer1.address,
                amount
            );
            await usdc.mint(buyer1.address, amount);
            await usdc
                .connect(buyer1)
                .approve(await escrow.getAddress(), amount);
            await escrow.connect(buyer1).fundEscrow(1);

            // Buyer disputes
            await escrow.connect(buyer1).disputeEscrow(1);

            const escrowData = await escrow.getEscrow(1);
            expect(escrowData.state).to.equal(3); // Disputed

            // Admin refunds
            const buyerBalBefore = await usdc.balanceOf(buyer1.address);
            await escrow.refundEscrow(1);

            expect(await usdc.balanceOf(buyer1.address)).to.equal(
                buyerBalBefore + amount
            );
        });

        it("prevents double-release after dispute", async function () {
            const amount = ethers.parseUnits("75", 6);
            await escrow.createEscrow(
                "double-release",
                seller.address,
                buyer1.address,
                amount
            );
            await usdc.mint(buyer1.address, amount);
            await usdc
                .connect(buyer1)
                .approve(await escrow.getAddress(), amount);
            await escrow.connect(buyer1).fundEscrow(1);

            await escrow.connect(buyer1).disputeEscrow(1);
            await escrow.refundEscrow(1);

            // Cannot release a refunded escrow
            await expect(escrow.releaseEscrow(1)).to.be.revertedWith(
                "Not funded"
            );
        });

        it("seller can also initiate dispute", async function () {
            const amount = ethers.parseUnits("60", 6);
            await escrow.createEscrow(
                "seller-dispute",
                seller.address,
                buyer1.address,
                amount
            );
            await usdc.mint(buyer1.address, amount);
            await usdc
                .connect(buyer1)
                .approve(await escrow.getAddress(), amount);
            await escrow.connect(buyer1).fundEscrow(1);

            await expect(escrow.connect(seller).disputeEscrow(1))
                .to.emit(escrow, "EscrowDisputed")
                .withArgs(1, seller.address);
        });
    });

    // ═══════════════════════════════════════════
    // Test Suite 3: Buy-Now Instant Settlement
    // ═══════════════════════════════════════════

    describe("Buy-Now Instant Settlement", function () {
        beforeEach(deployStack);

        it("transfers NFT and payment atomically on buyNow", async function () {
            const tokenId = await mintLeadTo(seller);
            await leadNFT
                .connect(seller)
                .approve(await marketplace.getAddress(), tokenId);
            await marketplace
                .connect(seller)
                .createListing(
                    tokenId,
                    reservePrice,
                    buyNowPrice,
                    3600,
                    900,
                    true
                );

            const escrowAddr = await escrow.getAddress();
            const escrowBalBefore = await usdc.balanceOf(escrowAddr);
            const buyerBalBefore = await usdc.balanceOf(buyer1.address);

            await marketplace.connect(buyer1).buyNow(1);

            // NFT goes to buyer
            expect(await leadNFT.ownerOf(tokenId)).to.equal(buyer1.address);

            // USDC goes to escrow
            expect(await usdc.balanceOf(escrowAddr)).to.equal(
                escrowBalBefore + buyNowPrice
            );

            // Buyer balance decreased
            expect(await usdc.balanceOf(buyer1.address)).to.equal(
                buyerBalBefore - buyNowPrice
            );
        });
    });

    // ═══════════════════════════════════════════
    // Test Suite 4: Multi-Lead Parallel Auctions
    // ═══════════════════════════════════════════

    describe("Multi-Lead Parallel Auctions", function () {
        beforeEach(deployStack);

        it("resolves two simultaneous auctions independently", async function () {
            // Mint two leads
            const token1 = await mintLeadTo(seller);
            const token2 = await mintLeadTo(seller);

            await leadNFT
                .connect(seller)
                .approve(await marketplace.getAddress(), token1);
            await leadNFT
                .connect(seller)
                .approve(await marketplace.getAddress(), token2);

            // List both
            await marketplace
                .connect(seller)
                .createListing(token1, reservePrice, 0n, 3600, 900, true);
            await marketplace
                .connect(seller)
                .createListing(token2, reservePrice, 0n, 3600, 900, true);

            // Buyer1 bids on listing 1, Buyer2 bids on listing 2
            const amt1 = ethers.parseUnits("80", 6);
            const salt1 = ethers.encodeBytes32String("p1");
            const c1 = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [amt1, salt1]
            );

            const amt2 = ethers.parseUnits("120", 6);
            const salt2 = ethers.encodeBytes32String("p2");
            const c2 = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [amt2, salt2]
            );

            await marketplace.connect(buyer1).commitBid(1n, c1);
            await marketplace.connect(buyer2).commitBid(2n, c2);

            await time.increase(3601);
            await marketplace.connect(buyer1).revealBid(1n, amt1, salt1);
            await marketplace.connect(buyer2).revealBid(2n, amt2, salt2);

            await time.increase(901);

            // Resolve independently
            await expect(marketplace.resolveAuction(1n))
                .to.emit(marketplace, "AuctionResolved")
                .withArgs(1n, buyer1.address, amt1);
            await expect(marketplace.resolveAuction(2n))
                .to.emit(marketplace, "AuctionResolved")
                .withArgs(2n, buyer2.address, amt2);

            expect(await leadNFT.ownerOf(token1)).to.equal(buyer1.address);
            expect(await leadNFT.ownerOf(token2)).to.equal(buyer2.address);
        });
    });

    // ═══════════════════════════════════════════
    // Test Suite 5: Gas Benchmarks
    // ═══════════════════════════════════════════

    describe("Gas Benchmarks", function () {
        beforeEach(deployStack);

        it("reports gas costs for each step", async function () {
            // Mint
            const mintTx = await leadNFT.mintLead(
                seller.address,
                ethers.keccak256(ethers.toUtf8Bytes("gas_bench")),
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                (await time.latest()) + 86400 * 7,
                0,
                true,
                "ipfs://gas"
            );
            const mintReceipt = await mintTx.wait();
            console.log("    ⛽ mintLead gas:", mintReceipt!.gasUsed.toString());

            const tokenId = await leadNFT.totalSupply();
            await leadNFT
                .connect(seller)
                .approve(await marketplace.getAddress(), tokenId);

            // List
            const listTx = await marketplace
                .connect(seller)
                .createListing(tokenId, reservePrice, buyNowPrice, 3600, 900, true);
            const listReceipt = await listTx.wait();
            console.log("    ⛽ createListing gas:", listReceipt!.gasUsed.toString());

            // Commit
            const bidAmt = ethers.parseUnits("100", 6);
            const salt = ethers.encodeBytes32String("gas_salt");
            const commit = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [bidAmt, salt]
            );
            const commitTx = await marketplace
                .connect(buyer1)
                .commitBid(1n, commit);
            const commitReceipt = await commitTx.wait();
            console.log("    ⛽ commitBid gas:", commitReceipt!.gasUsed.toString());

            // Reveal
            await time.increase(3601);
            const revealTx = await marketplace
                .connect(buyer1)
                .revealBid(1n, bidAmt, salt);
            const revealReceipt = await revealTx.wait();
            console.log("    ⛽ revealBid gas:", revealReceipt!.gasUsed.toString());

            // Resolve
            await time.increase(901);
            const resolveTx = await marketplace.resolveAuction(1n);
            const resolveReceipt = await resolveTx.wait();
            console.log(
                "    ⛽ resolveAuction gas:",
                resolveReceipt!.gasUsed.toString()
            );
        });
    });
});
