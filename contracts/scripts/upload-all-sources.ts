// ============================================================================
// upload-all-sources.ts — Upload CREVerifier DON source programs
// ============================================================================
// Run: npx ts-node --transpile-only contracts/scripts/upload-all-sources.ts
//
// CREVerifier.setSourceCode(VerificationType, string) ABI:
//   enum VerificationType { PARAMETER_MATCH=0, GEO_VALIDATION=1, QUALITY_SCORE=2, ZK_PROOF=3 }
//   ✗ source fields are private — no getter exists; verify by checking event logs.
//
// Upload plan:
//   DON_QUALITY_SCORE_SOURCE → QUALITY_SCORE (2)
//   DON_BATCHED_PRIVATE_SCORE_SOURCE → GEO_VALIDATION (1)  [phase 2 batch path]
//   ZK_PROOF_DON_SOURCE → ZK_PROOF (3)
// ============================================================================

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

import { DON_QUALITY_SCORE_SOURCE } from '../../backend/src/lib/chainlink/cre-quality-score';
import { DON_BATCHED_PRIVATE_SCORE_SOURCE } from '../../backend/src/lib/chainlink/batched-private-score';
import { ZK_PROOF_DON_SOURCE } from '../../backend/src/lib/chainlink/zk-proof-source';

// ABI uses uint8 — ethers.js will encode VerificationType enum values as uint8
const CRE_ABI = [
    'function setSourceCode(uint8 verificationType, string calldata sourceCode) external',
    'event SourceCodeUpdated(uint8 verificationType)',
];

// VerificationType enum values from ICREVerifier.sol
const VT_PARAMETER_MATCH = 0;
const VT_GEO_VALIDATION = 1;
const VT_QUALITY_SCORE = 2;
const VT_ZK_PROOF = 3;

async function upload(
    contract: ethers.Contract,
    label: string,
    step: string,
    vt: number,
    source: string,
    nonce: number,
): Promise<string> {
    console.log(`\n[${step}] ${label} (VerificationType=${vt}):`);
    console.log(`  Source length: ${source.length} chars, nonce=${nonce}`);

    const tx = await contract.setSourceCode(vt, source, { gasLimit: 10_000_000, nonce });
    console.log(`  Submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    const status = receipt.status === 1 ? '✓' : '✗';
    console.log(`  ${status} Block ${receipt.blockNumber}  gas=${receipt.gasUsed}`);
    console.log(`  Basescan: https://sepolia.basescan.org/tx/${tx.hash}`);
    return tx.hash;
}

async function main() {
    const contractAddress = process.env.CRE_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.CRE_CONTRACT_ADDRESS;
    if (!contractAddress) throw new Error('CRE_CONTRACT_ADDRESS_BASE_SEPOLIA not set');

    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) throw new Error('DEPLOYER_PRIVATE_KEY not set');

    const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(contractAddress, CRE_ABI, signer);

    console.log(`\n[upload-all-sources] CREVerifier: ${contractAddress}`);
    console.log(`[upload-all-sources] Network:     ${rpcUrl}`);
    console.log(`[upload-all-sources] Signer:      ${signer.address}`);

    const balance = await provider.getBalance(signer.address);
    console.log(`[upload-all-sources] Balance:     ${ethers.formatEther(balance)} ETH`);

    const nonce = await provider.getTransactionCount(signer.address, 'pending');
    console.log(`[upload-all-sources] Nonce:       ${nonce}\n`);

    const tx1 = await upload(contract, 'Quality Score Source', '1/3', VT_QUALITY_SCORE, DON_QUALITY_SCORE_SOURCE, nonce);
    const tx2 = await upload(contract, 'Batched Private Score Source', '2/3', VT_GEO_VALIDATION, DON_BATCHED_PRIVATE_SCORE_SOURCE, nonce + 1);
    const tx3 = await upload(contract, 'ZK Proof Verifier Source', '3/3', VT_ZK_PROOF, ZK_PROOF_DON_SOURCE, nonce + 2);

    console.log('\n[upload-all-sources] ✓ All sources uploaded.\n');
    console.log('Summary of Basescan transactions:');
    console.log(`  Quality Score:   https://sepolia.basescan.org/tx/${tx1}`);
    console.log(`  Batched Score:   https://sepolia.basescan.org/tx/${tx2}`);
    console.log(`  ZK Proof:        https://sepolia.basescan.org/tx/${tx3}`);

    console.log('\nHardhat verify command:');
    console.log(`  npx hardhat verify --network baseSepolia ${contractAddress} \\`);
    console.log(`    "0xf9B8FC078197181C841c296C876945aaa425B278" \\`);
    console.log(`    "0x66756e2d626173652d7365706f6c69612d310000000000000000000000000000" \\`);
    console.log(`    581 \\`);
    console.log(`    "0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155" \\`);
    console.log(`    "0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70"`);
}

main().catch((err) => {
    console.error('\n[upload-all-sources] ✗ FAILED:', err.message || err);
    process.exit(1);
});
