import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { VerticalNFT, VerticalAuction } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("VerticalAuction", function () {
    let verticalNFT: VerticalNFT;
    let auction: VerticalAuction;
    let owner: SignerWithAddress;
    let platform: SignerWithAddress;
    let minter: SignerWithAddress;
    let bidder1: SignerWithAddress;
    let bidder2: SignerWithAddress;
    let other: SignerWithAddress;

    const ROYALTY_BPS = 200n; // 2%
    const DURATION = 3600; // 1 hour

    function slug(name: string) {
        return ethers.keccak256(ethers.toUtf8Bytes(name));
    }

    const attributesHash = ethers.keccak256(ethers.toUtf8Bytes('{"test":true}'));

    beforeEach(async function () {
        [owner, platform, minter, bidder1, bidder2, other] = await ethers.getSigners();

        // Deploy VerticalNFT
        const NFTFactory = await ethers.getContractFactory("VerticalNFT");
        verticalNFT = (await NFTFactory.deploy(
            owner.address, ROYALTY_BPS, platform.address
        )) as unknown as VerticalNFT;
        await verticalNFT.waitForDeployment();
        await verticalNFT.connect(owner).setAuthorizedMinter(minter.address, true);

        // Deploy VerticalAuction
        const AuctionFactory = await ethers.getContractFactory("VerticalAuction");
        auction = (await AuctionFactory.deploy()) as unknown as VerticalAuction;
        await auction.waitForDeployment();

        // Mint a vertical to platform
        await verticalNFT.connect(minter).mintVertical(
            platform.address, slug("solar"), ethers.ZeroHash, attributesHash, 0, "ipfs://solar"
        );

        // Platform approves auction contract
        await verticalNFT.connect(platform).setApprovalForAll(
            await auction.getAddress(), true
        );
    });

    // ─── Create Auction ────────────────────────────

    describe("Create Auction", function () {
        it("Should create auction with valid params", async function () {
            const reserve = ethers.parseEther("0.1");
            const nftAddr = await verticalNFT.getAddress();

            const tx = await auction.connect(platform).createAuction(
                nftAddr, 1, reserve, DURATION
            );

            await expect(tx).to.emit(auction, "AuctionCreated");

            const a = await auction.getAuction(1);
            expect(a.tokenId).to.equal(1);
            expect(a.seller).to.equal(platform.address);
            expect(a.reservePrice).to.equal(reserve);
            expect(a.settled).to.equal(false);
        });

        it("Should revert if caller is not NFT owner", async function () {
            const nftAddr = await verticalNFT.getAddress();
            await expect(
                auction.connect(other).createAuction(nftAddr, 1, 100, DURATION)
            ).to.be.revertedWith("Auction: Not NFT owner");
        });
    });

    // ─── Place Bid ─────────────────────────────────

    describe("Place Bid", function () {
        let nftAddr: string;
        const reserve = ethers.parseEther("0.1");

        beforeEach(async function () {
            nftAddr = await verticalNFT.getAddress();
            await auction.connect(platform).createAuction(nftAddr, 1, reserve, DURATION);
        });

        it("Should place valid bid at reserve price", async function () {
            const tx = await auction.connect(bidder1).placeBid(1, { value: reserve });
            await expect(tx)
                .to.emit(auction, "BidPlaced")
                .withArgs(1, bidder1.address, reserve);

            const a = await auction.getAuction(1);
            expect(a.highBidder).to.equal(bidder1.address);
            expect(a.highBid).to.equal(reserve);
        });

        it("Should revert bid below reserve", async function () {
            const lowBid = ethers.parseEther("0.05");
            await expect(
                auction.connect(bidder1).placeBid(1, { value: lowBid })
            ).to.be.revertedWith("Auction: Below reserve");
        });

        it("Should revert bid below current high bid", async function () {
            await auction.connect(bidder1).placeBid(1, { value: reserve });
            await expect(
                auction.connect(bidder2).placeBid(1, { value: reserve }) // same, not higher
            ).to.be.revertedWith("Auction: Below current high bid");
        });

        it("Should revert bid after auction ends", async function () {
            // Fast-forward past auction end
            await time.increase(DURATION + 1);

            await expect(
                auction.connect(bidder1).placeBid(1, { value: reserve })
            ).to.be.revertedWith("Auction: Ended");
        });
    });

    // ─── Settle Auction ────────────────────────────

    describe("Settle Auction", function () {
        let nftAddr: string;
        const reserve = ethers.parseEther("0.1");

        beforeEach(async function () {
            nftAddr = await verticalNFT.getAddress();
            await auction.connect(platform).createAuction(nftAddr, 1, reserve, DURATION);
        });

        it("Should settle: NFT transferred + event emitted", async function () {
            // Bidder bids
            const bid = ethers.parseEther("0.5");
            await auction.connect(bidder1).placeBid(1, { value: bid });

            // Fast-forward past auction end
            await time.increase(DURATION + 1);

            const tx = await auction.connect(owner).settleAuction(1);
            await expect(tx).to.emit(auction, "AuctionSettled");

            // NFT transferred to winner
            expect(await verticalNFT.ownerOf(1)).to.equal(bidder1.address);

            // Auction marked settled
            const a = await auction.getAuction(1);
            expect(a.settled).to.equal(true);
        });

        it("Should revert settle before auction ends", async function () {
            await auction.connect(bidder1).placeBid(1, { value: reserve });
            await expect(
                auction.connect(owner).settleAuction(1)
            ).to.be.revertedWith("Auction: Not ended yet");
        });
    });

    // ─── Cancel Auction ────────────────────────────

    describe("Cancel Auction", function () {
        let nftAddr: string;

        beforeEach(async function () {
            nftAddr = await verticalNFT.getAddress();
            const reserve = ethers.parseEther("0.1");
            await auction.connect(platform).createAuction(nftAddr, 1, reserve, DURATION);
        });

        it("Should cancel auction with no bids", async function () {
            const tx = await auction.connect(platform).cancelAuction(1);

            await expect(tx)
                .to.emit(auction, "AuctionCancelled")
                .withArgs(1);

            const a = await auction.getAuction(1);
            expect(a.cancelled).to.equal(true);
        });

        it("Should revert cancel when bids exist", async function () {
            const reserve = ethers.parseEther("0.1");
            await auction.connect(bidder1).placeBid(1, { value: reserve });

            await expect(
                auction.connect(platform).cancelAuction(1)
            ).to.be.revertedWith("Auction: Has bids");
        });
    });

    // ─── Multiple Bids + Refunds ───────────────────

    describe("Multiple Bids and Refunds", function () {
        it("Should refund outbid bidder via withdraw", async function () {
            const nftAddr = await verticalNFT.getAddress();
            const reserve = ethers.parseEther("0.1");
            await auction.connect(platform).createAuction(nftAddr, 1, reserve, DURATION);

            // Bidder1 bids 0.2 ETH
            await auction.connect(bidder1).placeBid(1, { value: ethers.parseEther("0.2") });

            // Bidder2 outbids with 0.3 ETH
            await auction.connect(bidder2).placeBid(1, { value: ethers.parseEther("0.3") });

            // Bidder1 should have pending withdrawal
            const pending = await auction.pendingWithdrawals(bidder1.address);
            expect(pending).to.equal(ethers.parseEther("0.2"));

            // Bidder1 withdraws
            const balBefore = await ethers.provider.getBalance(bidder1.address);
            const tx = await auction.connect(bidder1).withdraw();
            const receipt = await tx.wait();
            const gasCost = receipt!.gasUsed * receipt!.gasPrice;
            const balAfter = await ethers.provider.getBalance(bidder1.address);

            expect(balAfter + gasCost - balBefore).to.equal(ethers.parseEther("0.2"));
        });
    });
});
