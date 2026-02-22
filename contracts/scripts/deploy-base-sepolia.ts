/**
 * deploy-base-sepolia.ts
 *
 * Deploys LeadNFTv2, RTBEscrow, and PersonalEscrowVault to Base Sepolia.
 *
 * IMPORTANT: This script deploys ALL THREE contracts unconditionally.
 * If you need to re-run after a partial failure, deploy only the missing
 * contract using a targeted script (e.g. deploy-vault-only.ts) rather
 * than re-running this full script — doing so will create duplicates.
 */
import { ethers } from "hardhat";

const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEPLOYER_ROLE = ""; // filled at runtime from signers[0]

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    const bal = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(bal), "ETH");
    console.log("Nonce (start):", await ethers.provider.getTransactionCount(deployer.address));

    // ── 1. LeadNFTv2 ─────────────────────────────────────────────────────────
    console.log("\n📦 Deploying LeadNFTv2...");
    const LeadNFTv2Factory = await ethers.getContractFactory("LeadNFTv2");
    const leadNFT = await LeadNFTv2Factory.deploy(deployer.address);
    await leadNFT.waitForDeployment();
    const leadAddr = await leadNFT.getAddress();
    const leadTx = leadNFT.deploymentTransaction()!.hash;
    console.log("✅ LeadNFTv2:", leadAddr, "  tx:", leadTx);

    // ── 2. RTBEscrow ──────────────────────────────────────────────────────────
    console.log("\n📦 Deploying RTBEscrow...");
    const RTBEscrowFactory = await ethers.getContractFactory("RTBEscrow");
    const escrow = await RTBEscrowFactory.deploy(
        USDC_BASE_SEPOLIA,
        deployer.address,   // Fee recipient
        250,                // 2.5% platform fee (basis points)
        deployer.address    // Initial owner
    );
    await escrow.waitForDeployment();
    const escrowAddr = await escrow.getAddress();
    const escrowTx = escrow.deploymentTransaction()!.hash;
    console.log("✅ RTBEscrow:", escrowAddr, "  tx:", escrowTx);

    // ── 3. PersonalEscrowVault ────────────────────────────────────────────────
    console.log("\n📦 Deploying PersonalEscrowVault...");
    const VaultFactory = await ethers.getContractFactory("PersonalEscrowVault");
    const vault = await VaultFactory.deploy(
        USDC_BASE_SEPOLIA,
        deployer.address,   // Platform wallet
        deployer.address    // Initial owner
    );
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    const vaultTx = vault.deploymentTransaction()!.hash;
    const feedAddr = await vault.usdcEthFeed();
    console.log("✅ PersonalEscrowVault:", vaultAddr, "  tx:", vaultTx);
    console.log("   usdcEthFeed:", feedAddr);

    // ── Summary ───────────────────────────────────────────────────────────────
    const W = "═".repeat(60);
    console.log(`\n${W}`);
    console.log("📋 DEPLOYMENT SUMMARY — Base Sepolia");
    console.log(W);
    console.log(`LeadNFTv2             : ${leadAddr}`);
    console.log(`LeadNFTv2 TX          : ${leadTx}`);
    console.log(`RTBEscrow             : ${escrowAddr}`);
    console.log(`RTBEscrow TX          : ${escrowTx}`);
    console.log(`PersonalEscrowVault   : ${vaultAddr}`);
    console.log(`PersonalEscrowVault TX: ${vaultTx}`);
    console.log(W);
    console.log(`\nRemaining ETH: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`);

    console.log(`\n🔍 Basescan Verify Commands:\n`);
    console.log(`npx hardhat verify --network baseSepolia ${leadAddr} "${deployer.address}"`);
    console.log(`\nnpx hardhat verify --network baseSepolia ${escrowAddr} "${USDC_BASE_SEPOLIA}" "${deployer.address}" 250 "${deployer.address}"`);
    console.log(`\nnpx hardhat verify --network baseSepolia ${vaultAddr} "${USDC_BASE_SEPOLIA}" "${deployer.address}" "${deployer.address}"`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error.message ?? error);
        process.exit(1);
    });
