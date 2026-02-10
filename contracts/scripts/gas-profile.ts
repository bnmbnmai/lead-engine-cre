/**
 * Gas Profiling Script
 * 
 * Measures gas costs for key contract operations on a local Hardhat network.
 * Run: npx hardhat run scripts/gas-profile.ts --network localhost
 */

import { ethers } from 'hardhat';

interface GasResult {
    operation: string;
    gasUsed: bigint;
    estimatedETH: string;
    estimatedUSD: string;
}

async function main() {
    console.log('\n╔═══════════════════════════════════════════╗');
    console.log('║       Gas Profiling — Lead Engine CRE     ║');
    console.log('╚═══════════════════════════════════════════╝\n');

    const [deployer, buyer, seller] = await ethers.getSigners();
    const results: GasResult[] = [];

    // Assumed ETH price for USD estimation
    const ETH_PRICE_USD = 2500;
    const GAS_PRICE_GWEI = 30n;

    function estimateUSD(gasUsed: bigint): string {
        const ethCost = Number(gasUsed * GAS_PRICE_GWEI) / 1e9;
        return `$${(ethCost * ETH_PRICE_USD).toFixed(4)}`;
    }

    function estimateETH(gasUsed: bigint): string {
        const ethCost = Number(gasUsed * GAS_PRICE_GWEI) / 1e9;
        return `${ethCost.toFixed(6)} ETH`;
    }

    try {
        // ─── Deploy Contracts ────────────────────
        console.log('Deploying contracts...\n');

        // Mock USDC
        const MockUSDC = await ethers.getContractFactory('MockERC20');
        const usdc = await MockUSDC.deploy('Mock USDC', 'USDC', 6);
        await usdc.waitForDeployment();

        // ACECompliance
        const ACE = await ethers.getContractFactory('ACECompliance');
        const ace = await ACE.deploy();
        await ace.waitForDeployment();

        // LeadNFTv2
        const LeadNFT = await ethers.getContractFactory('LeadNFTv2');
        const nft = await LeadNFT.deploy(await ace.getAddress());
        await nft.waitForDeployment();

        // RTBEscrow
        const Escrow = await ethers.getContractFactory('RTBEscrow');
        const escrow = await Escrow.deploy(
            await usdc.getAddress(),
            await ace.getAddress(),
            500 // 5% fee
        );
        await escrow.waitForDeployment();

        console.log('Contracts deployed. Starting gas measurements...\n');

        // ─── Profile: ACE Operations ─────────────

        // KYC Verification
        const kycTx = await ace.verifyKYC(buyer.address, ethers.keccak256(ethers.toUtf8Bytes('kyc-proof')));
        const kycReceipt = await kycTx.wait();
        results.push({
            operation: 'ACE: verifyKYC',
            gasUsed: kycReceipt!.gasUsed,
            estimatedETH: estimateETH(kycReceipt!.gasUsed),
            estimatedUSD: estimateUSD(kycReceipt!.gasUsed),
        });

        // Update Reputation
        const repTx = await ace.updateReputationScore(seller.address, 100);
        const repReceipt = await repTx.wait();
        results.push({
            operation: 'ACE: updateReputation',
            gasUsed: repReceipt!.gasUsed,
            estimatedETH: estimateETH(repReceipt!.gasUsed),
            estimatedUSD: estimateUSD(repReceipt!.gasUsed),
        });

        // ─── Profile: LeadNFT Operations ─────────

        // Mint Lead
        const mintTx = await nft.mintLead(
            seller.address,
            ethers.keccak256(ethers.toUtf8Bytes('lead-data')),
            'solar',
            ethers.encodeBytes32String('FL'),
            5000
        );
        const mintReceipt = await mintTx.wait();
        results.push({
            operation: 'NFT: mintLead',
            gasUsed: mintReceipt!.gasUsed,
            estimatedETH: estimateETH(mintReceipt!.gasUsed),
            estimatedUSD: estimateUSD(mintReceipt!.gasUsed),
        });

        // Record Sale
        const tokenId = 1; // First minted token
        const saleTx = await nft.recordSale(tokenId, buyer.address, ethers.parseUnits('35', 6));
        const saleReceipt = await saleTx.wait();
        results.push({
            operation: 'NFT: recordSale',
            gasUsed: saleReceipt!.gasUsed,
            estimatedETH: estimateETH(saleReceipt!.gasUsed),
            estimatedUSD: estimateUSD(saleReceipt!.gasUsed),
        });

        // ─── Profile: RTBEscrow Operations ───────

        // Mint USDC to buyer
        await usdc.mint(buyer.address, ethers.parseUnits('1000', 6));
        await usdc.connect(buyer).approve(await escrow.getAddress(), ethers.parseUnits('1000', 6));

        // Create Escrow
        const createTx = await escrow.connect(buyer).createEscrow(
            seller.address,
            ethers.parseUnits('35', 6),
            1 // tokenId
        );
        const createReceipt = await createTx.wait();
        results.push({
            operation: 'Escrow: createEscrow',
            gasUsed: createReceipt!.gasUsed,
            estimatedETH: estimateETH(createReceipt!.gasUsed),
            estimatedUSD: estimateUSD(createReceipt!.gasUsed),
        });

        // Release Escrow
        const releaseTx = await escrow.releaseEscrow(0); // escrowId = 0
        const releaseReceipt = await releaseTx.wait();
        results.push({
            operation: 'Escrow: releaseEscrow',
            gasUsed: releaseReceipt!.gasUsed,
            estimatedETH: estimateETH(releaseReceipt!.gasUsed),
            estimatedUSD: estimateUSD(releaseReceipt!.gasUsed),
        });

        // ─── Output Results ──────────────────────

        console.log('┌────────────────────────────┬────────────┬─────────────────┬────────────┐');
        console.log('│ Operation                  │ Gas Used   │ Est. ETH        │ Est. USD   │');
        console.log('├────────────────────────────┼────────────┼─────────────────┼────────────┤');

        for (const r of results) {
            const op = r.operation.padEnd(26);
            const gas = r.gasUsed.toString().padStart(10);
            const eth = r.estimatedETH.padStart(15);
            const usd = r.estimatedUSD.padStart(10);
            console.log(`│ ${op} │ ${gas} │ ${eth} │ ${usd} │`);
        }

        console.log('└────────────────────────────┴────────────┴─────────────────┴────────────┘');

        // Total
        const totalGas = results.reduce((sum, r) => sum + r.gasUsed, 0n);
        console.log(`\nTotal gas for full lifecycle: ${totalGas} (${estimateUSD(totalGas)} at ${GAS_PRICE_GWEI} gwei)`);
        console.log('');

    } catch (error: any) {
        console.error('Gas profiling failed:', error.message);
        console.log('\nPartial results:');
        results.forEach(r => console.log(`  ${r.operation}: ${r.gasUsed} gas (${r.estimatedUSD})`));
        process.exitCode = 1;
    }
}

main().catch(console.error);
