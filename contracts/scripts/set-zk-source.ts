/**
 * set-zk-source.ts
 * One-shot: registers the Groth16/Plonk ZK fraud-signal JS source on the
 * deployed CREVerifier. Run once after deploy-cre-only.ts if setSourceCode
 * was not confirmed atomically.
 */
import { ethers } from "hardhat";

const CRE_ADDRESS = "0xfec22A5159E077d7016AAb5fC3E91e0124393af8";
const VT_ZK_PROOF = 3;

// Mirrors exact source from deploy-cre-only.ts
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
  return Functions.encodeUint256(2n);
}
if (pubBody.length < 64 || pubBody.length % 2 !== 0) {
  return Functions.encodeUint256(2n);
}

// ── Byte-level checksum (XOR all proof bytes) ────────────────────────────────
let xorAccum = 0;
for (let i = 0; i < proofBody.length; i += 2) {
  xorAccum ^= parseInt(proofBody.slice(i, i + 2), 16);
}
if (xorAccum === 0) {
  return Functions.encodeUint256(2n);
}

// ── Field-element boundary check (BN254 prime for Groth16) ──────────────────
const BN254_FIRST_BYTE_MAX = 0x30;
const isGroth16Size = proofBody.length === 512;
if (isGroth16Size) {
  for (let elem = 0; elem < 8; elem++) {
    const firstByte = parseInt(proofBody.slice(elem * 64, elem * 64 + 2), 16);
    if (firstByte >= BN254_FIRST_BYTE_MAX) {
      return Functions.encodeUint256(2n);
    }
  }
}

return Functions.encodeUint256(1n);
`.trim();

const CRE_ABI = [
    "function setSourceCode(uint8 verificationType, string calldata sourceCode) external",
    "function getLeadQualityScore(uint256) view returns (uint16)"
];

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Caller:", deployer.address);
    const cre = new ethers.Contract(CRE_ADDRESS, CRE_ABI, deployer as any);

    console.log("\n📝 Calling setSourceCode(ZK_PROOF=3)...");
    const tx = await (cre as any).setSourceCode(VT_ZK_PROOF, ZK_PROOF_JS_SOURCE);
    await tx.wait();
    console.log("✅ ZK source registered  tx:", tx.hash);
    console.log("   Source length (chars):", ZK_PROOF_JS_SOURCE.length);
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
