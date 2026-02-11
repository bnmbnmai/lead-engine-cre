import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { VerticalNFT } from "../typechain-types";

describe("VerticalNFT", function () {
    let verticalNFT: VerticalNFT;
    let owner: SignerWithAddress;
    let minter: SignerWithAddress;
    let buyer: SignerWithAddress;
    let other: SignerWithAddress;

    // Test data
    const slug = ethers.keccak256(ethers.toUtf8Bytes("plumbing"));
    const parentSlug = ethers.keccak256(ethers.toUtf8Bytes("home_services"));
    const attributesHash = ethers.keccak256(ethers.toUtf8Bytes('{"keywords":["plumbing","pipes"]}'));
    const uri = "ipfs://QmVerticalPlumbing123";
    const DEFAULT_ROYALTY_BPS = 200n; // 2%

    beforeEach(async function () {
        [owner, minter, buyer, other] = await ethers.getSigners();

        const Factory = await ethers.getContractFactory("VerticalNFT");
        verticalNFT = await Factory.deploy(owner.address, DEFAULT_ROYALTY_BPS);
        await verticalNFT.waitForDeployment();

        // Authorize minter
        await verticalNFT.connect(owner).setAuthorizedMinter(minter.address, true);
    });

    // ============================================
    // Deployment
    // ============================================

    describe("Deployment", function () {
        it("Should set correct name and symbol", async function () {
            expect(await verticalNFT.name()).to.equal("Lead Engine Vertical");
            expect(await verticalNFT.symbol()).to.equal("VERT");
        });

        it("Should set owner correctly", async function () {
            expect(await verticalNFT.owner()).to.equal(owner.address);
        });

        it("Should set default royalty (2%)", async function () {
            // Mint a token first to test royalty
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug, ethers.ZeroHash, attributesHash, 0, uri
            );

            // royaltyInfo(tokenId, salePrice) => (receiver, royaltyAmount)
            const salePrice = ethers.parseEther("1");
            const [receiver, royalty] = await verticalNFT.royaltyInfo(1, salePrice);

            expect(receiver).to.equal(owner.address);
            expect(royalty).to.equal(salePrice * DEFAULT_ROYALTY_BPS / 10000n);
        });

        it("Should report totalSupply as 0", async function () {
            expect(await verticalNFT.totalSupply()).to.equal(0);
        });
    });

    // ============================================
    // Minting
    // ============================================

    describe("Minting", function () {
        it("Should mint a top-level vertical", async function () {
            const tx = await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug, ethers.ZeroHash, attributesHash, 0, uri
            );

            await expect(tx)
                .to.emit(verticalNFT, "VerticalMinted")
                .withArgs(1, slug, ethers.ZeroHash, buyer.address, 0);

            expect(await verticalNFT.ownerOf(1)).to.equal(buyer.address);
            expect(await verticalNFT.tokenURI(1)).to.equal(uri);
            expect(await verticalNFT.totalSupply()).to.equal(1);
        });

        it("Should mint a child vertical under a parent", async function () {
            // Mint parent first
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, parentSlug, ethers.ZeroHash, attributesHash, 0, "ipfs://parent"
            );

            // Mint child
            const tx = await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug, parentSlug, attributesHash, 1, uri
            );

            await expect(tx)
                .to.emit(verticalNFT, "VerticalMinted")
                .withArgs(2, slug, parentSlug, buyer.address, 1);
        });

        it("Should store correct metadata", async function () {
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug, ethers.ZeroHash, attributesHash, 0, uri
            );

            const meta = await verticalNFT.getVertical(1);
            expect(meta.slug).to.equal(slug);
            expect(meta.parentSlug).to.equal(ethers.ZeroHash);
            expect(meta.attributesHash).to.equal(attributesHash);
            expect(meta.depth).to.equal(0);
            expect(meta.isFractionalizable).to.equal(false);
            expect(meta.activatedAt).to.be.greaterThan(0);
        });

        it("Should populate slugToToken mapping", async function () {
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug, ethers.ZeroHash, attributesHash, 0, uri
            );

            expect(await verticalNFT.slugToToken(slug)).to.equal(1);
        });

        it("Should revert if slug already minted", async function () {
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug, ethers.ZeroHash, attributesHash, 0, uri
            );

            await expect(
                verticalNFT.connect(minter).mintVertical(
                    other.address, slug, ethers.ZeroHash, attributesHash, 0, "ipfs://dup"
                )
            ).to.be.revertedWith("VerticalNFT: Slug already minted");
        });

        it("Should revert if caller is not authorized", async function () {
            await expect(
                verticalNFT.connect(other).mintVertical(
                    buyer.address, slug, ethers.ZeroHash, attributesHash, 0, uri
                )
            ).to.be.revertedWith("VerticalNFT: Not authorized");
        });

        it("Should revert if depth exceeds MAX_DEPTH", async function () {
            await expect(
                verticalNFT.connect(minter).mintVertical(
                    buyer.address, slug, ethers.ZeroHash, attributesHash, 4, uri
                )
            ).to.be.revertedWith("VerticalNFT: Depth exceeds limit");
        });

        it("Should revert if parent slug not minted", async function () {
            await expect(
                verticalNFT.connect(minter).mintVertical(
                    buyer.address, slug, parentSlug, attributesHash, 1, uri
                )
            ).to.be.revertedWith("VerticalNFT: Parent not minted");
        });

        it("Should revert if slug is zero", async function () {
            await expect(
                verticalNFT.connect(minter).mintVertical(
                    buyer.address, ethers.ZeroHash, ethers.ZeroHash, attributesHash, 0, uri
                )
            ).to.be.revertedWith("VerticalNFT: Empty slug");
        });

        it("Should revert if to address is zero", async function () {
            await expect(
                verticalNFT.connect(minter).mintVertical(
                    ethers.ZeroAddress, slug, ethers.ZeroHash, attributesHash, 0, uri
                )
            ).to.be.revertedWith("VerticalNFT: Zero address");
        });
    });

    // ============================================
    // View Functions
    // ============================================

    describe("View Functions", function () {
        beforeEach(async function () {
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug, ethers.ZeroHash, attributesHash, 0, uri
            );
        });

        it("Should getVerticalBySlug", async function () {
            const [tokenId, meta] = await verticalNFT.getVerticalBySlug(slug);
            expect(tokenId).to.equal(1);
            expect(meta.slug).to.equal(slug);
            expect(meta.depth).to.equal(0);
        });

        it("Should revert getVerticalBySlug for unknown slug", async function () {
            const unknownSlug = ethers.keccak256(ethers.toUtf8Bytes("unknown"));
            await expect(
                verticalNFT.getVerticalBySlug(unknownSlug)
            ).to.be.revertedWith("VerticalNFT: Slug not found");
        });

        it("Should revert getVertical for nonexistent token", async function () {
            await expect(
                verticalNFT.getVertical(999)
            ).to.be.revertedWith("VerticalNFT: Token does not exist");
        });
    });

    // ============================================
    // Royalties (EIP-2981)
    // ============================================

    describe("Royalties", function () {
        beforeEach(async function () {
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug, ethers.ZeroHash, attributesHash, 0, uri
            );
        });

        it("Should return default 2% royalty", async function () {
            const salePrice = ethers.parseUnits("1000", 6); // 1000 USDC
            const [receiver, royalty] = await verticalNFT.royaltyInfo(1, salePrice);

            expect(receiver).to.equal(owner.address);
            expect(royalty).to.equal(ethers.parseUnits("20", 6)); // 2%
        });

        it("Should allow owner to set per-token royalty", async function () {
            // Set 5% royalty for token 1, send to minter
            await verticalNFT.connect(owner).setTokenRoyalty(1, minter.address, 500);

            const salePrice = ethers.parseUnits("1000", 6);
            const [receiver, royalty] = await verticalNFT.royaltyInfo(1, salePrice);

            expect(receiver).to.equal(minter.address);
            expect(royalty).to.equal(ethers.parseUnits("50", 6)); // 5%
        });

        it("Should allow owner to update default royalty", async function () {
            await expect(verticalNFT.connect(owner).setDefaultRoyalty(minter.address, 300))
                .to.emit(verticalNFT, "DefaultRoyaltyUpdated")
                .withArgs(minter.address, 300);
        });

        it("Should revert if non-owner sets royalty", async function () {
            await expect(
                verticalNFT.connect(other).setTokenRoyalty(1, other.address, 500)
            ).to.be.revertedWithCustomError(verticalNFT, "OwnableUnauthorizedAccount");
        });
    });

    // ============================================
    // Deactivation
    // ============================================

    describe("Deactivation", function () {
        beforeEach(async function () {
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug, ethers.ZeroHash, attributesHash, 0, uri
            );
        });

        it("Should allow owner to deactivate (burn)", async function () {
            const tx = await verticalNFT.connect(buyer).deactivateVertical(1);

            await expect(tx)
                .to.emit(verticalNFT, "VerticalDeactivated")
                .withArgs(1, slug);

            // Token no longer exists
            await expect(verticalNFT.ownerOf(1)).to.be.reverted;

            // Slug mapping cleared
            expect(await verticalNFT.slugToToken(slug)).to.equal(0);
        });

        it("Should revert if non-owner tries to deactivate", async function () {
            await expect(
                verticalNFT.connect(other).deactivateVertical(1)
            ).to.be.revertedWith("VerticalNFT: Not owner or approved");
        });
    });

    // ============================================
    // Fractionalizable Flag
    // ============================================

    describe("Fractionalizable", function () {
        beforeEach(async function () {
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug, ethers.ZeroHash, attributesHash, 0, uri
            );
        });

        it("Should allow contract owner to set fractionalizable", async function () {
            await expect(verticalNFT.connect(owner).setFractionalizable(1, true))
                .to.emit(verticalNFT, "FractionalizableSet")
                .withArgs(1, true);

            const meta = await verticalNFT.getVertical(1);
            expect(meta.isFractionalizable).to.equal(true);
        });

        it("Should revert if non-owner sets fractionalizable", async function () {
            await expect(
                verticalNFT.connect(other).setFractionalizable(1, true)
            ).to.be.revertedWithCustomError(verticalNFT, "OwnableUnauthorizedAccount");
        });
    });

    // ============================================
    // supportsInterface
    // ============================================

    describe("Interface Support", function () {
        it("Should support ERC-721", async function () {
            // ERC-721 interface ID: 0x80ac58cd
            expect(await verticalNFT.supportsInterface("0x80ac58cd")).to.equal(true);
        });

        it("Should support ERC-2981", async function () {
            // ERC-2981 interface ID: 0x2a55205a
            expect(await verticalNFT.supportsInterface("0x2a55205a")).to.equal(true);
        });

        it("Should support ERC-165", async function () {
            // ERC-165 interface ID: 0x01ffc9a7
            expect(await verticalNFT.supportsInterface("0x01ffc9a7")).to.equal(true);
        });
    });
});
