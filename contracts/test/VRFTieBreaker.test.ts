import { expect } from "chai";
import { ethers } from "hardhat";

describe("VRFTieBreaker", function () {
    let tieBreaker: any;
    let mockCoordinator: any;
    let owner: any;
    let addr1: any;
    let addr2: any;
    let addr3: any;

    const DUMMY_KEY_HASH = ethers.keccak256(ethers.toUtf8Bytes("test-key-hash"));
    const AUCTION_TIE = 0;
    const BOUNTY_ALLOCATION = 1;

    beforeEach(async function () {
        [owner, addr1, addr2, addr3] = await ethers.getSigners();

        // Deploy mock coordinator
        const MockCoord = await ethers.getContractFactory("MockVRFCoordinatorV2Plus");
        mockCoordinator = await MockCoord.deploy();
        await mockCoordinator.waitForDeployment();

        // Create subscription
        const subTx = await mockCoordinator.createSubscription();
        await subTx.wait();
        const subId = 1; // First subscription

        // Deploy VRFTieBreaker with mock coordinator
        const VRFTieBreaker = await ethers.getContractFactory("VRFTieBreaker");
        tieBreaker = await VRFTieBreaker.deploy(
            await mockCoordinator.getAddress(),
            subId,
            DUMMY_KEY_HASH
        );
        await tieBreaker.waitForDeployment();

        // Add consumer to subscription
        await mockCoordinator.addConsumer(subId, await tieBreaker.getAddress());
    });

    describe("Auction Tie-Breaking", function () {
        it("should resolve a 2-way tie and pick one candidate", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-001"));
            const candidates = [addr1.address, addr2.address];

            const tx = await tieBreaker.requestResolution(leadIdHash, candidates, AUCTION_TIE);
            await tx.wait();

            // Mock coordinator fulfills immediately, so resolution should be done
            const resolved = await tieBreaker.isResolved(leadIdHash);
            expect(resolved).to.be.true;

            const resolution = await tieBreaker.getResolution(leadIdHash);
            expect(resolution.status).to.equal(2); // FULFILLED
            expect(resolution.resolveType).to.equal(AUCTION_TIE);
            expect(resolution.candidates).to.have.lengthOf(2);
            expect(candidates).to.include(resolution.winner);
            expect(resolution.randomWord).to.not.equal(0n);
        });

        it("should resolve a 3-way tie and pick one candidate", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-002"));
            const candidates = [addr1.address, addr2.address, addr3.address];

            await tieBreaker.requestResolution(leadIdHash, candidates, AUCTION_TIE);

            const resolution = await tieBreaker.getResolution(leadIdHash);
            expect(resolution.status).to.equal(2);
            expect(candidates).to.include(resolution.winner);
        });

        it("should emit ResolutionRequested and TieResolved events", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-003"));
            const candidates = [addr1.address, addr2.address];

            const tx = await tieBreaker.requestResolution(leadIdHash, candidates, AUCTION_TIE);
            const receipt = await tx.wait();

            // Check ResolutionRequested event
            const reqEvent = receipt.logs.find((log: any) => {
                try {
                    const parsed = tieBreaker.interface.parseLog(log);
                    return parsed?.name === "ResolutionRequested";
                } catch { return false; }
            });
            expect(reqEvent).to.not.be.undefined;

            // Check TieResolved event
            const resEvent = receipt.logs.find((log: any) => {
                try {
                    const parsed = tieBreaker.interface.parseLog(log);
                    return parsed?.name === "TieResolved";
                } catch { return false; }
            });
            expect(resEvent).to.not.be.undefined;
        });
    });

    describe("Bounty Allocation", function () {
        it("should resolve bounty tie between multiple pool owners", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-bounty-001"));
            const candidates = [addr1.address, addr2.address, addr3.address];

            await tieBreaker.requestResolution(leadIdHash, candidates, BOUNTY_ALLOCATION);

            const resolution = await tieBreaker.getResolution(leadIdHash);
            expect(resolution.status).to.equal(2);
            expect(resolution.resolveType).to.equal(BOUNTY_ALLOCATION);
            expect(candidates).to.include(resolution.winner);
        });
    });

    describe("Guards", function () {
        it("should revert with fewer than 2 candidates", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-one"));
            await expect(
                tieBreaker.requestResolution(leadIdHash, [addr1.address], AUCTION_TIE)
            ).to.be.revertedWith("Need 2+ candidates");
        });

        it("should revert with more than 10 candidates", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-many"));
            // Generate 11 random addresses (Hardhat only has 10 signers by default)
            const candidates = Array.from({ length: 11 }, (_, i) =>
                ethers.Wallet.createRandom().address
            );
            await expect(
                tieBreaker.requestResolution(leadIdHash, candidates, AUCTION_TIE)
            ).to.be.revertedWith("Max 10 candidates");
        });

        it("should prevent double-resolution of the same lead", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-double"));
            const candidates = [addr1.address, addr2.address];

            await tieBreaker.requestResolution(leadIdHash, candidates, AUCTION_TIE);

            // Already fulfilled (mock coordinator responds immediately)
            await expect(
                tieBreaker.requestResolution(leadIdHash, candidates, AUCTION_TIE)
            ).to.be.revertedWith("Already resolved");
        });

        it("should only allow owner to request resolution", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-unauth"));
            const candidates = [addr1.address, addr2.address];

            await expect(
                tieBreaker.connect(addr1).requestResolution(leadIdHash, candidates, AUCTION_TIE)
            ).to.be.reverted;
        });
    });

    describe("Admin", function () {
        it("should update config", async function () {
            const newKeyHash = ethers.keccak256(ethers.toUtf8Bytes("new-key"));
            const newSubId = 42;

            await expect(tieBreaker.setConfig(newSubId, newKeyHash))
                .to.emit(tieBreaker, "ConfigUpdated")
                .withArgs(newSubId, newKeyHash);

            expect(await tieBreaker.s_subscriptionId()).to.equal(newSubId);
            expect(await tieBreaker.s_keyHash()).to.equal(newKeyHash);
        });
    });

    describe("Determinism check", function () {
        it("should pick different winners for different lead IDs", async function () {
            // Request resolution for multiple different leads and verify
            // that the winner isn't always the same candidate (demonstrates
            // that the random word varies per request)
            const results: string[] = [];

            for (let i = 0; i < 5; i++) {
                const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes(`lead-det-${i}`));
                const candidates = [addr1.address, addr2.address, addr3.address];
                await tieBreaker.requestResolution(leadIdHash, candidates, AUCTION_TIE);
                const resolution = await tieBreaker.getResolution(leadIdHash);
                results.push(resolution.winner);
            }

            // With 5 draws from 3 candidates, getting all the same has probability (1/3)^4 ≈ 1.2%.
            // Require at least 2 distinct winners to prove the mock produces varying randomness.
            const unique = new Set(results);
            expect(unique.size).to.be.greaterThanOrEqual(2);
        });
    });

    describe("Edge Cases", function () {
        it("should revert with zero candidates", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-zero"));
            await expect(
                tieBreaker.requestResolution(leadIdHash, [], AUCTION_TIE)
            ).to.be.revertedWith("Need 2+ candidates");
        });

        it("should handle exactly 10 candidates (max boundary)", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-ten"));
            const candidates = Array.from({ length: 10 }, () =>
                ethers.Wallet.createRandom().address
            );
            const tx = await tieBreaker.requestResolution(leadIdHash, candidates, AUCTION_TIE);
            await tx.wait();
            const resolution = await tieBreaker.getResolution(leadIdHash);
            expect(resolution.status).to.equal(2); // FULFILLED
            expect(candidates).to.include(resolution.winner);
        });

        it("should handle bounty allocation with exactly 2 candidates", async function () {
            const leadIdHash = ethers.keccak256(ethers.toUtf8Bytes("lead-bounty-min"));
            const candidates = [addr1.address, addr2.address];
            await tieBreaker.requestResolution(leadIdHash, candidates, BOUNTY_ALLOCATION);
            const resolution = await tieBreaker.getResolution(leadIdHash);
            expect(resolution.status).to.equal(2);
            expect(resolution.resolveType).to.equal(BOUNTY_ALLOCATION);
            expect(candidates).to.include(resolution.winner);
        });
    });
});
