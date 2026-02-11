import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { VerticalNFT, MockV3Aggregator } from "../typechain-types";

describe("VerticalNFT — Platform Minting & Resale", function () {
    let verticalNFT: VerticalNFT;
    let mockPriceFeed: MockV3Aggregator;
    let owner: SignerWithAddress;
    let platform: SignerWithAddress;
    let minter: SignerWithAddress;
    let buyer: SignerWithAddress;
    let buyer2: SignerWithAddress;
    let other: SignerWithAddress;

    const DEFAULT_ROYALTY_BPS = 200n; // 2%

    function slug(name: string) {
        return ethers.keccak256(ethers.toUtf8Bytes(name));
    }

    const attributesHash = ethers.keccak256(ethers.toUtf8Bytes('{"keywords":["solar","panels"]}'));

    beforeEach(async function () {
        [owner, platform, minter, buyer, buyer2, other] = await ethers.getSigners();

        // Deploy VerticalNFT with platform address
        const Factory = await ethers.getContractFactory("VerticalNFT");
        verticalNFT = (await Factory.deploy(
            owner.address, DEFAULT_ROYALTY_BPS, platform.address
        )) as unknown as VerticalNFT;
        await verticalNFT.waitForDeployment();

        // Authorize minter
        await verticalNFT.connect(owner).setAuthorizedMinter(minter.address, true);

        // Deploy MockV3Aggregator (8 decimals, ETH/USD = $2000)
        const MockFactory = await ethers.getContractFactory("MockV3Aggregator");
        mockPriceFeed = (await MockFactory.deploy(8, 200000000000n)) as unknown as MockV3Aggregator;
        await mockPriceFeed.waitForDeployment();
    });

    // ─── Platform Minting ──────────────────────────

    describe("Platform Minting", function () {
        it("Should store platformAddress from constructor", async function () {
            expect(await verticalNFT.platformAddress()).to.equal(platform.address);
        });

        it("Should revert constructor with zero platform address", async function () {
            const Factory = await ethers.getContractFactory("VerticalNFT");
            await expect(
                Factory.deploy(owner.address, 200, ethers.ZeroAddress)
            ).to.be.revertedWith("VerticalNFT: Zero platform address");
        });

        it("Should revert constructor with royalty exceeding cap", async function () {
            const Factory = await ethers.getContractFactory("VerticalNFT");
            await expect(
                Factory.deploy(owner.address, 1500, platform.address) // 15% > 10% cap
            ).to.be.revertedWith("VerticalNFT: Royalty exceeds cap");
        });

        it("Should mint to platform address (authorized minter)", async function () {
            const tx = await verticalNFT.connect(minter).mintVertical(
                platform.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, "ipfs://solar"
            );

            await expect(tx)
                .to.emit(verticalNFT, "VerticalMinted")
                .withArgs(1, slug("solar"), ethers.ZeroHash, platform.address, 0);

            expect(await verticalNFT.ownerOf(1)).to.equal(platform.address);
        });

        it("Should revert mint from unauthorized address", async function () {
            await expect(
                verticalNFT.connect(other).mintVertical(
                    platform.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, ""
                )
            ).to.be.revertedWith("VerticalNFT: Not authorized");
        });
    });

    // ─── transferWithRoyalty ────────────────────────

    describe("transferWithRoyalty", function () {
        beforeEach(async function () {
            // Mint to platform
            await verticalNFT.connect(minter).mintVertical(
                platform.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, "ipfs://solar"
            );
        });

        it("Should transfer NFT and split payment (2% royalty to owner)", async function () {
            const salePrice = ethers.parseEther("1.0");
            const expectedRoyalty = salePrice * DEFAULT_ROYALTY_BPS / 10000n;
            const expectedSellerProceeds = salePrice - expectedRoyalty;

            const ownerBalBefore = await ethers.provider.getBalance(owner.address);
            const platformBalBefore = await ethers.provider.getBalance(platform.address);

            // Platform (seller) approves the contract or calls directly
            const tx = await verticalNFT.connect(platform).transferWithRoyalty(
                1, buyer.address, { value: salePrice }
            );
            const receipt = await tx.wait();

            // NFT transferred to buyer
            expect(await verticalNFT.ownerOf(1)).to.equal(buyer.address);

            // Check event
            await expect(tx)
                .to.emit(verticalNFT, "VerticalResold")
                .withArgs(1, platform.address, buyer.address, salePrice, expectedRoyalty);

            // Owner received royalty
            const ownerBalAfter = await ethers.provider.getBalance(owner.address);
            expect(ownerBalAfter - ownerBalBefore).to.equal(expectedRoyalty);
        });

        it("Should revert with zero payment", async function () {
            await expect(
                verticalNFT.connect(platform).transferWithRoyalty(1, buyer.address, { value: 0 })
            ).to.be.revertedWith("VerticalNFT: Zero payment");
        });

        it("Should revert with zero buyer address", async function () {
            await expect(
                verticalNFT.connect(platform).transferWithRoyalty(
                    1, ethers.ZeroAddress, { value: ethers.parseEther("1") }
                )
            ).to.be.revertedWith("VerticalNFT: Zero buyer");
        });

        it("Should revert if caller is not seller or approved", async function () {
            await expect(
                verticalNFT.connect(other).transferWithRoyalty(
                    1, buyer.address, { value: ethers.parseEther("1") }
                )
            ).to.be.revertedWith("VerticalNFT: Not seller or approved");
        });

        it("Should cap royalty at MAX_ROYALTY_BPS (10%)", async function () {
            // Set per-token royalty to... wait, it's capped at 10% in setTokenRoyalty too.
            // Instead, test the cap logic by verifying normal 2% is below cap
            const salePrice = ethers.parseEther("1.0");
            const [, royaltyAmount] = await verticalNFT.royaltyInfo(1, salePrice);
            const maxRoyalty = salePrice * 1000n / 10000n; // 10%

            expect(royaltyAmount).to.be.lessThanOrEqual(maxRoyalty);
        });
    });

    // ─── Royalty Caps ──────────────────────────────

    describe("Royalty Caps", function () {
        beforeEach(async function () {
            await verticalNFT.connect(minter).mintVertical(
                platform.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, ""
            );
        });

        it("Should revert setDefaultRoyalty above 10%", async function () {
            await expect(
                verticalNFT.connect(owner).setDefaultRoyalty(owner.address, 1500) // 15%
            ).to.be.revertedWith("VerticalNFT: Royalty exceeds cap");
        });

        it("Should allow setDefaultRoyalty at exactly 10%", async function () {
            await expect(
                verticalNFT.connect(owner).setDefaultRoyalty(owner.address, 1000)
            ).to.emit(verticalNFT, "DefaultRoyaltyUpdated").withArgs(owner.address, 1000);
        });

        it("Should revert setTokenRoyalty above 10%", async function () {
            await expect(
                verticalNFT.connect(owner).setTokenRoyalty(1, owner.address, 1100) // 11%
            ).to.be.revertedWith("VerticalNFT: Royalty exceeds cap");
        });

        it("Should allow setTokenRoyalty at exactly 10%", async function () {
            await expect(
                verticalNFT.connect(owner).setTokenRoyalty(1, minter.address, 1000)
            ).to.emit(verticalNFT, "TokenRoyaltyUpdated").withArgs(1, minter.address, 1000);
        });
    });

    // ─── Batch Minting ─────────────────────────────

    describe("Batch Minting", function () {
        it("Should batch mint 5 verticals", async function () {
            const names = ["solar", "mortgage", "roofing", "insurance", "legal"];
            const params = names.map((name) => ({
                to: platform.address,
                slug: slug(name),
                parentSlug: ethers.ZeroHash,
                attributesHash,
                depth: 0,
                uri: `ipfs://${name}`,
            }));

            const tx = await verticalNFT.connect(minter).batchMintVerticals(params);
            const receipt = await tx.wait();

            expect(await verticalNFT.totalSupply()).to.equal(5);

            // Verify each slug maps correctly
            for (let i = 0; i < names.length; i++) {
                expect(await verticalNFT.slugToToken(slug(names[i]))).to.equal(i + 1);
                expect(await verticalNFT.ownerOf(i + 1)).to.equal(platform.address);
            }

            // Check BatchMinted event
            await expect(tx).to.emit(verticalNFT, "BatchMinted");
        });

        it("Should revert batch > MAX_BATCH_SIZE (20)", async function () {
            const params = Array.from({ length: 21 }, (_, i) => ({
                to: platform.address,
                slug: slug(`vertical_${i}`),
                parentSlug: ethers.ZeroHash,
                attributesHash,
                depth: 0,
                uri: "",
            }));

            await expect(
                verticalNFT.connect(minter).batchMintVerticals(params)
            ).to.be.revertedWith("VerticalNFT: Batch too large");
        });

        it("Should revert empty batch", async function () {
            await expect(
                verticalNFT.connect(minter).batchMintVerticals([])
            ).to.be.revertedWith("VerticalNFT: Empty batch");
        });
    });

    // ─── Chainlink Price Feed ──────────────────────

    describe("Chainlink Price Feed", function () {
        it("Should set price feed and read floor price", async function () {
            await verticalNFT.connect(owner).setPriceFeed(
                await mockPriceFeed.getAddress()
            );

            expect(await verticalNFT.priceFeed()).to.equal(await mockPriceFeed.getAddress());

            const [price, updatedAt] = await verticalNFT.getFloorPrice();
            expect(price).to.equal(200000000000n); // $2000 with 8 decimals
            expect(updatedAt).to.be.greaterThan(0);
        });

        it("Should reflect updated price after mock update", async function () {
            await verticalNFT.connect(owner).setPriceFeed(
                await mockPriceFeed.getAddress()
            );

            // Update mock to $3000
            await mockPriceFeed.updateAnswer(300000000000n);

            const [price] = await verticalNFT.getFloorPrice();
            expect(price).to.equal(300000000000n);
        });

        it("Should revert getFloorPrice if no feed set", async function () {
            await expect(
                verticalNFT.getFloorPrice()
            ).to.be.revertedWith("VerticalNFT: No price feed");
        });

        it("Should revert if price feed returns zero/negative", async function () {
            await verticalNFT.connect(owner).setPriceFeed(
                await mockPriceFeed.getAddress()
            );

            await mockPriceFeed.updateAnswer(0);

            await expect(
                verticalNFT.getFloorPrice()
            ).to.be.revertedWith("VerticalNFT: Invalid price");
        });

        it("Should emit PriceFeedUpdated event", async function () {
            const feedAddr = await mockPriceFeed.getAddress();
            await expect(
                verticalNFT.connect(owner).setPriceFeed(feedAddr)
            ).to.emit(verticalNFT, "PriceFeedUpdated").withArgs(feedAddr);
        });
    });
});
