import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ACECompliance } from "../typechain-types";

describe("ACECompliance", function () {
    let aceCompliance: ACECompliance;
    let owner: SignerWithAddress;
    let verifier: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;

    const vertical = ethers.keccak256(ethers.toUtf8Bytes("solar"));
    const geoHashUS = ethers.keccak256(ethers.toUtf8Bytes("US"));
    const geoHashEU = ethers.keccak256(ethers.toUtf8Bytes("EU"));
    const blockedJurisdiction = ethers.keccak256(ethers.toUtf8Bytes("BLOCKED"));

    beforeEach(async function () {
        [owner, verifier, user1, user2] = await ethers.getSigners();

        const ACEFactory = await ethers.getContractFactory("ACECompliance");
        aceCompliance = await ACEFactory.deploy(owner.address);
        await aceCompliance.waitForDeployment();

        // Authorize verifier
        await aceCompliance.setAuthorizedVerifier(verifier.address, true);
    });

    describe("KYC Verification", function () {
        it("Should verify KYC for a user", async function () {
            const proofHash = ethers.keccak256(ethers.toUtf8Bytes("kyc_proof"));

            await expect(
                aceCompliance.connect(verifier).verifyKYC(user1.address, proofHash, "0x")
            ).to.emit(aceCompliance, "UserVerified");

            expect(await aceCompliance.isKYCValid(user1.address)).to.equal(true);
        });

        it("Should reject KYC verification from unauthorized caller", async function () {
            const proofHash = ethers.keccak256(ethers.toUtf8Bytes("kyc_proof"));

            await expect(
                aceCompliance.connect(user2).verifyKYC(user1.address, proofHash, "0x")
            ).to.be.revertedWith("ACE: Not authorized verifier");
        });

        it("Should return correct KYC status", async function () {
            // Before KYC
            expect(await aceCompliance.checkKYCStatus(user1.address)).to.equal(0);  // UNCHECKED

            // After KYC
            const proofHash = ethers.keccak256(ethers.toUtf8Bytes("kyc_proof"));
            await aceCompliance.connect(verifier).verifyKYC(user1.address, proofHash, "0x");

            expect(await aceCompliance.checkKYCStatus(user1.address)).to.equal(2);  // APPROVED
        });
    });

    describe("Jurisdictional Policies", function () {
        beforeEach(async function () {
            // Set up user with KYC and jurisdiction
            const proofHash = ethers.keccak256(ethers.toUtf8Bytes("kyc_proof"));
            await aceCompliance.connect(verifier).verifyKYC(user1.address, proofHash, "0x");
            await aceCompliance.connect(verifier).setUserJurisdiction(user1.address, geoHashUS);
        });

        it("Should allow transaction when policy permits", async function () {
            await aceCompliance.setJurisdictionPolicy(geoHashUS, vertical, true);

            expect(await aceCompliance.canTransact(user1.address, vertical, geoHashUS)).to.equal(true);
        });

        it("Should block transaction when jurisdiction is blocked", async function () {
            await aceCompliance.setBlockedJurisdiction(geoHashUS, true);

            expect(await aceCompliance.canTransact(user1.address, vertical, geoHashUS)).to.equal(false);
        });

        it("Should use default vertical policy as fallback", async function () {
            await aceCompliance.setDefaultVerticalPolicy(vertical, true);

            expect(await aceCompliance.isJurisdictionAllowed(geoHashUS, vertical)).to.equal(true);
        });
    });

    describe("Reputation System", function () {
        beforeEach(async function () {
            const proofHash = ethers.keccak256(ethers.toUtf8Bytes("kyc_proof"));
            await aceCompliance.connect(verifier).verifyKYC(user1.address, proofHash, "0x");
        });

        it("Should initialize reputation at 50%", async function () {
            expect(await aceCompliance.getReputationScore(user1.address)).to.equal(5000);
        });

        it("Should update reputation correctly", async function () {
            await aceCompliance.connect(verifier).updateReputationScore(user1.address, 500);
            expect(await aceCompliance.getReputationScore(user1.address)).to.equal(5500);

            await aceCompliance.connect(verifier).updateReputationScore(user1.address, -1000);
            expect(await aceCompliance.getReputationScore(user1.address)).to.equal(4500);
        });

        it("Should cap reputation at 0 and 10000", async function () {
            // Try to go below 0
            await aceCompliance.connect(verifier).updateReputationScore(user1.address, -6000);
            expect(await aceCompliance.getReputationScore(user1.address)).to.equal(0);

            // Reset and try to go above 10000
            await aceCompliance.connect(verifier).verifyKYC(user1.address,
                ethers.keccak256(ethers.toUtf8Bytes("kyc_proof2")), "0x");
            await aceCompliance.connect(verifier).updateReputationScore(user1.address, 6000);
            expect(await aceCompliance.getReputationScore(user1.address)).to.equal(10000);
        });
    });

    describe("Blacklisting", function () {
        beforeEach(async function () {
            const proofHash = ethers.keccak256(ethers.toUtf8Bytes("kyc_proof"));
            await aceCompliance.connect(verifier).verifyKYC(user1.address, proofHash, "0x");
            await aceCompliance.setDefaultVerticalPolicy(vertical, true);
        });

        it("Should blacklist user", async function () {
            const reason = ethers.keccak256(ethers.toUtf8Bytes("fraud"));

            await expect(aceCompliance.connect(verifier).blacklistUser(user1.address, reason))
                .to.emit(aceCompliance, "UserBlacklisted")
                .withArgs(user1.address, reason);

            expect(await aceCompliance.canTransact(user1.address, vertical, geoHashUS)).to.equal(false);
        });

        it("Should unblacklist user (owner only)", async function () {
            const reason = ethers.keccak256(ethers.toUtf8Bytes("fraud"));
            await aceCompliance.connect(verifier).blacklistUser(user1.address, reason);

            await aceCompliance.connect(owner).unblacklistUser(user1.address);

            expect(await aceCompliance.canTransact(user1.address, vertical, geoHashUS)).to.equal(true);
        });
    });

    describe("Full Compliance Check", function () {
        it("Should pass full compliance for valid users", async function () {
            const proofHash = ethers.keccak256(ethers.toUtf8Bytes("kyc_proof"));
            await aceCompliance.connect(verifier).verifyKYC(user1.address, proofHash, "0x");
            await aceCompliance.connect(verifier).verifyKYC(user2.address, proofHash, "0x");

            const result = await aceCompliance.checkFullCompliance(user1.address, user2.address, 1);
            expect(result.passed).to.equal(true);
        });

        it("Should fail compliance if seller is blacklisted", async function () {
            const proofHash = ethers.keccak256(ethers.toUtf8Bytes("kyc_proof"));
            await aceCompliance.connect(verifier).verifyKYC(user1.address, proofHash, "0x");
            await aceCompliance.connect(verifier).verifyKYC(user2.address, proofHash, "0x");

            await aceCompliance.connect(verifier).blacklistUser(user1.address,
                ethers.keccak256(ethers.toUtf8Bytes("fraud")));

            const result = await aceCompliance.checkFullCompliance(user1.address, user2.address, 1);
            expect(result.passed).to.equal(false);
            expect(result.failedCheck).to.equal(4);  // FRAUD
        });

        it("Should fail compliance if KYC not valid", async function () {
            // Only verify user1
            const proofHash = ethers.keccak256(ethers.toUtf8Bytes("kyc_proof"));
            await aceCompliance.connect(verifier).verifyKYC(user1.address, proofHash, "0x");

            const result = await aceCompliance.checkFullCompliance(user1.address, user2.address, 1);
            expect(result.passed).to.equal(false);
            expect(result.failedCheck).to.equal(0);  // KYC
        });
    });
});
