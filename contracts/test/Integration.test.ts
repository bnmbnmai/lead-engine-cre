import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Integration Tests", function () {
    let leadNFT: any;
    let marketplace: any;
    let aceCompliance: any;
    let escrow: any;
    let mockUSDC: any;

    let owner: SignerWithAddress;
    let seller: SignerWithAddress;
    let buyer: SignerWithAddress;

    const vertical = ethers.keccak256(ethers.toUtf8Bytes("solar"));
    const geoHash = ethers.keccak256(ethers.toUtf8Bytes("9q"));
    const piiHash = ethers.keccak256(ethers.toUtf8Bytes("pii"));
    const reservePrice = ethers.parseUnits("50", 6);

    beforeEach(async function () {
        [owner, seller, buyer] = await ethers.getSigners();

        // Deploy all contracts
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);

        const ACEFactory = await ethers.getContractFactory("ACECompliance");
        aceCompliance = await ACEFactory.deploy(owner.address);

        const LeadNFTFactory = await ethers.getContractFactory("LeadNFTv2");
        leadNFT = await LeadNFTFactory.deploy(owner.address, ethers.ZeroAddress);

        const EscrowFactory = await ethers.getContractFactory("RTBEscrow");
        escrow = await EscrowFactory.deploy(
            await mockUSDC.getAddress(),
            owner.address,
            250,  // 2.5% fee
            owner.address
        );

        const MarketplaceFactory = await ethers.getContractFactory("Marketplace");
        marketplace = await MarketplaceFactory.deploy(
            await leadNFT.getAddress(),
            await aceCompliance.getAddress(),
            await mockUSDC.getAddress(),
            await escrow.getAddress(),
            owner.address
        );

        // Setup permissions
        await leadNFT.setAuthorizedMinter(owner.address, true);
        await leadNFT.setMarketplace(await marketplace.getAddress());
        await aceCompliance.setAuthorizedVerifier(owner.address, true);
        await escrow.setAuthorizedCaller(await marketplace.getAddress(), true);

        // KYC users
        const kycProof = ethers.keccak256(ethers.toUtf8Bytes("kyc"));
        await aceCompliance.verifyKYC(seller.address, kycProof, "0x");
        await aceCompliance.verifyKYC(buyer.address, kycProof, "0x");
        await aceCompliance.setDefaultVerticalPolicy(vertical, true);

        // Fund buyer
        await mockUSDC.mint(buyer.address, ethers.parseUnits("10000", 6));
        await mockUSDC.connect(buyer).approve(await marketplace.getAddress(), ethers.MaxUint256);
    });

    describe("Full Lead Lifecycle", function () {
        it("Should complete full flow: mint → list → bid → resolve → transfer", async function () {
            // 1. Mint lead NFT
            const platformLeadId = ethers.keccak256(ethers.toUtf8Bytes("lead_1"));
            const expiresAt = (await time.latest()) + 86400 * 7;

            await leadNFT.mintLead(
                seller.address,
                platformLeadId,
                vertical,
                geoHash,
                piiHash,
                reservePrice,
                expiresAt,
                0,  // PLATFORM
                true,
                "ipfs://lead1"
            );

            const tokenId = 1n;
            expect(await leadNFT.ownerOf(tokenId)).to.equal(seller.address);

            // 2. Create listing
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);
            await marketplace.connect(seller).createListing(
                tokenId,
                reservePrice,
                0,     // No buy now
                3600,  // 1h auction
                900,   // 15min reveal
                true
            );

            expect(await leadNFT.ownerOf(tokenId)).to.equal(await marketplace.getAddress());

            // 3. Buyer commits bid
            const bidAmount = ethers.parseUnits("100", 6);
            const salt = ethers.encodeBytes32String("mysalt");
            const commitment = ethers.solidityPackedKeccak256(["uint96", "bytes32"], [bidAmount, salt]);

            await marketplace.connect(buyer).commitBid(1, commitment);

            // 4. Move to reveal phase and reveal
            await time.increase(3601);
            await marketplace.connect(buyer).revealBid(1, bidAmount, salt);

            // 5. Move past reveal deadline and resolve
            await time.increase(901);
            await marketplace.resolveAuction(1);

            // 6. Verify final state
            expect(await leadNFT.ownerOf(tokenId)).to.equal(buyer.address);

            const leadMeta = await leadNFT.getLead(tokenId);
            expect(leadMeta.buyer).to.equal(buyer.address);
            expect(leadMeta.status).to.equal(2);  // SOLD
        });

        it("Should handle multiple bidders correctly", async function () {
            // Setup second buyer
            const [, , , buyer2] = await ethers.getSigners();
            const kycProof = ethers.keccak256(ethers.toUtf8Bytes("kyc"));
            await aceCompliance.verifyKYC(buyer2.address, kycProof, "0x");
            await mockUSDC.mint(buyer2.address, ethers.parseUnits("10000", 6));
            await mockUSDC.connect(buyer2).approve(await marketplace.getAddress(), ethers.MaxUint256);

            // Mint and list
            const platformLeadId = ethers.keccak256(ethers.toUtf8Bytes("lead_multi"));
            const expiresAt = (await time.latest()) + 86400 * 7;
            await leadNFT.mintLead(seller.address, platformLeadId, vertical, geoHash, piiHash, reservePrice, expiresAt, 0, true, "ipfs://lead");
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), 1);
            await marketplace.connect(seller).createListing(1, reservePrice, 0, 3600, 900, true);

            // Both buyers bid
            const bid1 = ethers.parseUnits("75", 6);
            const salt1 = ethers.encodeBytes32String("salt1");
            const commit1 = ethers.solidityPackedKeccak256(["uint96", "bytes32"], [bid1, salt1]);
            await marketplace.connect(buyer).commitBid(1, commit1);

            const bid2 = ethers.parseUnits("120", 6);
            const salt2 = ethers.encodeBytes32String("salt2");
            const commit2 = ethers.solidityPackedKeccak256(["uint96", "bytes32"], [bid2, salt2]);
            await marketplace.connect(buyer2).commitBid(1, commit2);

            // Reveal phase
            await time.increase(3601);
            await marketplace.connect(buyer).revealBid(1, bid1, salt1);
            await marketplace.connect(buyer2).revealBid(1, bid2, salt2);

            // Resolve
            await time.increase(901);
            const tx = await marketplace.resolveAuction(1);

            // buyer2 should win with higher bid
            await expect(tx).to.emit(marketplace, "AuctionResolved").withArgs(1, buyer2.address, bid2);
            expect(await leadNFT.ownerOf(1)).to.equal(buyer2.address);
        });
    });

    describe("Compliance Integration", function () {
        it("Should block transaction if buyer fails compliance", async function () {
            // Blacklist buyer
            await aceCompliance.blacklistUser(buyer.address, ethers.keccak256(ethers.toUtf8Bytes("fraud")));

            // Mint and list
            const platformLeadId = ethers.keccak256(ethers.toUtf8Bytes("lead_blocked"));
            const expiresAt = (await time.latest()) + 86400 * 7;
            await leadNFT.mintLead(seller.address, platformLeadId, vertical, geoHash, piiHash, reservePrice, expiresAt, 0, true, "ipfs://lead");
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), 1);
            await marketplace.connect(seller).createListing(1, reservePrice, 0, 3600, 900, true);

            // Try to bid
            const commitment = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [ethers.parseUnits("100", 6), ethers.encodeBytes32String("salt")]
            );

            await expect(
                marketplace.connect(buyer).commitBid(1, commitment)
            ).to.be.revertedWith("Compliance check failed");
        });
    });

    describe("Edge Cases", function () {
        it("Should handle expired lead gracefully", async function () {
            const platformLeadId = ethers.keccak256(ethers.toUtf8Bytes("lead_expire"));
            const expiresAt = (await time.latest()) + 3600;  // 1 hour

            await leadNFT.mintLead(seller.address, platformLeadId, vertical, geoHash, piiHash, reservePrice, expiresAt, 0, true, "ipfs://lead");

            // Verify lead is valid
            expect(await leadNFT.isLeadValid(1)).to.equal(true);

            // Move past expiry
            await time.increase(3601);

            // Lead should now be invalid
            expect(await leadNFT.isLeadValid(1)).to.equal(false);
        });
    });
});
