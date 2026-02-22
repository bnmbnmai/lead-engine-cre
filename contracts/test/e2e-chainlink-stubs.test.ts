/**
 * E2E Chainlink Stubs Test
 *
 * Tests CREVerifier with a MockFunctionsRouter that simulates
 * Chainlink Functions callbacks. Exercises parameter matching,
 * geo validation, quality scoring, batch operations, and error paths.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CREVerifier, LeadNFTv2 } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("E2E Chainlink Stubs — CREVerifier", function () {
    let deployer: SignerWithAddress;
    let seller: SignerWithAddress;
    let verifier: SignerWithAddress;

    let leadNFT: LeadNFTv2;
    let creVerifier: CREVerifier;
    let mockRouter: any; // MockFunctionsRouter

    const vertical = ethers.keccak256(ethers.toUtf8Bytes("solar"));
    const geoHash = ethers.keccak256(ethers.toUtf8Bytes("9q"));
    const piiHash = ethers.keccak256(ethers.toUtf8Bytes("chainlink_pii"));
    const reservePrice = ethers.parseUnits("50", 6);
    const donId = ethers.encodeBytes32String("fun-ethereum-sepolia-1");
    const subscriptionId = 1234n;

    async function deployStack() {
        [deployer, seller, verifier] = await ethers.getSigners();

        // Deploy LeadNFTv2
        const NFT = await ethers.getContractFactory("LeadNFTv2");
        leadNFT = await NFT.deploy(deployer.address, ethers.ZeroAddress);
        await leadNFT.waitForDeployment();
        await leadNFT.setAuthorizedMinter(deployer.address, true);

        // Deploy MockFunctionsRouter
        const Router = await ethers.getContractFactory("MockFunctionsRouter");
        mockRouter = await Router.deploy();
        await mockRouter.waitForDeployment();

        // Deploy CREVerifier with mock router
        const CRE = await ethers.getContractFactory("CREVerifier");
        creVerifier = await CRE.deploy(
            await mockRouter.getAddress(),
            donId,
            subscriptionId,
            await leadNFT.getAddress(),
            deployer.address
        );
        await creVerifier.waitForDeployment();

        // Set source code for each verification type
        const paramSource = `
            const leadId = args[0];
            const vertical = args[1];
            return Functions.encodeString(JSON.stringify({match: true, score: 8500}));
        `;
        const geoSource = `
            const leadId = args[0];
            return Functions.encodeString(JSON.stringify({valid: true, precision: 6}));
        `;
        const qualitySource = `
            const leadId = args[0];
            return Functions.encodeString(JSON.stringify({score: 7800}));
        `;

        const zkSource = `
            const tokenId = args[0];
            const proof = args[1];
            return Functions.encodeString(JSON.stringify({verified: true, tokenId: tokenId}));
        `;

        await creVerifier.setSourceCode(0, paramSource);   // PARAMETER_MATCH
        await creVerifier.setSourceCode(1, geoSource);      // GEO_VALIDATION
        await creVerifier.setSourceCode(2, qualitySource);  // QUALITY_SCORE
        await creVerifier.setSourceCode(3, zkSource);       // ZK_PROOF
    }

    async function mintTestLead() {
        const id = ethers.keccak256(ethers.toUtf8Bytes(`cl_lead_${Date.now()}_${Math.random()}`));
        const expiry = (await time.latest()) + 86400 * 7;
        await leadNFT.mintLead(seller.address, id, vertical, geoHash, piiHash, reservePrice, expiry, 0, true, "ipfs://chainlink");
        return await leadNFT.totalSupply();
    }

    // ═══════════════════════════════════════════
    // Parameter Match
    // ═══════════════════════════════════════════

    describe("Parameter Match Verification", function () {
        beforeEach(deployStack);

        it("should request and fulfill parameter match", async function () {
            const tokenId = await mintTestLead();

            const buyerParams = {
                vertical: vertical,
                geoHash: geoHash,
                minBudget: ethers.parseUnits("20", 6),
                maxBudget: ethers.parseUnits("200", 6),
                acceptOffsite: true,
                requiredAttributes: [],
            };

            // Request parameter match
            const tx = await creVerifier.requestParameterMatch(tokenId, buyerParams);
            const receipt = await tx.wait();

            // Extract requestId from event
            const event = receipt!.logs.find((log: any) => {
                try {
                    return creVerifier.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "VerificationRequested";
                } catch { return false; }
            });
            const parsed = creVerifier.interface.parseLog({
                topics: event!.topics as string[],
                data: event!.data,
            });
            const requestId = parsed!.args.requestId;

            expect(requestId).to.not.equal(ethers.ZeroHash);

            // Verify request is in PENDING state
            const req = await creVerifier.getVerificationResult(requestId);
            expect(req.status).to.equal(0); // PENDING

            // Simulate Chainlink fulfillment
            const responseBytes = ethers.toUtf8Bytes(JSON.stringify({ match: true, score: 8500 }));
            await mockRouter.simulateFulfillment(requestId, responseBytes, "0x");

            // Verify result
            const result = await creVerifier.getVerificationResult(requestId);
            expect(result.status).to.equal(1); // FULFILLED
            expect(result.fulfilledAt).to.be.gt(0);
        });
    });

    // ═══════════════════════════════════════════
    // Geo Validation
    // ═══════════════════════════════════════════

    describe("Geo Validation", function () {
        beforeEach(deployStack);

        it("should validate geo hash with precision", async function () {
            const tokenId = await mintTestLead();

            const tx = await creVerifier.requestGeoValidation(tokenId, geoHash, 6);
            const receipt = await tx.wait();

            const event = receipt!.logs.find((log: any) => {
                try {
                    return creVerifier.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "VerificationRequested";
                } catch { return false; }
            });
            const requestId = creVerifier.interface.parseLog({
                topics: event!.topics as string[],
                data: event!.data,
            })!.args.requestId;

            // Fulfill with success
            const response = ethers.toUtf8Bytes(JSON.stringify({ valid: true, precision: 6 }));
            await mockRouter.simulateFulfillment(requestId, response, "0x");

            const result = await creVerifier.getVerificationResult(requestId);
            expect(result.status).to.equal(1); // FULFILLED
            expect(result.resultHash).to.not.equal(ethers.ZeroHash);
        });
    });

    // ═══════════════════════════════════════════
    // Quality Score
    // ═══════════════════════════════════════════

    describe("Quality Score", function () {
        beforeEach(deployStack);

        it("should request and store quality score", async function () {
            const tokenId = await mintTestLead();

            const tx = await creVerifier.requestQualityScore(tokenId);
            const receipt = await tx.wait();

            const event = receipt!.logs.find((log: any) => {
                try {
                    return creVerifier.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "VerificationRequested";
                } catch { return false; }
            });
            const requestId = creVerifier.interface.parseLog({
                topics: event!.topics as string[],
                data: event!.data,
            })!.args.requestId;

            // Encode quality score as uint16 (7800)
            const scoreBytes = ethers.AbiCoder.defaultAbiCoder().encode(["uint16"], [7800]);
            await mockRouter.simulateFulfillment(requestId, scoreBytes, "0x");

            // Score should be stored
            const score = await creVerifier.getLeadQualityScore(tokenId);
            expect(score).to.equal(7800);
        });
    });

    // ═══════════════════════════════════════════
    // Batch Operations
    // ═══════════════════════════════════════════

    describe("Batch Parameter Match", function () {
        beforeEach(deployStack);

        it("should batch-request parameter matches for multiple leads", async function () {
            const token1 = await mintTestLead();
            const token2 = await mintTestLead();
            const token3 = await mintTestLead();

            const buyerParams = {
                vertical,
                geoHash,
                minBudget: ethers.parseUnits("10", 6),
                maxBudget: ethers.parseUnits("500", 6),
                acceptOffsite: false,
                requiredAttributes: [],
            };

            const tx = await creVerifier.batchRequestParameterMatch(
                [token1, token2, token3],
                buyerParams
            );
            const receipt = await tx.wait();

            // Should emit 3 VerificationRequested events
            const events = receipt!.logs.filter((log: any) => {
                try {
                    return creVerifier.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "VerificationRequested";
                } catch { return false; }
            });
            expect(events.length).to.equal(3);
        });
    });

    // ═══════════════════════════════════════════
    // Error Handling
    // ═══════════════════════════════════════════

    describe("Error Handling", function () {
        beforeEach(deployStack);

        it("should handle fulfillment with error bytes", async function () {
            const tokenId = await mintTestLead();

            const buyerParams = {
                vertical,
                geoHash,
                minBudget: 0n,
                maxBudget: ethers.parseUnits("1000", 6),
                acceptOffsite: true,
                requiredAttributes: [],
            };

            const tx = await creVerifier.requestParameterMatch(tokenId, buyerParams);
            const receipt = await tx.wait();

            const event = receipt!.logs.find((log: any) => {
                try {
                    return creVerifier.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "VerificationRequested";
                } catch { return false; }
            });
            const requestId = creVerifier.interface.parseLog({
                topics: event!.topics as string[],
                data: event!.data,
            })!.args.requestId;

            // Fulfill with ERROR (empty response, non-empty err)
            const errBytes = ethers.toUtf8Bytes("API timeout after 30s");
            await mockRouter.simulateFulfillment(requestId, "0x", errBytes);

            // Result should reflect error state
            const result = await creVerifier.getVerificationResult(requestId);
            expect(result.status).to.equal(2); // FAILED
        });

        it("should revert on unknown request fulfillment", async function () {
            const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake_request"));
            await expect(
                mockRouter.simulateFulfillment(fakeId, "0x", "0x")
            ).to.be.revertedWith("MockRouter: Unknown request");
        });

        it("should revert if source code not set", async function () {
            // Deploy fresh verifier without setting sources
            const CRE = await ethers.getContractFactory("CREVerifier");
            const freshVerifier = await CRE.deploy(
                await mockRouter.getAddress(),
                donId,
                subscriptionId,
                await leadNFT.getAddress(),
                deployer.address
            );

            const tokenId = await mintTestLead();

            await expect(
                freshVerifier.requestQualityScore(tokenId)
            ).to.be.revertedWith("CRE: Source not set");
        });
    });

    // ═══════════════════════════════════════════
    // ZK Proof Verification Stub
    // ═══════════════════════════════════════════

    describe("ZK Proof Verification", function () {
        beforeEach(deployStack);

        it("should process ZK proof verification request", async function () {
            const tokenId = await mintTestLead();
            const mockProof = ethers.toUtf8Bytes("mock_zk_proof_data");
            const publicInputs = [
                ethers.keccak256(ethers.toUtf8Bytes("input1")),
                ethers.keccak256(ethers.toUtf8Bytes("input2")),
            ];

            const tx = await creVerifier.requestZKProofVerification(
                tokenId,
                mockProof,
                publicInputs
            );
            const receipt = await tx.wait();

            await expect(tx).to.emit(creVerifier, "VerificationRequested");

            // ZK proofs use deterministic request IDs
            const events = receipt!.logs.filter((log: any) => {
                try {
                    return creVerifier.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "VerificationRequested";
                } catch { return false; }
            });
            expect(events.length).to.equal(1);
        });
    });
});
