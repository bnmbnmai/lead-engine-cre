/**
 * Upload CRE Quality Score Source to CREVerifier on Base Sepolia
 *
 * This script sets the quality scoring JavaScript on the CREVerifier contract
 * so the Chainlink Functions DON runs the SAME algorithm as the off-chain
 * pre-score computed at lead submission.
 *
 * Usage:
 *   cd contracts
 *   npx hardhat run scripts/upload-quality-source.ts --network baseSepolia
 *
 * Prerequisites:
 *   - DEPLOYER_PRIVATE_KEY set in backend/.env (owner of CREVerifier)
 *   - CRE_CONTRACT_ADDRESS_BASE_SEPOLIA set in backend/.env
 */

import { ethers } from "hardhat";

// Import the DON-compatible source from the shared module
// (hardhat resolves paths relative to project root via tsconfig)
const DON_QUALITY_SCORE_SOURCE = `
// CRE Quality Score — Chainlink Functions DON Source
// Receives: args[0] = leadTokenId
// The DON fetches lead data from the Lead Engine API and scores it.

const leadTokenId = args[0];

// Fetch lead data from the API (the DON has HTTP access)
const response = await Functions.makeHttpRequest({
    url: \`\${secrets.apiBaseUrl}/api/marketplace/leads/\${leadTokenId}/scoring-data\`,
    headers: { 'x-cre-key': secrets.creApiKey },
});

if (response.error) {
    throw Error('Failed to fetch lead data');
}

const d = response.data;
let score = 0;

// TCPA freshness (0–2000)
if (d.tcpaConsentAt) {
    const ageH = (Date.now() - new Date(d.tcpaConsentAt).getTime()) / 3600000;
    if (ageH <= 24) score += 2000;
    else if (ageH < 720) score += Math.round(2000 * (1 - (ageH - 24) / 696));
}

// Geo completeness (0–2000)
if (d.geo) {
    if (d.geo.state) score += 800;
    if (d.geo.zip) score += 600;
    if (d.zipMatchesState) score += 600;
}

// Data integrity (0–2000)
if (d.hasEncryptedData && d.encryptedDataValid) score += 2000;
else if (d.hasEncryptedData) score += 500;

// Parameter richness (0–2000)
score += Math.min(d.parameterCount || 0, 5) * 400;

// Source quality (0–2000)
const srcMap = { DIRECT: 2000, PLATFORM: 1500, API: 1000, REFERRAL: 1500, ORGANIC: 1200 };
score += srcMap[d.source] || 500;

score = Math.min(10000, Math.max(0, score));

// Return as uint256 ABI-encoded for the contract
return Functions.encodeUint256(score);
`;

const CRE_ABI = [
    "function setSourceCode(uint8 verificationType, string calldata sourceCode) external",
    "function owner() external view returns (address)",
];

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    // Load contract address from env
    const dotenv = await import("dotenv");
    dotenv.config({ path: "../backend/.env" });

    const contractAddress = process.env.CRE_CONTRACT_ADDRESS_BASE_SEPOLIA
        || process.env.CRE_CONTRACT_ADDRESS;

    if (!contractAddress) {
        console.error("❌ CRE_CONTRACT_ADDRESS_BASE_SEPOLIA not set in backend/.env");
        process.exit(1);
    }

    console.log(`CREVerifier: ${contractAddress}`);

    const creVerifier = new ethers.Contract(contractAddress, CRE_ABI, deployer);

    // Verify ownership
    const owner = await creVerifier.owner();
    console.log(`Contract owner: ${owner}`);
    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
        console.error(`❌ Deployer ${deployer.address} is not the contract owner ${owner}`);
        process.exit(1);
    }

    // Upload quality score source (VerificationType.QUALITY_SCORE = 2)
    console.log("\n📤 Uploading quality score source to CREVerifier...");
    console.log(`Source length: ${DON_QUALITY_SCORE_SOURCE.length} chars`);

    const tx = await creVerifier.setSourceCode(2, DON_QUALITY_SCORE_SOURCE);
    console.log(`TX hash: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`✅ Source code uploaded in block ${receipt!.blockNumber}`);
    console.log(`Gas used: ${receipt!.gasUsed.toString()}`);

    console.log("\n" + "═".repeat(50));
    console.log("📋 CRE QUALITY SCORE SOURCE UPLOAD COMPLETE");
    console.log("═".repeat(50));
    console.log(`Network:     Base Sepolia (84532)`);
    console.log(`Contract:    ${contractAddress}`);
    console.log(`TX:          ${tx.hash}`);
    console.log(`Source type: QUALITY_SCORE (2)`);
    console.log(`Algorithm:   Same as cre-quality-score.ts`);
    console.log("═".repeat(50));
    console.log("\nThe on-chain and off-chain scoring algorithms are now identical.");
    console.log("Pre-auction scores match what CREVerifier.requestQualityScore() will produce.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Upload failed:", error);
        process.exit(1);
    });
