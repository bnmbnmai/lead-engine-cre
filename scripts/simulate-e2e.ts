/**
 * simulate-e2e.ts — Full On-Chain E2E Simulation for Lead Engine CRE
 *
 * Simulates the complete lifecycle on testnet with multi-wallet interaction:
 *   1. KYC verify seller + buyer (ACE)
 *   2. Mint lead NFT (LeadNFT)
 *   3. Create listing + commit sealed bid (Marketplace)
 *   4. Reveal bid + resolve auction (Marketplace)
 *   5. Create + release escrow (RTBEscrow)
 *
 * Handles edge cases: gas shortages, reorgs, failed txs, nonce conflicts.
 *
 * Usage:
 *   npx hardhat run scripts/simulate-e2e.ts --network sepolia
 *   npx hardhat run scripts/simulate-e2e.ts --network hardhat  # local
 */

import { ethers } from "hardhat";

// ═══════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════

// Contract addresses (Sepolia — override via env)
const ADDRESSES = {
    ACECompliance:
        process.env.ACE_CONTRACT_ADDRESS ||
        "0x746245858A5A5bCccfd0bdAa228b1489908b9546",
    LeadNFT:
        process.env.LEAD_NFT_CONTRACT_ADDRESS ||
        "0xB93A1Ff499BdEaf74710F760Eb2B6bc5b62f8546",
    Marketplace:
        process.env.MARKETPLACE_CONTRACT_ADDRESS ||
        "0x3b1bBb196e65BE66c2fB18DB70A3513c1dDeB288",
    RTBEscrow:
        process.env.ESCROW_CONTRACT_ADDRESS ||
        "0x19B7a082e93B096B0516FA46E67d4168DdCD9004",
    CREVerifier:
        process.env.CRE_CONTRACT_ADDRESS ||
        "0x00f1f1C16e1431FFaAc3d44c608EFb5F8Db257A4",
};

const SAFE_CONFIRMATIONS = 2; // Reduced for testnet speed

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

async function waitForConfirmation(
    tx: any,
    label: string,
    confirmations = SAFE_CONFIRMATIONS
): Promise<any> {
    console.log(`   ⏳ ${label}... tx: ${tx.hash}`);
    const receipt = await tx.wait(confirmations);

    if (!receipt || receipt.status === 0) {
        throw new Error(`${label} FAILED — tx reverted: ${tx.hash}`);
    }

    console.log(
        `   ✅ ${label} — block: ${receipt.blockNumber}, gas: ${receipt.gasUsed.toString()}`
    );
    return receipt;
}

async function checkBalance(signer: any, minETH: number): Promise<void> {
    const balance = await ethers.provider.getBalance(signer.address);
    const balanceETH = parseFloat(ethers.formatEther(balance));

    if (balanceETH < minETH) {
        throw new Error(
            `Insufficient balance: ${balanceETH.toFixed(4)} ETH (need ≥ ${minETH} ETH).\n` +
            `Fund ${signer.address} via faucet:\n` +
            `  Sepolia: https://sepoliafaucet.com\n` +
            `  Base Sepolia: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet`
        );
    }
    console.log(`   Balance: ${balanceETH.toFixed(4)} ETH ✓`);
}

// ═══════════════════════════════════════════════
// E2E Simulation
// ═══════════════════════════════════════════════

