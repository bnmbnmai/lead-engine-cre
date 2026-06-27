import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ACECompliance, ACELeadPolicy, LeadNFTv2 } from "../typechain-types";

/**
 * Wired-ACE integration test (Phase A5).
 *
 * Exercises the FULL enforcement path the deploy script wires up:
 *   LeadNFTv2.mintLead()/transferFrom()
 *     → PolicyProtectedUpgradeable._runPolicy()
 *     → ACELeadPolicy.run(Payload)            (direct-call engine bridge)
 *     → ACECompliance.isCompliant(caller)
 *
 * Regression coverage for two audit findings:
 *   1. ACECompliance previously lacked isCompliant(address) — the policy
 *      reverted on every gated call.
 *   2. ACELeadPolicy previously lacked the run(Payload) engine entry point —
 *      direct-call mode reverted with an unknown selector.
 */
describe("ACE wired enforcement (LeadNFTv2 + ACELeadPolicy + ACECompliance)", function () {
    let ace: ACECompliance;
    let policy: ACELeadPolicy;
    let leadNFT: LeadNFTv2;
    let owner: SignerWithAddress;
    let compliantMinter: SignerWithAddress;
    let nonCompliantMinter: SignerWithAddress;
    let buyer: SignerWithAddress;

    const vertical = ethers.keccak256(ethers.toUtf8Bytes("solar"));
    const geoHash = ethers.keccak256(ethers.toUtf8Bytes("US-CA"));
    const piiHash = ethers.keccak256(ethers.toUtf8Bytes("pii"));
    const proofHash = ethers.keccak256(ethers.toUtf8Bytes("kyc-proof"));

    function mintArgs(platformLeadId: string) {
        return [
            ethers.keccak256(ethers.toUtf8Bytes(platformLeadId)),
            vertical,
            geoHash,
            piiHash,
            ethers.parseUnits("25", 6),
            Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
            0, // LeadSource
            true, // tcpaConsent
            "ipfs://lead-meta",
        ] as const;
    }

    beforeEach(async function () {
        [owner, compliantMinter, nonCompliantMinter, buyer] = await ethers.getSigners();

        const ACEFactory = await ethers.getContractFactory("ACECompliance");
        ace = await ACEFactory.deploy(owner.address);
        await ace.waitForDeployment();

        const PolicyFactory = await ethers.getContractFactory("ACELeadPolicy");
        policy = await PolicyFactory.deploy(
            ethers.ZeroAddress, // direct-call mode
            owner.address,
            await ace.getAddress(),
        );
        await policy.waitForDeployment();

        const NFTFactory = await ethers.getContractFactory("LeadNFTv2");
        leadNFT = await NFTFactory.deploy(owner.address, await policy.getAddress());
        await leadNFT.waitForDeployment();

        await leadNFT.setAuthorizedMinter(compliantMinter.address, true);
        await leadNFT.setAuthorizedMinter(nonCompliantMinter.address, true);

        // KYC-approve the compliant minter and the buyer
        await ace.verifyKYC(compliantMinter.address, proofHash, "0x");
        await ace.verifyKYC(buyer.address, proofHash, "0x");
    });

    describe("isCompliant(address)", function () {
        it("returns true for a KYC-approved user", async function () {
            expect(await ace.isCompliant(compliantMinter.address)).to.equal(true);
        });

        it("returns false for an unverified user", async function () {
            expect(await ace.isCompliant(nonCompliantMinter.address)).to.equal(false);
        });

        it("returns false for a blacklisted user even with valid KYC", async function () {
            await ace.blacklistUser(compliantMinter.address, ethers.keccak256(ethers.toUtf8Bytes("fraud")));
            expect(await ace.isCompliant(compliantMinter.address)).to.equal(false);
        });

        it("returns false when reputation drops below the minimum", async function () {
            await ace.updateReputationScore(compliantMinter.address, -4500); // 5000 → 500 < 1000 min
            expect(await ace.isCompliant(compliantMinter.address)).to.equal(false);
        });

        it("returns false when the user's jurisdiction is blocked", async function () {
            const ru = ethers.keccak256(ethers.toUtf8Bytes("RU"));
            await ace.setUserJurisdiction(compliantMinter.address, ru);
            await ace.setBlockedJurisdiction(ru, true);
            expect(await ace.isCompliant(compliantMinter.address)).to.equal(false);
        });
    });

    describe("run(Payload) engine bridge", function () {
        it("allows a compliant sender", async function () {
            await expect(
                policy.run({
                    selector: "0x12345678",
                    sender: compliantMinter.address,
                    data: "0x",
                    context: "0x",
                }),
            ).to.not.be.reverted;
        });

        it("rejects a non-compliant sender with PolicyRejected", async function () {
            await expect(
                policy.run({
                    selector: "0x12345678",
                    sender: nonCompliantMinter.address,
                    data: "0x",
                    context: "0x",
                }),
            ).to.be.revertedWithCustomError(policy, "PolicyRejected");
        });
    });

    describe("LeadNFTv2 gated mint", function () {
        it("lets a compliant authorized minter mint", async function () {
            await expect(
                leadNFT.connect(compliantMinter).mintLead(compliantMinter.address, ...mintArgs("lead-1")),
            ).to.emit(leadNFT, "LeadMinted");
        });

        it("blocks a non-compliant minter with PolicyRejected", async function () {
            await expect(
                leadNFT.connect(nonCompliantMinter).mintLead(nonCompliantMinter.address, ...mintArgs("lead-2")),
            ).to.be.revertedWithCustomError(policy, "PolicyRejected");
        });

        it("blocks a minter who becomes blacklisted after KYC", async function () {
            await ace.blacklistUser(compliantMinter.address, ethers.keccak256(ethers.toUtf8Bytes("fraud")));
            await expect(
                leadNFT.connect(compliantMinter).mintLead(compliantMinter.address, ...mintArgs("lead-3")),
            ).to.be.revertedWithCustomError(policy, "PolicyRejected");
        });
    });

    describe("LeadNFTv2 gated transfer", function () {
        it("allows transfer initiated by a compliant holder", async function () {
            await leadNFT.connect(compliantMinter).mintLead(compliantMinter.address, ...mintArgs("lead-4"));
            await expect(
                leadNFT.connect(compliantMinter).transferFrom(compliantMinter.address, buyer.address, 1),
            ).to.not.be.reverted;
            expect(await leadNFT.ownerOf(1)).to.equal(buyer.address);
        });

        it("blocks transfer when the holder loses compliance", async function () {
            await leadNFT.connect(compliantMinter).mintLead(compliantMinter.address, ...mintArgs("lead-5"));
            await ace.blacklistUser(compliantMinter.address, ethers.keccak256(ethers.toUtf8Bytes("fraud")));
            await expect(
                leadNFT.connect(compliantMinter).transferFrom(compliantMinter.address, buyer.address, 1),
            ).to.be.revertedWithCustomError(policy, "PolicyRejected");
        });
    });

    describe("no engine attached (pass-through)", function () {
        it("mints without compliance checks when policyEngine = address(0)", async function () {
            const NFTFactory = await ethers.getContractFactory("LeadNFTv2");
            const openNFT = await NFTFactory.deploy(owner.address, ethers.ZeroAddress);
            await openNFT.waitForDeployment();
            await openNFT.setAuthorizedMinter(nonCompliantMinter.address, true);

            await expect(
                openNFT.connect(nonCompliantMinter).mintLead(nonCompliantMinter.address, ...mintArgs("lead-6")),
            ).to.emit(openNFT, "LeadMinted");
        });
    });
});
