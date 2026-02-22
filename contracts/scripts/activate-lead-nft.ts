// ============================================================================
// activate-lead-nft.ts — Post-deploy ACE + Royalties activation for LeadNFTv2
// ============================================================================
// Standalone script — uses ethers directly (no Hardhat runtime required).
// Run with:  npx ts-node --skip-project scripts/activate-lead-nft.ts
// ============================================================================

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

const LEAD_NFT_ADDRESS = process.env.LEAD_NFT_CONTRACT_ADDRESS_BASE_SEPOLIA || '0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155';
const ACE_POLICY_ADDRESS = process.env.ACE_LEAD_POLICY_ADDRESS_BASE_SEPOLIA || '0x013f3219012030aC32cc293fB51a92eBf82a566F';
const TREASURY_ADDRESS = process.env.PAYMENT_RECIPIENT_ADDRESS || '0x6BBcf283847f409a58Ff984A79eFD5719D3A9F70';
const ROYALTY_BPS = 250; // 2.5%

const LEAD_NFT_ABI = [
    'function attachPolicyEngine(address policyEngine) external',
    'function setRoyaltyInfo(address receiver, uint96 feeNumerator) external',
    'function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address receiver, uint256 royaltyAmount)',
    'function policyEngine() view returns (address)',
    'function owner() view returns (address)',
];

async function main() {
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!privateKey) throw new Error('DEPLOYER_PRIVATE_KEY not set');

    const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org';

    console.log(`\n[activate-lead-nft] LeadNFTv2:      ${LEAD_NFT_ADDRESS}`);
    console.log(`[activate-lead-nft] ACELeadPolicy:  ${ACE_POLICY_ADDRESS}`);
    console.log(`[activate-lead-nft] Treasury:       ${TREASURY_ADDRESS}`);
    console.log(`[activate-lead-nft] Royalty:        ${ROYALTY_BPS} bps (${ROYALTY_BPS / 100}%)`);
    console.log(`[activate-lead-nft] Network:        ${rpcUrl}\n`);

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const nft = new ethers.Contract(LEAD_NFT_ADDRESS, LEAD_NFT_ABI, signer);

    console.log(`[activate-lead-nft] Signer: ${signer.address}`);
    const balance = await provider.getBalance(signer.address);
    console.log(`[activate-lead-nft] ETH balance: ${ethers.formatEther(balance)} ETH\n`);

    // Verify signer is owner
    const owner = await nft.owner();
    console.log(`[activate-lead-nft] Contract owner: ${owner}`);
    if (owner.toLowerCase() !== signer.address.toLowerCase()) {
        throw new Error(
            `Signer ${signer.address} is NOT the LeadNFTv2 owner (${owner}).\n` +
            'Set DEPLOYER_PRIVATE_KEY to the owner private key.',
        );
    }
    console.log(`[activate-lead-nft] ✓ Owner check passed\n`);

    // ── Step 1: attachPolicyEngine ─────────────────────────────────────────
    console.log(`[1/2] Calling attachPolicyEngine(${ACE_POLICY_ADDRESS})...`);
    const tx1 = await nft.attachPolicyEngine(ACE_POLICY_ADDRESS, { gasLimit: 200_000 });
    console.log(`  Submitted: ${tx1.hash}`);
    const r1 = await tx1.wait();
    console.log(`  ✓ Block ${r1.blockNumber}  gas=${r1.gasUsed}`);
    console.log(`  Basescan: https://sepolia.basescan.org/tx/${tx1.hash}`);

    const pe = await nft.policyEngine();
    if (pe.toLowerCase() === ACE_POLICY_ADDRESS.toLowerCase()) {
        console.log(`  ✓ Read-back policyEngine: ${pe}`);
    } else {
        console.warn(`  ⚠ policyEngine mismatch — got ${pe}, expected ${ACE_POLICY_ADDRESS}`);
    }

    // ── Step 2: setRoyaltyInfo ─────────────────────────────────────────────
    console.log(`\n[2/2] Calling setRoyaltyInfo(${TREASURY_ADDRESS}, ${ROYALTY_BPS})...`);
    const tx2 = await nft.setRoyaltyInfo(TREASURY_ADDRESS, ROYALTY_BPS, { gasLimit: 100_000 });
    console.log(`  Submitted: ${tx2.hash}`);
    const r2 = await tx2.wait();
    console.log(`  ✓ Block ${r2.blockNumber}  gas=${r2.gasUsed}`);
    console.log(`  Basescan: https://sepolia.basescan.org/tx/${tx2.hash}`);

    const [recv, amt] = await nft.royaltyInfo(0, 10000);
    if (recv.toLowerCase() === TREASURY_ADDRESS.toLowerCase() && Number(amt) === ROYALTY_BPS) {
        console.log(`  ✓ Read-back royaltyInfo: ${ROYALTY_BPS / 100}% → ${recv}`);
    } else {
        console.warn(`  ⚠ royaltyInfo mismatch — receiver=${recv} amount=${amt}`);
    }

    console.log('\n[activate-lead-nft] ✓ ACE + Royalties activated.\n');
}

main().catch((err) => {
    console.error('\n[activate-lead-nft] ✗ FAILED:', err.message || err);
    process.exit(1);
});