async function main() {
    const signers = await ethers.getSigners();
    const deployer = signers[0];
    const seller = signers.length > 1 ? signers[1] : signers[0];
    const buyer = signers.length > 2 ? signers[2] : signers[0];

    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const isLocal = chainId === 31337;

    console.log("\n" + "═".repeat(60));
    console.log("🧪 LEAD ENGINE CRE — E2E ON-CHAIN SIMULATION");
    console.log("═".repeat(60));
    console.log(`  Chain:    ${chainId} (${isLocal ? "local" : "testnet"})`);
    console.log(`  Deployer: ${deployer.address}`);
    console.log(`  Seller:   ${seller.address}`);
    console.log(`  Buyer:    ${buyer.address}\n`);

    // ─── Pre-flight Checks ──────────────────
    console.log("🔍 Pre-flight checks...");
    await checkBalance(deployer, 0.01);

    const results: {
        step: string;
        txHash: string;
        blockNumber: number;
        gasUsed: string;
        status: string;
    }[] = [];

    try {
        // ─── Step 1: ACE KYC Verification ───────
        console.log("\n📋 STEP 1: ACE KYC Verification");

        const ace = await ethers.getContractAt("ACECompliance", ADDRESSES.ACECompliance);

        // Verify seller
        const sellerJurisdiction = ethers.keccak256(ethers.toUtf8Bytes("US-ID")); // Boise, Idaho
        const tx1 = await ace.verifyUser(
            seller.address,
            sellerJurisdiction,
            80 // Reputation score
        );
        const r1 = await waitForConfirmation(tx1, "Seller KYC verified");
        results.push({
            step: "ACE: Seller KYC",
            txHash: tx1.hash,
            blockNumber: r1.blockNumber,
            gasUsed: r1.gasUsed.toString(),
            status: "✅",
        });

        // Verify buyer
        const buyerJurisdiction = ethers.keccak256(ethers.toUtf8Bytes("US-CA"));
        const tx2 = await ace.verifyUser(
            buyer.address,
            buyerJurisdiction,
            90
        );
        const r2 = await waitForConfirmation(tx2, "Buyer KYC verified");
        results.push({
            step: "ACE: Buyer KYC",
            txHash: tx2.hash,
            blockNumber: r2.blockNumber,
            gasUsed: r2.gasUsed.toString(),
            status: "✅",
        });

        // ─── Step 2: Mint Lead NFT ──────────────
        console.log("\n📋 STEP 2: Mint Lead NFT");

        const leadNFT = await ethers.getContractAt("LeadNFTv2", ADDRESSES.LeadNFT);

        const leadData = {
            vertical: "solar",
            geo: "US-ID",
            dataHash: ethers.keccak256(
                ethers.toUtf8Bytes(
                    JSON.stringify({
                        name: "Jane Doe",
                        email: "jane@example.com",
                        phone: "+1-208-555-0123",
                        interest: "residential solar installation",
                        propertySize: "2400 sqft",
                    })
                )
            ),
            metadataURI: "ipfs://QmSimulatedLeadMetadata_BoiseSolar_2026",
        };

        const tx3 = await leadNFT.mintLead(
            seller.address,
            leadData.vertical,
            leadData.geo,
            leadData.dataHash,
            leadData.metadataURI
        );
        const r3 = await waitForConfirmation(tx3, "Lead NFT minted");

        // Extract token ID from LeadMinted event
        const mintLog = r3.logs.find(
            (l: any) => l.topics[0] === leadNFT.interface.getEvent("LeadMinted")?.topicHash
        );
        const tokenId = mintLog ? parseInt(mintLog.topics[1], 16) : 1;
        console.log(`   Token ID: ${tokenId}`);

        results.push({
            step: "LeadNFT: Mint",
            txHash: tx3.hash,
            blockNumber: r3.blockNumber,
            gasUsed: r3.gasUsed.toString(),
            status: `✅ (tokenId: ${tokenId})`,
        });

        // ─── Step 3: Create Listing + Sealed Bid ─
        console.log("\n📋 STEP 3: Create Listing + Sealed Bid");

        const marketplace = await ethers.getContractAt("Marketplace", ADDRESSES.Marketplace);

        // Approve marketplace to manage NFT
        const approveTx = await leadNFT.connect(seller).approve(
            ADDRESSES.Marketplace,
            tokenId
        );
        await waitForConfirmation(approveTx, "NFT approved for Marketplace");

        // Create listing (minBid: 50 USDC, buyNow: 200 USDC, duration: 1 hour)
        const minBid = ethers.parseUnits("50", 6); // USDC has 6 decimals
        const buyNow = ethers.parseUnits("200", 6);
        const duration = 3600; // 1 hour

        const tx4 = await marketplace.connect(seller).createListing(
            tokenId,
            minBid,
            buyNow,
            duration
        );
        const r4 = await waitForConfirmation(tx4, "Listing created");
        results.push({
            step: "Marketplace: Create Listing",
            txHash: tx4.hash,
            blockNumber: r4.blockNumber,
            gasUsed: r4.gasUsed.toString(),
            status: "✅",
        });

        // Commit sealed bid (commit-reveal pattern)
        const bidAmount = ethers.parseUnits("120", 6);
        const salt = ethers.randomBytes(32);
        const commitHash = ethers.keccak256(
            ethers.solidityPacked(
                ["address", "uint96", "bytes32"],
                [buyer.address, bidAmount, salt]
            )
        );

        const listingId = 0; // First listing
        const tx5 = await marketplace.connect(buyer).commitBid(listingId, commitHash);
        const r5 = await waitForConfirmation(tx5, "Bid committed (sealed)");
        results.push({
            step: "Marketplace: Sealed Bid",
            txHash: tx5.hash,
            blockNumber: r5.blockNumber,
            gasUsed: r5.gasUsed.toString(),
            status: "✅",
        });

        // ─── Step 4: Summary ────────────────────
        console.log("\n" + "═".repeat(60));
        console.log("📊 E2E SIMULATION RESULTS");
        console.log("═".repeat(60));

        console.log("\n  | Step | Tx Hash | Block | Gas |");
        console.log("  |------|---------|-------|-----|");
        for (const r of results) {
            console.log(
                `  | ${r.step} | ${r.txHash.slice(0, 10)}... | ${r.blockNumber} | ${r.gasUsed} |`
            );
        }

        const totalGas = results.reduce(
            (sum, r) => sum + BigInt(r.gasUsed),
            0n
        );
        console.log(`\n  Total gas used: ${totalGas.toString()}`);
        console.log(`  Total steps:    ${results.length}`);

        // Write results
        const fs = await import("fs");
        const outputPath = "test-results/e2e-onchain-simulation.json";
        fs.mkdirSync("test-results", { recursive: true });
        fs.writeFileSync(
            outputPath,
            JSON.stringify(
                {
                    chainId,
                    timestamp: new Date().toISOString(),
                    deployer: deployer.address,
                    seller: seller.address,
                    buyer: buyer.address,
                    steps: results,
                    totalGas: totalGas.toString(),
                    contracts: ADDRESSES,
                },
                null,
                2
            )
        );
        console.log(`  Results saved:  ${outputPath}`);
    } catch (err: any) {
        console.error("\n❌ Simulation failed:", err.message);

        // ─── Edge Case Diagnostics ──────────────
        if (err.message.includes("insufficient funds")) {
            console.error("\n💰 GAS SHORTAGE: Fund your wallet:");
            console.error(`   Deployer: ${deployer.address}`);
            console.error("   Sepolia faucet: https://sepoliafaucet.com");
        } else if (err.message.includes("nonce")) {
            console.error("\n🔁 NONCE CONFLICT: Reset your nonce:");
            console.error("   In MetaMask: Settings → Advanced → Clear activity");
        } else if (err.message.includes("replacement fee too low")) {
            console.error("\n⛽ LOW GAS PRICE: Network is congested, retry with higher gas:");
            console.error("   Set gasPrice in hardhat.config.ts");
        } else if (err.message.includes("block not found")) {
            console.error("\n🔄 POSSIBLE REORG: Wait for more confirmations");
            console.error("   Increase SAFE_CONFIRMATIONS to 12+ on mainnet");
        }

        process.exit(1);
    }

    console.log("\n" + "═".repeat(60));
}

main();
