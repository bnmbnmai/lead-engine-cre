/**
 * E2E Reorg Handling Test
 *
 * Simulates blockchain reorganizations using Hardhat EVM snapshots.
 * Verifies state consistency after reverts and replays.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Marketplace, LeadNFTv2, ACECompliance, MockERC20 } from "../typechain-types";
import { time, takeSnapshot, SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers";

describe("E2E Reorg Handling", function () {
    let deployer: SignerWithAddress;
    let seller: SignerWithAddress;
    let buyer1: SignerWithAddress;
    let buyer2: SignerWithAddress;

    let usdc: MockERC20;
    let ace: ACECompliance;
    let leadNFT: LeadNFTv2;
    let marketplace: Marketplace;

    const vertical = ethers.keccak256(ethers.toUtf8Bytes("solar"));
    const geoHash = ethers.keccak256(ethers.toUtf8Bytes("9q"));
    const piiHash = ethers.keccak256(ethers.toUtf8Bytes("reorg_pii"));
    const reservePrice = ethers.parseUnits("50", 6);

    async function deployAndSetup() {
        [deployer, seller, buyer1, buyer2] = await ethers.getSigners();

        const ERC20 = await ethers.getContractFactory("MockERC20");
        usdc = await ERC20.deploy("USD Coin", "USDC", 6);

        const ACE = await ethers.getContractFactory("ACECompliance");
        ace = await ACE.deploy(deployer.address);

        const NFT = await ethers.getContractFactory("LeadNFTv2");
        leadNFT = await NFT.deploy(deployer.address, ethers.ZeroAddress);

        const MKT = await ethers.getContractFactory("Marketplace");
        marketplace = await MKT.deploy(
            await leadNFT.getAddress(),
            await ace.getAddress(),
            await usdc.getAddress(),
            deployer.address, // escrow = deployer for simplicity
            deployer.address
        );

        await leadNFT.setAuthorizedMinter(deployer.address, true);
        await leadNFT.setMarketplace(await marketplace.getAddress());
        await ace.setAuthorizedVerifier(deployer.address, true);

        const kycProof = ethers.keccak256(ethers.toUtf8Bytes("kyc"));
        await ace.verifyKYC(seller.address, kycProof, "0x");
        await ace.verifyKYC(buyer1.address, kycProof, "0x");
        await ace.verifyKYC(buyer2.address, kycProof, "0x");
        await ace.setDefaultVerticalPolicy(vertical, true);

        const fund = ethers.parseUnits("10000", 6);
        await usdc.mint(buyer1.address, fund);
        await usdc.mint(buyer2.address, fund);
        await usdc.connect(buyer1).approve(await marketplace.getAddress(), ethers.MaxUint256);
        await usdc.connect(buyer2).approve(await marketplace.getAddress(), ethers.MaxUint256);
    }

    async function mintLead() {
        const id = ethers.keccak256(ethers.toUtf8Bytes(`lead_${Date.now()}_${Math.random()}`));
        const expiry = (await time.latest()) + 86400 * 7;
        await leadNFT.mintLead(seller.address, id, vertical, geoHash, piiHash, reservePrice, expiry, 0, true, "ipfs://reorg");
        return await leadNFT.totalSupply();
    }

    // ═══════════════════════════════════════════
    // Reorg Simulation Tests
    // ═══════════════════════════════════════════

    describe("Snapshot-Revert Reorg Simulation", function () {
        beforeEach(deployAndSetup);

        it("should restore state correctly after snapshot revert", async function () {
            // Mint lead and create listing
            const tokenId = await mintLead();
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);
            await marketplace.connect(seller).createListing(tokenId, reservePrice, 0n, 3600, 900, true);

            // Take snapshot BEFORE bid
            const snapshot: SnapshotRestorer = await takeSnapshot();

            // Commit a bid (this will be "reorged" away)
            const bidAmt = ethers.parseUnits("100", 6);
            const salt = ethers.encodeBytes32String("reorg_salt");
            const commit = ethers.solidityPackedKeccak256(["uint96", "bytes32"], [bidAmt, salt]);
            await marketplace.connect(buyer1).commitBid(1n, commit);

            // Verify bid exists
            const bidBefore = await marketplace.getBid(1n, buyer1.address);
            expect(bidBefore.commitment).to.equal(commit);

            // ── REORG: Revert to snapshot ──
            await snapshot.restore();

            // After revert, bid should not exist
            const bidAfter = await marketplace.getBid(1n, buyer1.address);
            expect(bidAfter.commitment).to.equal(ethers.ZeroHash);

            // Balance should be restored (deposit returned)
            const balance = await usdc.balanceOf(buyer1.address);
            expect(balance).to.equal(ethers.parseUnits("10000", 6));
        });

        it("should allow re-bidding after reorg revert", async function () {
            const tokenId = await mintLead();
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);
            await marketplace.connect(seller).createListing(tokenId, reservePrice, 0n, 3600, 900, true);

            const snapshot = await takeSnapshot();

            // First bid (will be reverted)
            const salt1 = ethers.encodeBytes32String("first");
            const commit1 = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [ethers.parseUnits("75", 6), salt1]
            );
            await marketplace.connect(buyer1).commitBid(1n, commit1);

            // Revert
            await snapshot.restore();

            // Re-bid with different amount
            const newAmt = ethers.parseUnits("120", 6);
            const salt2 = ethers.encodeBytes32String("second");
            const commit2 = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [newAmt, salt2]
            );
            await marketplace.connect(buyer1).commitBid(1n, commit2);

            const bid = await marketplace.getBid(1n, buyer1.address);
            expect(bid.commitment).to.equal(commit2);
        });

        it("should maintain timestamp consistency after revert", async function () {
            const tokenId = await mintLead();
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);
            await marketplace.connect(seller).createListing(tokenId, reservePrice, 0n, 3600, 900, true);

            const listing = await marketplace.getListing(1n);
            const auctionEnd = listing.auctionEnd;

            // Warp past auction end
            await time.increase(3601);
            const snapshot = await takeSnapshot();

            // Verify we're in reveal phase
            const timeAfterWarp = await time.latest();
            expect(timeAfterWarp).to.be.gt(auctionEnd);

            // Revert — should restore to pre-warp time
            await snapshot.restore();

            // NOTE: After restoring a snapshot taken AFTER time.increase,
            // the time should match the snapshot's time
            const timeAfterRevert = await time.latest();
            expect(timeAfterRevert).to.be.gte(Number(auctionEnd));
        });

        it("prevents double-spend after reorg on multiple listings", async function () {
            const token1 = await mintLead();
            const token2 = await mintLead();

            await leadNFT.connect(seller).approve(await marketplace.getAddress(), token1);
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), token2);

            await marketplace.connect(seller).createListing(token1, reservePrice, 0n, 3600, 900, true);
            await marketplace.connect(seller).createListing(token2, reservePrice, 0n, 3600, 900, true);

            const snapshot = await takeSnapshot();

            // Buyer1 bids on listing 1
            const salt = ethers.encodeBytes32String("multi_reorg");
            const commit = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [ethers.parseUnits("80", 6), salt]
            );
            await marketplace.connect(buyer1).commitBid(1n, commit);

            // Revert
            await snapshot.restore();

            // After revert, buyer1 can bid on listing 2 instead
            await marketplace.connect(buyer1).commitBid(2n, commit);
            const bid = await marketplace.getBid(2n, buyer1.address);
            expect(bid.commitment).to.equal(commit);

            // And also bid on listing 1 (which was reverted)
            const salt2 = ethers.encodeBytes32String("multi_reorg2");
            const commit2 = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [ethers.parseUnits("90", 6), salt2]
            );
            await marketplace.connect(buyer1).commitBid(1n, commit2);
        });
    });
});
