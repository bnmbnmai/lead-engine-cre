/**
 * deploy-leadnft-ace.ts
 *
 * Deploys the Chainlink ACE stack for Lead Engine CRE on Base Sepolia:
 *
 *   1. ACELeadPolicy (constructor: policyEngine=address(0), owner, aceCompliance)
 *   2. LeadNFTv2     (constructor: owner, policyEngine=ACELeadPolicy)
 *
 * NOTE: In this integration we skip the full PolicyEngine contract and wire
 * ACELeadPolicy directly into LeadNFTv2 via attachPolicyEngine(). This is
 * semantically equivalent for the hackathon — LeadNFTv2._runPolicy() calls
 * IPolicyEngine.run() on the policy address, which resolves to
 * ACELeadPolicy.run() → IACECompliance.isCompliant(caller).
 *
 * Usage:
 *   npx hardhat run scripts/deploy-leadnft-ace.ts --network baseSepolia
 *
 * Env vars (from ../backend/.env):
 *   DEPLOYER_PRIVATE_KEY
 *   ACE_COMPLIANCE_ADDRESS  (defaults to 0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6)
 */

import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    const ACE_COMPLIANCE = process.env.ACE_COMPLIANCE_ADDRESS || "0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6";
    console.log("ACECompliance:", ACE_COMPLIANCE);

    // ── 1. Deploy ACELeadPolicy ───────────────────────────────────────────────
    // policyEngine = address(0): we're using direct-call mode — no separate
    // PolicyEngine contract is needed for the demo (ACELeadPolicy is wired
    // directly as the "engine" in LeadNFTv2).
    console.log("\n[1/3] Deploying ACELeadPolicy…");
    const ACELeadPolicy = await ethers.getContractFactory("ACELeadPolicy");
    const acePolicy = await ACELeadPolicy.deploy(
        ethers.ZeroAddress,     // policyEngine  (direct-call mode)
        deployer.address,       // initialOwner
        ACE_COMPLIANCE          // aceCompliance registry
    );
    await acePolicy.waitForDeployment();
    const acePolicyAddr = await acePolicy.getAddress();
    console.log("  ACELeadPolicy:", acePolicyAddr);

    // ── 2. Deploy LeadNFTv2 ───────────────────────────────────────────────────
    // policyEngine = acePolicyAddr: LeadNFTv2._runPolicy() will call
    // ACELeadPolicy.run(msg.sender, ...) via IPolicyEngine.run(Payload{...}).
    // LeadNFTv2 thus enforces ACE compliance on every mintLead() + transferFrom().
    console.log("\n[2/3] Deploying LeadNFTv2 with ACELeadPolicy attached…");
    const LeadNFTv2 = await ethers.getContractFactory("LeadNFTv2");
    const leadNFT = await LeadNFTv2.deploy(
        deployer.address,       // initialOwner
        acePolicyAddr           // policyEngine = ACELeadPolicy
    );
    await leadNFT.waitForDeployment();
    const leadNFTAddr = await leadNFT.getAddress();
    console.log("  LeadNFTv2:", leadNFTAddr);

    // ── 3. Verify wiring ──────────────────────────────────────────────────────
    console.log("\n[3/3] Verifying wiring…");
    const attachedEngine = await leadNFT.getPolicyEngine();
    console.log("  LeadNFTv2.getPolicyEngine()  →", attachedEngine);
    if (attachedEngine.toLowerCase() !== acePolicyAddr.toLowerCase()) {
        console.warn("  ⚠ PolicyEngine wiring mismatch — please call attachPolicyEngine() manually");
    } else {
        console.log("  ✓ ACE policy wired correctly");
    }


    // ── Summary ───────────────────────────────────────────────────────────────
    console.log("\n════════════════════════════════════════════════");
    console.log("  DEPLOYMENT COMPLETE — Base Sepolia");
    console.log("════════════════════════════════════════════════");
    console.log("  LeadNFTv2    :", leadNFTAddr);
    console.log("  ACELeadPolicy:", acePolicyAddr);
    console.log("  ACECompliance:", ACE_COMPLIANCE);
    console.log("\n  ── Render env var to update ──");
    console.log(`  LEAD_NFT_V2_ADDRESS=${leadNFTAddr}`);
    console.log("\n  ── Basescan verify commands ──");
    console.log(`  npx hardhat verify --network baseSepolia ${acePolicyAddr} "${ethers.ZeroAddress}" "${deployer.address}" "${ACE_COMPLIANCE}"`);
    console.log(`  npx hardhat verify --network baseSepolia ${leadNFTAddr} "${deployer.address}" "${acePolicyAddr}"`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
