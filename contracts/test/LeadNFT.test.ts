import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { LeadNFTv2 } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("LeadNFTv2", function () {
    let leadNFT: LeadNFTv2;
    let owner: SignerWithAddress;
    let seller: SignerWithAddress;
    let buyer: SignerWithAddress;
    let minter: SignerWithAddress;

    // Test data
    const platformLeadId = ethers.keccak256(ethers.toUtf8Bytes("lead_123"));
    const vertical = ethers.keccak256(ethers.toUtf8Bytes("solar"));
    const geoHash = ethers.keccak256(ethers.toUtf8Bytes("9q8yy"));  // SF area
    const piiHash = ethers.keccak256(ethers.toUtf8Bytes("hashed_pii_data"));
    const reservePrice = ethers.parseUnits("50", 6);  // 50 USDC
    const uri = "ipfs://QmTest123";

    beforeEach(async function () {
        [owner, seller, buyer, minter] = await ethers.getSigners();

        const LeadNFTv2Factory = await ethers.getContractFactory("LeadNFTv2");
        leadNFT = await LeadNFTv2Factory.deploy(owner.address);
        await leadNFT.waitForDeployment();

        // Authorize minter
        await leadNFT.connect(owner).setAuthorizedMinter(minter.address, true);
    });

    describe("Deployment", function () {
        it("Should set correct name and symbol", async function () {
            expect(await leadNFT.name()).to.equal("Lead Engine Lead v2");
            expect(await leadNFT.symbol()).to.equal("LEADv2");
        });

        it("Should set owner correctly", async function () {
            expect(await leadNFT.owner()).to.equal(owner.address);
        });
    });

    describe("Minting", function () {
        it("Should mint a lead NFT with correct metadata", async function () {
            const expiresAt = (await time.latest()) + 86400;  // 24h from now

            const tx = await leadNFT.connect(minter).mintLead(
                seller.address,
                platformLeadId,
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                0,  // PLATFORM source
                true,  // TCPA consent
                uri
            );

            await expect(tx)
                .to.emit(leadNFT, "LeadMinted")
                .withArgs(1, platformLeadId, seller.address, vertical, 0);

            expect(await leadNFT.ownerOf(1)).to.equal(seller.address);
            expect(await leadNFT.tokenURI(1)).to.equal(uri);
        });

        it("Should revert if lead already tokenized", async function () {
            const expiresAt = (await time.latest()) + 86400;

            await leadNFT.connect(minter).mintLead(
                seller.address,
                platformLeadId,
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                0,
                true,
                uri
            );

            await expect(
                leadNFT.connect(minter).mintLead(
                    seller.address,
                    platformLeadId,  // Same ID
                    vertical,
                    geoHash,
                    piiHash,
                    reservePrice,
                    expiresAt,
                    0,
                    true,
                    uri
                )
            ).to.be.revertedWith("LeadNFTv2: Already tokenized");
        });

        it("Should revert if caller is not authorized", async function () {
            const expiresAt = (await time.latest()) + 86400;

            await expect(
                leadNFT.connect(buyer).mintLead(
                    seller.address,
                    platformLeadId,
                    vertical,
                    geoHash,
                    piiHash,
                    reservePrice,
                    expiresAt,
                    0,
                    true,
                    uri
                )
            ).to.be.revertedWith("LeadNFTv2: Not authorized");
        });

        it("Should revert if expiry is in the past", async function () {
            const pastExpiry = (await time.latest()) - 3600;  // 1h ago

            await expect(
                leadNFT.connect(minter).mintLead(
                    seller.address,
                    platformLeadId,
                    vertical,
                    geoHash,
                    piiHash,
                    reservePrice,
                    pastExpiry,
                    0,
                    true,
                    uri
                )
            ).to.be.revertedWith("LeadNFTv2: Invalid expiry");
        });
    });

    describe("Lead Metadata", function () {
        let tokenId: bigint;

        beforeEach(async function () {
            const expiresAt = (await time.latest()) + 86400;

            await leadNFT.connect(minter).mintLead(
                seller.address,
                platformLeadId,
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                0,
                true,
                uri
            );
            tokenId = 1n;
        });

        it("Should return correct lead metadata", async function () {
            const meta = await leadNFT.getLead(tokenId);

            expect(meta.vertical).to.equal(vertical);
            expect(meta.geoHash).to.equal(geoHash);
            expect(meta.piiHash).to.equal(piiHash);
            expect(meta.reservePrice).to.equal(reservePrice);
            expect(meta.seller).to.equal(seller.address);
            expect(meta.buyer).to.equal(ethers.ZeroAddress);
            expect(meta.isVerified).to.equal(false);
            expect(meta.tcpaConsent).to.equal(true);
        });

        it("Should get lead by platform ID", async function () {
            const [id, meta] = await leadNFT.getLeadByPlatformId(platformLeadId);

            expect(id).to.equal(tokenId);
            expect(meta.seller).to.equal(seller.address);
        });

        it("Should check lead validity correctly", async function () {
            expect(await leadNFT.isLeadValid(tokenId)).to.equal(true);
        });
    });

    describe("Sale Recording", function () {
        let tokenId: bigint;

        beforeEach(async function () {
            const expiresAt = (await time.latest()) + 86400;

            await leadNFT.connect(minter).mintLead(
                seller.address,
                platformLeadId,
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                0,
                true,
                uri
            );
            tokenId = 1n;
        });

        it("Should record sale correctly", async function () {
            const salePrice = ethers.parseUnits("100", 6);

            await expect(
                leadNFT.connect(minter).recordSale(tokenId, buyer.address, salePrice)
            )
                .to.emit(leadNFT, "LeadSold")
                .withArgs(tokenId, seller.address, buyer.address, salePrice);

            const meta = await leadNFT.getLead(tokenId);
            expect(meta.buyer).to.equal(buyer.address);
            expect(meta.status).to.equal(2);  // SOLD
        });
    });

    describe("Verification", function () {
        let tokenId: bigint;

        beforeEach(async function () {
            const expiresAt = (await time.latest()) + 86400;

            await leadNFT.connect(minter).mintLead(
                seller.address,
                platformLeadId,
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                0,
                true,
                uri
            );
            tokenId = 1n;
        });

        it("Should verify lead", async function () {
            await expect(leadNFT.connect(minter).verifyLead(tokenId))
                .to.emit(leadNFT, "LeadVerified")
                .withArgs(tokenId, minter.address);

            const meta = await leadNFT.getLead(tokenId);
            expect(meta.isVerified).to.equal(true);
        });
    });

    describe("Different Lead Sources", function () {
        it("Should mint leads from different sources", async function () {
            const expiresAt = (await time.latest()) + 86400;

            // PLATFORM source (0)
            await leadNFT.connect(minter).mintLead(
                seller.address,
                ethers.keccak256(ethers.toUtf8Bytes("lead_platform")),
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                0,
                true,
                uri
            );

            // API source (1)
            await leadNFT.connect(minter).mintLead(
                seller.address,
                ethers.keccak256(ethers.toUtf8Bytes("lead_api")),
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                1,
                true,
                uri
            );

            // OFFSITE source (2)
            await leadNFT.connect(minter).mintLead(
                seller.address,
                ethers.keccak256(ethers.toUtf8Bytes("lead_offsite")),
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                2,
                true,
                uri
            );

            const platformMeta = await leadNFT.getLead(1);
            const apiMeta = await leadNFT.getLead(2);
            const offsiteMeta = await leadNFT.getLead(3);

            expect(platformMeta.source).to.equal(0);
            expect(apiMeta.source).to.equal(1);
            expect(offsiteMeta.source).to.equal(2);
        });
    });
    // ============================================================
    // BUG-01: Token ID 0 Collision — Invariant Tests
    // ============================================================
    // The sentinel _platformLeadToToken[id] == 0 means "not minted".
    // Token ID 0 must NEVER be issued. _nextTokenId starts at 1 and
    // uses post-increment, so the first minted token is always 1.
    // These tests lock in that invariant as a regression guard.

    describe("Token ID Invariants (BUG-01)", function () {
        const lead1 = ethers.keccak256(ethers.toUtf8Bytes("bug01_lead_1"));
        const lead2 = ethers.keccak256(ethers.toUtf8Bytes("bug01_lead_2"));
        const lead3 = ethers.keccak256(ethers.toUtf8Bytes("bug01_lead_3"));

        async function expiresIn(seconds: number) {
            return (await time.latest()) + seconds;
        }

        async function mintOne(platformId: string, expiresAt: number) {
            return leadNFT.connect(minter).mintLead(
                seller.address,
                platformId,
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                0,      // PLATFORM source
                true,   // TCPA consent
                uri
            );
        }

        it("first lead minted gets tokenId === 1, never 0", async function () {
            const expiresAt = await expiresIn(86400);
            const tx = await mintOne(lead1, expiresAt);
            const receipt = await tx.wait();

            // Confirm via emitted event
            await expect(tx)
                .to.emit(leadNFT, "LeadMinted")
                .withArgs(1n, lead1, seller.address, vertical, 0);

            // Confirm ownership at token 1
            expect(await leadNFT.ownerOf(1n)).to.equal(seller.address);

            // Confirm token 0 was never minted (ownerOf(0) should revert)
            await expect(leadNFT.ownerOf(0n)).to.be.reverted;
        });

        it("isTokenized sentinel: unminted lead maps to 0, minted lead maps to >=1", async function () {
            const expiresAt = await expiresIn(86400);
            const unmintedId = ethers.keccak256(ethers.toUtf8Bytes("never_minted_lead"));

            // Before mint: getLeadByPlatformId should revert with "Not found"
            await expect(
                leadNFT.getLeadByPlatformId(unmintedId)
            ).to.be.revertedWith("LeadNFTv2: Not found");

            // Mint lead1
            await mintOne(lead1, expiresAt);

            // After mint: getLeadByPlatformId returns tokenId >= 1
            const [tokenId, meta] = await leadNFT.getLeadByPlatformId(lead1);
            expect(tokenId).to.equal(1n);
            expect(tokenId).to.be.greaterThan(0n);
            expect(meta.seller).to.equal(seller.address);
        });

        it("sequential mints produce sequential IDs starting from 1", async function () {
            const expiresAt = await expiresIn(86400);

            const tx1 = await mintOne(lead1, expiresAt);
            const tx2 = await mintOne(lead2, expiresAt);
            const tx3 = await mintOne(lead3, expiresAt);

            await expect(tx1).to.emit(leadNFT, "LeadMinted").withArgs(1n, lead1, seller.address, vertical, 0);
            await expect(tx2).to.emit(leadNFT, "LeadMinted").withArgs(2n, lead2, seller.address, vertical, 0);
            await expect(tx3).to.emit(leadNFT, "LeadMinted").withArgs(3n, lead3, seller.address, vertical, 0);
        });

        it("totalSupply() returns accurate minted count (not _nextTokenId counter)", async function () {
            expect(await leadNFT.totalSupply()).to.equal(0n); // nothing minted yet

            const expiresAt = await expiresIn(86400);
            await mintOne(lead1, expiresAt);
            expect(await leadNFT.totalSupply()).to.equal(1n);

            await mintOne(lead2, expiresAt);
            expect(await leadNFT.totalSupply()).to.equal(2n);

            await mintOne(lead3, expiresAt);
            expect(await leadNFT.totalSupply()).to.equal(3n);
        });

        it("duplicate mint for same platformLeadId is rejected (already-tokenized guard)", async function () {
            const expiresAt = await expiresIn(86400);
            await mintOne(lead1, expiresAt);

            await expect(
                mintOne(lead1, expiresAt) // same ID again
            ).to.be.revertedWith("LeadNFTv2: Already tokenized");
        });
    });
});
