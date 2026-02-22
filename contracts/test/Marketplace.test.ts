import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Marketplace, LeadNFTv2, ACECompliance } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Marketplace", function () {
    let marketplace: Marketplace;
    let leadNFT: LeadNFTv2;
    let aceCompliance: ACECompliance;
    let mockUSDC: any;
    let owner: SignerWithAddress;
    let seller: SignerWithAddress;
    let buyer1: SignerWithAddress;
    let buyer2: SignerWithAddress;

    // Test data
    const vertical = ethers.keccak256(ethers.toUtf8Bytes("solar"));
    const geoHashCA = ethers.keccak256(ethers.toUtf8Bytes("9q"));  // California
    const geoHashTX = ethers.keccak256(ethers.toUtf8Bytes("9v"));  // Texas
    const piiHash = ethers.keccak256(ethers.toUtf8Bytes("pii"));
    const reservePrice = ethers.parseUnits("50", 6);
    const buyNowPrice = ethers.parseUnits("200", 6);

    async function mintTestLead(
        to: SignerWithAddress,
        geoHash: string = geoHashCA,
        source: number = 0
    ) {
        const platformLeadId = ethers.keccak256(
            ethers.toUtf8Bytes(`lead_${Date.now()}_${Math.random()}`)
        );
        const expiresAt = (await time.latest()) + 86400 * 7;

        await leadNFT.mintLead(
            to.address,
            platformLeadId,
            vertical,
            geoHash,
            piiHash,
            reservePrice,
            expiresAt,
            source,
            true,
            "ipfs://test"
        );

        return await leadNFT.totalSupply();
    }

    beforeEach(async function () {
        [owner, seller, buyer1, buyer2] = await ethers.getSigners();

        // Deploy mock USDC
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);
        await mockUSDC.waitForDeployment();

        // Deploy ACE Compliance
        const ACEFactory = await ethers.getContractFactory("ACECompliance");
        aceCompliance = await ACEFactory.deploy(owner.address);
        await aceCompliance.waitForDeployment();

        // Deploy LeadNFTv2
        const LeadNFTFactory = await ethers.getContractFactory("LeadNFTv2");
        leadNFT = await LeadNFTFactory.deploy(owner.address, ethers.ZeroAddress);
        await leadNFT.waitForDeployment();

        // Deploy Marketplace
        const MarketplaceFactory = await ethers.getContractFactory("Marketplace");
        marketplace = await MarketplaceFactory.deploy(
            await leadNFT.getAddress(),
            await aceCompliance.getAddress(),
            await mockUSDC.getAddress(),
            owner.address,  // escrow for simplicity
            owner.address
        );
        await marketplace.waitForDeployment();

        // Setup permissions
        await leadNFT.setAuthorizedMinter(owner.address, true);
        await leadNFT.setMarketplace(await marketplace.getAddress());
        await aceCompliance.setAuthorizedVerifier(owner.address, true);

        // Setup KYC for users
        const kycProof = ethers.keccak256(ethers.toUtf8Bytes("kyc_proof"));
        await aceCompliance.verifyKYC(seller.address, kycProof, "0x");
        await aceCompliance.verifyKYC(buyer1.address, kycProof, "0x");
        await aceCompliance.verifyKYC(buyer2.address, kycProof, "0x");

        // Set default vertical policy
        await aceCompliance.setDefaultVerticalPolicy(vertical, true);

        // Mint USDC to buyers
        await mockUSDC.mint(buyer1.address, ethers.parseUnits("10000", 6));
        await mockUSDC.mint(buyer2.address, ethers.parseUnits("10000", 6));
        await mockUSDC.connect(buyer1).approve(await marketplace.getAddress(), ethers.MaxUint256);
        await mockUSDC.connect(buyer2).approve(await marketplace.getAddress(), ethers.MaxUint256);
    });

    describe("Listing Creation", function () {
        it("Should create a listing successfully", async function () {
            const tokenId = await mintTestLead(seller);
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);

            const tx = await marketplace.connect(seller).createListing(
                tokenId,
                reservePrice,
                buyNowPrice,
                3600,  // 1 hour auction
                900,   // 15 min reveal
                true   // accept offsite
            );

            await expect(tx).to.emit(marketplace, "ListingCreated");

            const listing = await marketplace.getListing(1);
            expect(listing.seller).to.equal(seller.address);
            expect(listing.reservePrice).to.equal(reservePrice);
        });

        it("Should revert if not token owner", async function () {
            const tokenId = await mintTestLead(seller);
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);

            await expect(
                marketplace.connect(buyer1).createListing(
                    tokenId,
                    reservePrice,
                    buyNowPrice,
                    3600,
                    900,
                    true
                )
            ).to.be.revertedWith("Marketplace: Not owner");
        });
    });

    describe("Commit-Reveal Bidding", function () {
        let listingId: bigint;
        let tokenId: bigint;

        beforeEach(async function () {
            tokenId = await mintTestLead(seller);
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);

            await marketplace.connect(seller).createListing(
                tokenId,
                reservePrice,
                0,     // No buy now
                3600,  // 1 hour auction
                900,   // 15 min reveal
                true
            );
            listingId = 1n;
        });

        it("Should commit a bid", async function () {
            const bidAmount = ethers.parseUnits("100", 6);
            const salt = ethers.randomBytes(32);
            const commitment = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [bidAmount, salt]
            );

            await expect(marketplace.connect(buyer1).commitBid(listingId, commitment))
                .to.emit(marketplace, "BidCommitted")
                .withArgs(listingId, buyer1.address, commitment);
        });

        it("Should reveal a bid correctly", async function () {
            const bidAmount = ethers.parseUnits("100", 6);
            const salt = ethers.encodeBytes32String("secret_salt");
            const commitment = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [bidAmount, salt]
            );

            // Commit
            await marketplace.connect(buyer1).commitBid(listingId, commitment);

            // Move to reveal phase
            await time.increase(3601);

            // Reveal
            await expect(marketplace.connect(buyer1).revealBid(listingId, bidAmount, salt))
                .to.emit(marketplace, "BidRevealed")
                .withArgs(listingId, buyer1.address, bidAmount);
        });

        it("Should reject invalid reveal", async function () {
            const bidAmount = ethers.parseUnits("100", 6);
            const salt = ethers.encodeBytes32String("secret_salt");
            const wrongSalt = ethers.encodeBytes32String("wrong_salt");
            const commitment = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [bidAmount, salt]
            );

            await marketplace.connect(buyer1).commitBid(listingId, commitment);
            await time.increase(3601);

            await expect(
                marketplace.connect(buyer1).revealBid(listingId, bidAmount, wrongSalt)
            ).to.be.revertedWith("Marketplace: Invalid reveal");
        });

        it("Should resolve auction with highest bidder winning", async function () {
            // Buyer 1 bids 100
            const bid1Amount = ethers.parseUnits("100", 6);
            const salt1 = ethers.encodeBytes32String("salt1");
            const commit1 = ethers.solidityPackedKeccak256(["uint96", "bytes32"], [bid1Amount, salt1]);
            await marketplace.connect(buyer1).commitBid(listingId, commit1);

            // Buyer 2 bids 150
            const bid2Amount = ethers.parseUnits("150", 6);
            const salt2 = ethers.encodeBytes32String("salt2");
            const commit2 = ethers.solidityPackedKeccak256(["uint96", "bytes32"], [bid2Amount, salt2]);
            await marketplace.connect(buyer2).commitBid(listingId, commit2);

            // Move to reveal phase
            await time.increase(3601);

            // Reveal both
            await marketplace.connect(buyer1).revealBid(listingId, bid1Amount, salt1);
            await marketplace.connect(buyer2).revealBid(listingId, bid2Amount, salt2);

            // Move past reveal deadline
            await time.increase(901);

            // Resolve
            await expect(marketplace.resolveAuction(listingId))
                .to.emit(marketplace, "AuctionResolved")
                .withArgs(listingId, buyer2.address, bid2Amount);

            // Verify NFT transferred to winner
            expect(await leadNFT.ownerOf(tokenId)).to.equal(buyer2.address);
        });
    });

    describe("Buyer Preference Filters", function () {
        let listingId: bigint;

        beforeEach(async function () {
            const tokenId = await mintTestLead(seller, geoHashCA, 2);  // OFFSITE source
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);

            await marketplace.connect(seller).createListing(
                tokenId,
                reservePrice,
                0,
                3600,
                900,
                true  // Seller accepts offsite
            );
            listingId = 1n;
        });

        it("Should reject bid if buyer has offsite toggle disabled", async function () {
            // Set buyer prefs to reject offsite
            await marketplace.connect(buyer1).setBuyerPreferences({
                allowedVerticals: [],
                allowedGeos: [],
                blockedGeos: [],
                maxBidAmount: ethers.parseUnits("1000", 6),
                acceptOffsite: false,  // Reject offsite
                requireVerified: false
            });

            const commitment = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [ethers.parseUnits("100", 6), ethers.encodeBytes32String("salt")]
            );

            await expect(
                marketplace.connect(buyer1).commitBid(listingId, commitment)
            ).to.be.revertedWith("Buyer rejects off-site leads");
        });

        it("Should reject bid if geo is blocked", async function () {
            await marketplace.connect(buyer1).setBuyerPreferences({
                allowedVerticals: [],
                allowedGeos: [],
                blockedGeos: [geoHashCA],  // Block California
                maxBidAmount: ethers.parseUnits("1000", 6),
                acceptOffsite: true,
                requireVerified: false
            });

            const commitment = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [ethers.parseUnits("100", 6), ethers.encodeBytes32String("salt")]
            );

            await expect(
                marketplace.connect(buyer1).commitBid(listingId, commitment)
            ).to.be.revertedWith("Geo blocked");
        });

        it("Should allow bid if buyer accepts all", async function () {
            await marketplace.connect(buyer1).setBuyerPreferences({
                allowedVerticals: [],
                allowedGeos: [],
                blockedGeos: [],
                maxBidAmount: ethers.parseUnits("1000", 6),
                acceptOffsite: true,
                requireVerified: false
            });

            const commitment = ethers.solidityPackedKeccak256(
                ["uint96", "bytes32"],
                [ethers.parseUnits("100", 6), ethers.encodeBytes32String("salt")]
            );

            await expect(marketplace.connect(buyer1).commitBid(listingId, commitment))
                .to.emit(marketplace, "BidCommitted");
        });
    });

    describe("Buy Now", function () {
        it("Should execute buy now correctly", async function () {
            const tokenId = await mintTestLead(seller);
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);

            await marketplace.connect(seller).createListing(
                tokenId,
                reservePrice,
                buyNowPrice,
                3600,
                900,
                true
            );

            await expect(marketplace.connect(buyer1).buyNow(1))
                .to.emit(marketplace, "BuyNowExecuted")
                .withArgs(1, buyer1.address, buyNowPrice);

            expect(await leadNFT.ownerOf(tokenId)).to.equal(buyer1.address);
        });
    });

    describe("Edge Cases", function () {
        it("Should handle no valid bids in auction", async function () {
            const tokenId = await mintTestLead(seller);
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);

            await marketplace.connect(seller).createListing(
                tokenId,
                reservePrice,
                0,
                3600,
                900,
                true
            );

            // No bids placed, just let auction expire
            await time.increase(3601 + 901);

            // Resolve should return NFT to seller
            await marketplace.resolveAuction(1);

            expect(await leadNFT.ownerOf(tokenId)).to.equal(seller.address);

            const listing = await marketplace.getListing(1);
            expect(listing.status).to.equal(4);  // EXPIRED
        });

        it("Should reject bids below reserve price on reveal", async function () {
            const tokenId = await mintTestLead(seller);
            await leadNFT.connect(seller).approve(await marketplace.getAddress(), tokenId);

            await marketplace.connect(seller).createListing(
                tokenId,
                reservePrice,
                0,
                3600,
                900,
                true
            );

            const lowBid = ethers.parseUnits("10", 6);  // Below reserve
            const salt = ethers.encodeBytes32String("salt");
            const commitment = ethers.solidityPackedKeccak256(["uint96", "bytes32"], [lowBid, salt]);

            await marketplace.connect(buyer1).commitBid(1, commitment);
            await time.increase(3601);

            await expect(
                marketplace.connect(buyer1).revealBid(1, lowBid, salt)
            ).to.be.revertedWith("Marketplace: Below reserve");
        });
    });
});

// Mock ERC20 for testing
describe("MockERC20", function () {
    // This would be in a separate file, included here for completeness
});
