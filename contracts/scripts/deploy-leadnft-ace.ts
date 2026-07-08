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

    // Use an existing ACECompliance when provided; otherwise deploy a fresh
    // one. IMPORTANT: the registry MUST expose isCompliant(address) — older
    // deployments (pre-A5) lack it, which makes every gated mint/transfer
    // revert (fail-closed) once the policy is attached.
    let ACE_COMPLIANCE = process.env.ACE_COMPLIANCE_ADDRESS || "";
    if (ACE_COMPLIANCE) {
        const probe = new ethers.Contract(
            ACE_COMPLIANCE,
            ["function isCompliant(address) view returns (bool)"],
            deployer,
        );
        try {
            await probe.isCompliant(deployer.address);
            console.log("ACECompliance (existing):", ACE_COMPLIANCE);
        } catch {
            throw new Error(
                `ACECompliance at ${ACE_COMPLIANCE} does not implement isCompliant(address). ` +
                `Redeploy ACECompliance (unset ACE_COMPLIANCE_ADDRESS) or upgrade it first.`,
            );
        }
    } else {
        console.log("\n[0/3] No ACE_COMPLIANCE_ADDRESS set — deploying fresh ACECompliance…");
        const ACECompliance = await ethers.getContractFactory("ACECompliance");
        const ace = await ACECompliance.deploy(deployer.address);
        await ace.waitForDeployment();
        ACE_COMPLIANCE = await ace.getAddress();
        console.log("  ACECompliance:", ACE_COMPLIANCE);
    }

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
        console.log("  ✓ ACE policy attached");
    }

    // End-to-end smoke test of the engine entry point: exercise the exact
    // run(Payload) selector that LeadNFTv2._runPolicy() will call. A revert
    // with "function not found" here means the direct-call bridge is missing.
    const engineProbe = new ethers.Contract(
        acePolicyAddr,
        ["function run((bytes4 selector, address sender, bytes data, bytes context)) view"],
        deployer,
    );
    try {
        await engineProbe.run({ selector: "0x00000000", sender: deployer.address, data: "0x", context: "0x" });
        console.log("  ✓ run(Payload) reachable — deployer is compliant");
    } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (msg.includes("PolicyRejected") || msg.includes("not compliant")) {
            console.log("  ✓ run(Payload) reachable — deployer not yet compliant (expected before KYC)");
        } else {
            throw new Error(`ACELeadPolicy.run(Payload) wiring check failed: ${msg}`);
        }
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
