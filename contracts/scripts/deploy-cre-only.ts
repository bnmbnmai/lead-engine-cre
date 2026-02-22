/**
 * deploy-cre-only.ts
 *
 * Targeted one-shot deploy of CREVerifier (with live ZK Functions support).
 * After deployment, atomically calls setSourceCode(ZK_PROOF, ...) to register
 * the Groth16/Plonk fraud-signal JS source on-chain.
 *
 * Use this when LeadNFTv2, RTBEscrow, and PersonalEscrowVault are already deployed.
 */
import { ethers } from "hardhat";

// ── Base Sepolia Chainlink Functions config ──────────────────────────────────
const FUNCTIONS_ROUTER = "0xf9B8fc078197181C841c296C876945aaa425B278";
const DON_ID_BYTES32 = "0x66756e2d626173652d7365706f6c69612d310000000000000000000000000000";
const SUBSCRIPTION_ID = 3063;     // Your CL Functions subscription on Base Sepolia
const LEAD_NFT_ADDRESS = "0x1eAe80ED100239dd4cb35008274eE62B1d5aC4e4";

// ── VerificationType enum values (mirrors ICREVerifier) ──────────────────────
const VT_ZK_PROOF = 3;

// ── Groth16/Plonk ZK fraud-signal source uploaded to the Functions DON ───────
//
// Args received from the contract: [tokenId, proofHex, publicInputsHex]
//
// Returns Functions.encodeUint256(1) → clean / Functions.encodeUint256(2) → fraud.
// The contract decodes this as uint8 (ABI-padded 32 bytes, value in last byte).
//
// PRODUCTION NOTE: replace the structural heuristic below with a call to a
// real Groth16 or Plonk verifier, e.g.:
//   const resp = await Functions.makeHttpRequest({ url: "https://your-zk-api/verify",
//     method: "POST", data: { proof: proofHex, publicInputs: publicInputsHex } });
//   return Functions.encodeUint256(resp.data.valid ? 1 : 2);
//
const ZK_PROOF_JS_SOURCE = `
// Live ZK fraud-signal verification via Chainlink Functions DON — 2026-02-21
// Args: [tokenId (decimal), proofHex (0x-prefixed), publicInputsHex (0x-prefixed)]
//
// PRODUCTION: replace the structural validation below with an HTTP call to a
// Groth16 / Plonk verifier service or on-chain eth_call to a verifier contract:
//   const r = await Functions.makeHttpRequest({
//     url: "https://your-zk-node/verify", method: "POST",
//     data: { proof: args[1], publicInputs: args[2] }
//   });
//   return Functions.encodeUint256(r.data.valid ? 1n : 2n);

const tokenId       = args[0];
const proofHex      = args[1];
const publicInputsHex = args[2];

// ── Structural validation ────────────────────────────────────────────────────
// Groth16 proof = 8 BN254 field elements × 32 bytes = 256 bytes → 512 hex chars
// Plonk  proof ≥ 768 bytes → ≥ 1536 hex chars
// Both arrive with "0x" prefix. Minimum honest proof: 64 hex chars (32 bytes).
const proofBody = proofHex.startsWith("0x") ? proofHex.slice(2) : proofHex;
const pubBody   = publicInputsHex.startsWith("0x") ? publicInputsHex.slice(2) : publicInputsHex;

if (proofBody.length < 64 || proofBody.length % 2 !== 0) {
  // Proof too short or misaligned — hard fraud signal
  return Functions.encodeUint256(2n);
}
if (pubBody.length < 64 || pubBody.length % 2 !== 0) {
  // Public inputs malformed
  return Functions.encodeUint256(2n);
}

// ── Byte-level checksum (XOR all proof bytes) ────────────────────────────────
// A real proof will have high entropy; all-zero or truncated proofs fail this.
let xorAccum = 0;
for (let i = 0; i < proofBody.length; i += 2) {
  xorAccum ^= parseInt(proofBody.slice(i, i + 2), 16);
}
if (xorAccum === 0) {
  // Zero-entropy proof — trivially invalid
  return Functions.encodeUint256(2n);
}

// ── Field-element boundary check (BN254 prime for Groth16) ──────────────────
// Each 64-hex-char chunk must be < BN254 prime p (simplified: first byte < 0x30)
const BN254_FIRST_BYTE_MAX = 0x30;
const isGroth16Size = proofBody.length === 512;
if (isGroth16Size) {
  for (let elem = 0; elem < 8; elem++) {
    const firstByte = parseInt(proofBody.slice(elem * 64, elem * 64 + 2), 16);
    if (firstByte >= BN254_FIRST_BYTE_MAX) {
      // Field element out of BN254 range — fraud signal
      return Functions.encodeUint256(2n);
    }
  }
}

// ── All structural checks passed → ZK proof is clean ────────────────────────
// In production, this line is replaced by an actual cryptographic verification.
return Functions.encodeUint256(1n);
`.trim();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
    console.log("Nonce (deploy slot):", await ethers.provider.getTransactionCount(deployer.address));

    // ── 1. Deploy CREVerifier ─────────────────────────────────────────────────
    console.log("\n📦 Deploying CREVerifier (with live ZK Functions)...");
    const CREVerifierFactory = await ethers.getContractFactory("CREVerifier");
    const cre = await CREVerifierFactory.deploy(
        FUNCTIONS_ROUTER,
        DON_ID_BYTES32,
        SUBSCRIPTION_ID,
        LEAD_NFT_ADDRESS,
        deployer.address   // initialOwner
    );
    await cre.waitForDeployment();
    const creAddr = await cre.getAddress();
    const creTx = cre.deploymentTransaction()!.hash;
    console.log("✅ CREVerifier:", creAddr, "  tx:", creTx);

    // ── 2. Register ZK proof source on-chain (atomic post-deploy) ────────────
    console.log("\n📝 Registering ZK proof source (setSourceCode ZK_PROOF)...");
    const setTx = await cre.setSourceCode(VT_ZK_PROOF, ZK_PROOF_JS_SOURCE);
    await setTx.wait();
    console.log("✅ ZK source registered  tx:", setTx.hash);
    console.log("   Source length (chars):", ZK_PROOF_JS_SOURCE.length);

    // ── Summary ───────────────────────────────────────────────────────────────
    const W = "═".repeat(60);
    console.log(`\n${W}`);
    console.log("📋 DEPLOYMENT SUMMARY — Base Sepolia");
    console.log(W);
    console.log(`CREVerifier           : ${creAddr}`);
    console.log(`CREVerifier TX        : ${creTx}`);
    console.log(`setSourceCode(ZK) TX  : ${setTx.hash}`);
    console.log(W);
    console.log(`\nRemaining ETH: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`);

    console.log(`\n🔍 Basescan Verify Command:\n`);
    console.log(
        `npx hardhat verify --network baseSepolia ${creAddr}` +
        ` "${FUNCTIONS_ROUTER}"` +
        ` "${DON_ID_BYTES32}"` +
        ` ${SUBSCRIPTION_ID}` +
        ` "${LEAD_NFT_ADDRESS}"` +
        ` "${deployer.address}"`
    );

    console.log(`\n📝 Update backend/.env:\n`);
    console.log(`CRE_CONTRACT_ADDRESS_BASE_SEPOLIA=${creAddr}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error.message ?? error);
        process.exit(1);
    });
