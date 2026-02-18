/**
 * BountyMatcher — Chainlink Functions bounty criteria matching tests
 *
 * Uses MockFunctionsRouter to simulate DON callbacks.
 * Covers: full match, partial match, no match, individual criteria filters,
 * multi-pool mixed, empty criteria, guards, admin, and error handling.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("BountyMatcher", function () {
    let owner: Signer;
    let other: Signer;
    let mockRouter: Contract;
    let matcher: Contract;

    const DON_ID = ethers.encodeBytes32String("fun-base-sepolia-1");
    const SUBSCRIPTION_ID = 1234n;

    // Sample matching source (stored on-chain but executed by DON — for tests
    // the mock router doesn't execute it, we just need non-empty source)
    const MATCH_SOURCE = `
        const pools = JSON.parse(args[6]);
        return Functions.encodeString(pools.map(p => p.poolId).join(","));
    `;

    async function deploy() {
        [owner, other] = await ethers.getSigners();

        const MockRouter = await ethers.getContractFactory("MockFunctionsRouter");
        mockRouter = await MockRouter.deploy();
        await mockRouter.waitForDeployment();

        const BountyMatcher = await ethers.getContractFactory("BountyMatcher");
        matcher = await BountyMatcher.deploy(
            await mockRouter.getAddress(),
            DON_ID,
            SUBSCRIPTION_ID,
            await owner.getAddress()
        );
        await matcher.waitForDeployment();

        // Set the source code
        await matcher.setSourceCode(MATCH_SOURCE);
    }

    // Build standard args (7 elements)
    function buildArgs(overrides: Partial<{
        leadId: string;
        qualityScore: string;
        creditScore: string;
        geoState: string;
        geoCountry: string;
        leadAgeHours: string;
        criteriaJSON: string;
    }> = {}) {
        return [
            overrides.leadId ?? "lead-001",
            overrides.qualityScore ?? "7500",
            overrides.creditScore ?? "720",
            overrides.geoState ?? "CA",
            overrides.geoCountry ?? "US",
            overrides.leadAgeHours ?? "2",
            overrides.criteriaJSON ?? JSON.stringify([
                {
                    poolId: "pool-1",
                    minQualityScore: 5000,
                    geoStates: ["CA", "TX"],
                    geoCountries: ["US"],
                    minCreditScore: 650,
                    maxLeadAge: 24,
                },
            ]),
        ];
    }

    /**
     * Encode a DON response: CSV string of pool IDs.
     * Matches the contract's _splitCSV parser.
     * Empty array → "0x" (empty bytes), non-empty → utf8 of "id1,id2,..."
     */
    function encodeMatchResponse(poolIds: string[]) {
        if (poolIds.length === 0) {
            return "0x"; // empty bytes → matchFound = false
        }
        return ethers.toUtf8Bytes(poolIds.join(","));
    }

    const leadIdHash = (leadId: string) =>
        ethers.keccak256(ethers.toUtf8Bytes(leadId));

    // ═══════════════════════════════════════════
    // Full Match
    // ═══════════════════════════════════════════

    describe("Full Match", function () {
        beforeEach(deploy);

        it("should request and fulfill a full match", async function () {
            const args = buildArgs();
            const hash = leadIdHash("lead-001");

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();

            // Extract requestId from event
            const event = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            );
            expect(event).to.not.be.undefined;
            const requestId = event.args[1]; // Second indexed arg

            // Should be PENDING
            expect(await matcher.getMatchStatus(hash)).to.equal(1); // PENDING

            // Simulate DON fulfillment with match
            const response = encodeMatchResponse(["pool-1"]);
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            // Should be FULFILLED
            expect(await matcher.getMatchStatus(hash)).to.equal(2); // FULFILLED
            expect(await matcher.isMatchVerified(hash)).to.be.true;

            const result = await matcher.getMatchResult(hash);
            expect(result.matchFound).to.be.true;
            expect(result.matchedPoolIds).to.deep.equal(["pool-1"]);
            expect(result.fulfilledAt).to.be.gt(0);
        });
    });

    // ═══════════════════════════════════════════
    // Partial Match (Multiple Pools, Some Match)
    // ═══════════════════════════════════════════

    describe("Partial Match", function () {
        beforeEach(deploy);

        it("should return only matching pool IDs", async function () {
            const criteria = [
                { poolId: "pool-A", minQualityScore: 5000 },
                { poolId: "pool-B", minQualityScore: 9000 }, // Won't match (QS=7500)
                { poolId: "pool-C", geoStates: ["CA"] },
            ];
            const args = buildArgs({
                criteriaJSON: JSON.stringify(criteria),
            });
            const hash = leadIdHash("lead-001");

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            // DON returns only pool-A and pool-C
            const response = encodeMatchResponse(["pool-A", "pool-C"]);
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            const result = await matcher.getMatchResult(hash);
            expect(result.matchFound).to.be.true;
            expect(result.matchedPoolIds).to.deep.equal(["pool-A", "pool-C"]);
        });
    });

    // ═══════════════════════════════════════════
    // No Match
    // ═══════════════════════════════════════════

    describe("No Match", function () {
        beforeEach(deploy);

        it("should handle zero matches", async function () {
            const criteria = [
                { poolId: "pool-1", minQualityScore: 9999 }, // QS too high
            ];
            const args = buildArgs({
                criteriaJSON: JSON.stringify(criteria),
            });
            const hash = leadIdHash("lead-001");

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            const response = encodeMatchResponse([]);
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            const result = await matcher.getMatchResult(hash);
            expect(result.matchFound).to.be.false;
            expect(result.matchedPoolIds.length).to.equal(0);
            expect(await matcher.isMatchVerified(hash)).to.be.false; // Fulfilled but no match → not verified
        });
    });

    // ═══════════════════════════════════════════
    // Individual Criteria Filters
    // ═══════════════════════════════════════════

    describe("Quality Score Filter", function () {
        beforeEach(deploy);

        it("should filter out pools with high QS thresholds", async function () {
            const hash = leadIdHash("lead-qs");
            const args = buildArgs({
                leadId: "lead-qs",
                qualityScore: "3000",
                criteriaJSON: JSON.stringify([
                    { poolId: "high", minQualityScore: 8000 },
                    { poolId: "low", minQualityScore: 2000 },
                ]),
            });

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            // DON would return only "low" pool
            const response = encodeMatchResponse(["low"]);
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            const result = await matcher.getMatchResult(hash);
            expect(result.matchedPoolIds).to.deep.equal(["low"]);
        });
    });

    describe("Geo State Filter", function () {
        beforeEach(deploy);

        it("should filter out pools for non-matching states", async function () {
            const hash = leadIdHash("lead-geo");
            const args = buildArgs({
                leadId: "lead-geo",
                geoState: "NY",
                criteriaJSON: JSON.stringify([
                    { poolId: "ca-only", geoStates: ["CA", "TX"] },
                    { poolId: "ny-ok", geoStates: ["NY", "NJ"] },
                ]),
            });

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            const response = encodeMatchResponse(["ny-ok"]);
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            const result = await matcher.getMatchResult(hash);
            expect(result.matchedPoolIds).to.deep.equal(["ny-ok"]);
        });
    });

    describe("Credit Score Filter", function () {
        beforeEach(deploy);

        it("should filter out pools with high credit requirements", async function () {
            const hash = leadIdHash("lead-credit");
            const args = buildArgs({
                leadId: "lead-credit",
                creditScore: "600",
                criteriaJSON: JSON.stringify([
                    { poolId: "prime", minCreditScore: 750 },
                    { poolId: "subprime", minCreditScore: 500 },
                ]),
            });

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            const response = encodeMatchResponse(["subprime"]);
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            const result = await matcher.getMatchResult(hash);
            expect(result.matchedPoolIds).to.deep.equal(["subprime"]);
        });
    });

    describe("Lead Age Filter", function () {
        beforeEach(deploy);

        it("should filter out pools for stale leads", async function () {
            const hash = leadIdHash("lead-stale");
            const args = buildArgs({
                leadId: "lead-stale",
                leadAgeHours: "72",
                criteriaJSON: JSON.stringify([
                    { poolId: "fresh-only", maxLeadAge: 24 },
                    { poolId: "any-age" },
                ]),
            });

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            const response = encodeMatchResponse(["any-age"]);
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            const result = await matcher.getMatchResult(hash);
            expect(result.matchedPoolIds).to.deep.equal(["any-age"]);
        });
    });

    describe("Geo Country Filter", function () {
        beforeEach(deploy);

        it("should filter by country", async function () {
            const hash = leadIdHash("lead-country");
            const args = buildArgs({
                leadId: "lead-country",
                geoCountry: "CA",
                criteriaJSON: JSON.stringify([
                    { poolId: "us-only", geoCountries: ["US"] },
                    { poolId: "ca-ok", geoCountries: ["US", "CA"] },
                ]),
            });

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            const response = encodeMatchResponse(["ca-ok"]);
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            const result = await matcher.getMatchResult(hash);
            expect(result.matchedPoolIds).to.deep.equal(["ca-ok"]);
        });
    });

    // ═══════════════════════════════════════════
    // Multi-Pool Mixed Results
    // ═══════════════════════════════════════════

    describe("Multi-Pool Mixed", function () {
        beforeEach(deploy);

        it("should handle 5 pools with mixed AND-logic results", async function () {
            const hash = leadIdHash("lead-mixed");
            const criteria = [
                { poolId: "p1", minQualityScore: 5000, geoStates: ["CA"] },
                { poolId: "p2", minQualityScore: 9000 },            // fail QS
                { poolId: "p3", geoStates: ["TX"] },                // fail geo
                { poolId: "p4", minCreditScore: 650 },              // pass
                { poolId: "p5", maxLeadAge: 1 },                    // fail age
            ];
            const args = buildArgs({
                leadId: "lead-mixed",
                qualityScore: "7500",
                creditScore: "720",
                geoState: "CA",
                leadAgeHours: "2",
                criteriaJSON: JSON.stringify(criteria),
            });

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            // DON logic: p1 pass (QS OK, CA OK), p2 fail, p3 fail, p4 pass, p5 fail
            const response = encodeMatchResponse(["p1", "p4"]);
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            const result = await matcher.getMatchResult(hash);
            expect(result.matchFound).to.be.true;
            expect(result.matchedPoolIds).to.deep.equal(["p1", "p4"]);
        });
    });

    // ═══════════════════════════════════════════
    // Empty Criteria (Match All)
    // ═══════════════════════════════════════════

    describe("Empty Criteria", function () {
        beforeEach(deploy);

        it("should match pools with no criteria", async function () {
            const hash = leadIdHash("lead-any");
            const args = buildArgs({
                leadId: "lead-any",
                criteriaJSON: JSON.stringify([
                    { poolId: "catch-all" }, // No restrictions
                ]),
            });

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            const response = encodeMatchResponse(["catch-all"]);
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            const result = await matcher.getMatchResult(hash);
            expect(result.matchFound).to.be.true;
            expect(result.matchedPoolIds).to.deep.equal(["catch-all"]);
        });
    });

    // ═══════════════════════════════════════════
    // Guards
    // ═══════════════════════════════════════════

    describe("Guards", function () {
        beforeEach(deploy);

        it("should revert when source not set", async function () {
            // Deploy fresh matcher without setting source
            const BountyMatcher = await ethers.getContractFactory("BountyMatcher");
            const fresh = await BountyMatcher.deploy(
                await mockRouter.getAddress(),
                DON_ID,
                SUBSCRIPTION_ID,
                await owner.getAddress()
            );
            await fresh.waitForDeployment();

            const hash = leadIdHash("lead-fail");
            const args = buildArgs({ leadId: "lead-fail" });

            await expect(
                fresh.requestBountyMatch(hash, args)
            ).to.be.revertedWith("BM: Source not set");
        });

        it("should revert when non-owner calls requestBountyMatch", async function () {
            const hash = leadIdHash("lead-unauth");
            const args = buildArgs({ leadId: "lead-unauth" });

            await expect(
                matcher.connect(other).requestBountyMatch(hash, args)
            ).to.be.revertedWithCustomError(matcher, "OwnableUnauthorizedAccount");
        });

        it("should revert on double requests for same lead", async function () {
            const hash = leadIdHash("lead-dupe");
            const args = buildArgs({ leadId: "lead-dupe" });

            await matcher.requestBountyMatch(hash, args);

            await expect(
                matcher.requestBountyMatch(hash, args)
            ).to.be.revertedWith("BM: Already requested");
        });

        it("should revert with fewer than 7 args", async function () {
            const hash = leadIdHash("lead-short");
            const shortArgs = ["lead-short", "7500", "720", "CA", "US", "2"]; // Only 6

            await expect(
                matcher.requestBountyMatch(hash, shortArgs)
            ).to.be.revertedWith("BM: Need 7 args");
        });
    });

    // ═══════════════════════════════════════════
    // Admin
    // ═══════════════════════════════════════════

    describe("Admin", function () {
        beforeEach(deploy);

        it("should update config", async function () {
            const newDonId = ethers.encodeBytes32String("fun-new");
            const tx = await matcher.setConfig(newDonId, 9999n, 500_000);

            await expect(tx).to.emit(matcher, "ConfigUpdated");
            expect(await matcher.donId()).to.equal(newDonId);
            expect(await matcher.subscriptionId()).to.equal(9999n);
            expect(await matcher.gasLimit()).to.equal(500_000);
        });

        it("should update source code", async function () {
            const tx = await matcher.setSourceCode("return 42;");
            await expect(tx).to.emit(matcher, "SourceCodeUpdated");
        });

        it("should reject non-owner admin calls", async function () {
            await expect(
                matcher.connect(other).setSourceCode("hack")
            ).to.be.revertedWithCustomError(matcher, "OwnableUnauthorizedAccount");

            await expect(
                matcher.connect(other).setConfig(DON_ID, 1n, 1)
            ).to.be.revertedWithCustomError(matcher, "OwnableUnauthorizedAccount");
        });
    });

    // ═══════════════════════════════════════════
    // Error Handling
    // ═══════════════════════════════════════════

    describe("Error Handling", function () {
        beforeEach(deploy);

        it("should handle DON error response", async function () {
            const hash = leadIdHash("lead-err");
            const args = buildArgs({ leadId: "lead-err" });

            const tx = await matcher.requestBountyMatch(hash, args);
            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            // Simulate error callback
            const errBytes = ethers.toUtf8Bytes("DON execution failed");
            await mockRouter.simulateFulfillment(requestId, "0x", errBytes);

            // Should be FAILED (3)
            expect(await matcher.getMatchStatus(hash)).to.equal(3);
            expect(await matcher.isMatchVerified(hash)).to.be.false;
        });

        it("should revert on unknown requestId fulfillment", async function () {
            const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
            await expect(
                mockRouter.simulateFulfillment(fakeId, "0x", "0x")
            ).to.be.reverted;
        });
    });

    // ═══════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════

    describe("Events", function () {
        beforeEach(deploy);

        it("should emit BountyMatchRequested and BountyMatchCompleted", async function () {
            const hash = leadIdHash("lead-events");
            const args = buildArgs({ leadId: "lead-events" });

            const tx = await matcher.requestBountyMatch(hash, args);
            await expect(tx).to.emit(matcher, "BountyMatchRequested");

            const receipt = await tx.wait();
            const requestId = receipt.logs.find(
                (l: any) => l.fragment?.name === "BountyMatchRequested"
            ).args[1];

            const response = encodeMatchResponse(["pool-ev"]);
            const fulfillTx = await mockRouter.simulateFulfillment(
                requestId,
                response,
                "0x"
            );

            // BountyMatchCompleted should be emitted from matcher
            const fulfillReceipt = await fulfillTx.wait();
            const completedLog = fulfillReceipt.logs.find((l: any) => {
                try {
                    const parsed = matcher.interface.parseLog({
                        topics: l.topics,
                        data: l.data,
                    });
                    return parsed?.name === "BountyMatchCompleted";
                } catch {
                    return false;
                }
            });
            expect(completedLog).to.not.be.undefined;
        });
    });
});
