import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { VerticalNFT } from "../typechain-types";

describe("VerticalNFT — Advanced", function () {
    let verticalNFT: VerticalNFT;
    let owner: SignerWithAddress;
    let minter: SignerWithAddress;
    let buyer: SignerWithAddress;
    let buyer2: SignerWithAddress;
    let other: SignerWithAddress;

    const attributesHash = ethers.keccak256(ethers.toUtf8Bytes('{"test":true}'));

    // Generate slug hashes
    function slug(name: string) {
        return ethers.keccak256(ethers.toUtf8Bytes(name));
    }

    beforeEach(async function () {
        [owner, minter, buyer, buyer2, other] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("VerticalNFT");
        verticalNFT = (await Factory.deploy(owner.address, 200, owner.address)) as unknown as VerticalNFT;
        await verticalNFT.waitForDeployment();
        await verticalNFT.connect(owner).setAuthorizedMinter(minter.address, true);
    });

    // ─── Batch Minting ──────────────────────────

    describe("Batch mint 5 verticals", function () {
        it("Should mint 5 top-level verticals in sequence", async function () {
            const verticals = ["solar", "mortgage", "roofing", "insurance", "legal"];

            for (let i = 0; i < verticals.length; i++) {
                await verticalNFT.connect(minter).mintVertical(
                    buyer.address, slug(verticals[i]), ethers.ZeroHash,
                    attributesHash, 0, `ipfs://${verticals[i]}`
                );
            }

            expect(await verticalNFT.totalSupply()).to.equal(5);

            // Each slug maps to correct token
            for (let i = 0; i < verticals.length; i++) {
                expect(await verticalNFT.slugToToken(slug(verticals[i]))).to.equal(i + 1);
            }
        });
    });

    // ─── Multi-Level Hierarchy ───────────────────

    describe("Multi-level hierarchy (depth 0→3)", function () {
        it("Should mint depth 0 → 1 → 2 → 3 chain", async function () {
            const levels = [
                { name: "home_services", parent: ethers.ZeroHash, depth: 0 },
                { name: "plumbing", parent: slug("home_services"), depth: 1 },
                { name: "residential_plumbing", parent: slug("plumbing"), depth: 2 },
                { name: "emergency_plumbing", parent: slug("residential_plumbing"), depth: 3 },
            ];

            for (const level of levels) {
                await verticalNFT.connect(minter).mintVertical(
                    buyer.address, slug(level.name), level.parent,
                    attributesHash, level.depth, `ipfs://${level.name}`
                );
            }

            expect(await verticalNFT.totalSupply()).to.equal(4);

            const deepMeta = await verticalNFT.getVertical(4);
            expect(deepMeta.depth).to.equal(3);
            expect(deepMeta.parentSlug).to.equal(slug("residential_plumbing"));
        });

        it("Should revert depth 4 (exceeds MAX_DEPTH=3)", async function () {
            // Build chain up to depth 3
            await verticalNFT.connect(minter).mintVertical(buyer.address, slug("l0"), ethers.ZeroHash, attributesHash, 0, "");
            await verticalNFT.connect(minter).mintVertical(buyer.address, slug("l1"), slug("l0"), attributesHash, 1, "");
            await verticalNFT.connect(minter).mintVertical(buyer.address, slug("l2"), slug("l1"), attributesHash, 2, "");
            await verticalNFT.connect(minter).mintVertical(buyer.address, slug("l3"), slug("l2"), attributesHash, 3, "");

            await expect(
                verticalNFT.connect(minter).mintVertical(
                    buyer.address, slug("l4"), slug("l3"), attributesHash, 4, ""
                )
            ).to.be.revertedWith("VerticalNFT: Depth exceeds limit");
        });
    });

    // ─── Transfer + Owner Change ────────────────

    describe("Transfer and owner change", function () {
        it("Should transfer NFT and update ownership", async function () {
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, "ipfs://solar"
            );

            expect(await verticalNFT.ownerOf(1)).to.equal(buyer.address);

            // Transfer from buyer to buyer2
            await verticalNFT.connect(buyer).transferFrom(buyer.address, buyer2.address, 1);

            expect(await verticalNFT.ownerOf(1)).to.equal(buyer2.address);
        });

        it("Should revert transfer from non-owner", async function () {
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, ""
            );

            await expect(
                verticalNFT.connect(other).transferFrom(buyer.address, other.address, 1)
            ).to.be.reverted;
        });
    });

    // ─── Burn + Re-Mint Same Slug ───────────────

    describe("Burn and re-mint same slug", function () {
        it("Should allow re-minting a slug after burn", async function () {
            // Mint
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, "ipfs://v1"
            );
            expect(await verticalNFT.slugToToken(slug("solar"))).to.equal(1);

            // Burn via deactivate
            await verticalNFT.connect(buyer).deactivateVertical(1);
            expect(await verticalNFT.slugToToken(slug("solar"))).to.equal(0);

            // Re-mint same slug
            await verticalNFT.connect(minter).mintVertical(
                buyer2.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, "ipfs://v2"
            );

            expect(await verticalNFT.slugToToken(slug("solar"))).to.equal(2);
            expect(await verticalNFT.ownerOf(2)).to.equal(buyer2.address);
            expect(await verticalNFT.tokenURI(2)).to.equal("ipfs://v2");
        });
    });

    // ─── Royalty Math ───────────────────────────

    describe("Royalty math at various sale prices", function () {
        beforeEach(async function () {
            await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, ""
            );
        });

        it("Should compute 2% of 100 USDC", async function () {
            const price = ethers.parseUnits("100", 6);
            const [receiver, royalty] = await verticalNFT.royaltyInfo(1, price);
            expect(royalty).to.equal(ethers.parseUnits("2", 6));
            expect(receiver).to.equal(owner.address);
        });

        it("Should compute 2% of 1 wei (rounds to 0)", async function () {
            const [, royalty] = await verticalNFT.royaltyInfo(1, 1n);
            expect(royalty).to.equal(0n);
        });

        it("Should compute 2% of 1 ETH (10^18)", async function () {
            const price = ethers.parseEther("1");
            const [, royalty] = await verticalNFT.royaltyInfo(1, price);
            expect(royalty).to.equal(ethers.parseEther("0.02"));
        });
    });

    // ─── Gas Benchmarks ─────────────────────────

    describe("Gas usage", function () {
        it("Should mint a vertical for less than 250k gas", async function () {
            const tx = await verticalNFT.connect(minter).mintVertical(
                buyer.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, "ipfs://solar"
            );
            const receipt = await tx.wait();
            // With optimizer on + viaIR, single mint should be well under 250k
            expect(receipt!.gasUsed).to.be.lessThan(250000n);
        });
    });
});
