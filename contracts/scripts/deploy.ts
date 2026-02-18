import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();

    console.log("═".repeat(60));
    console.log("🚀 LEAD ENGINE CRE - CONTRACT DEPLOYMENT");
    console.log("═".repeat(60));
    console.log(`\nDeployer: ${deployer.address}`);
    console.log(`Network:  ${(await ethers.provider.getNetwork()).name}`);
    console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

    // ============================================
    // Configuration
    // ============================================

    // Testnet USDC addresses
    const USDC_ADDRESSES: { [key: number]: string } = {
        11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",  // Sepolia
        84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",     // Base Sepolia
        31337: "",  // Local - will deploy mock
    };

    // Chainlink Functions Router addresses
    const CHAINLINK_ROUTERS: { [key: number]: string } = {
        11155111: "0xb83E47C2bC239B3bf370bc41e1459A34b41238D0",  // Sepolia
        84532: "0xf9B8fc078197181C841c296C876945aaa425B278",     // Base Sepolia
        31337: "",  // Local - skip CREVerifier
    };

    // DON IDs per network
    const DON_IDS: { [key: number]: string } = {
        11155111: "fun-ethereum-sepolia-1",
        84532: "fun-base-sepolia-1",
    };

    const chainId = Number((await ethers.provider.getNetwork()).chainId);
    const platformFeeBps = 250;  // 2.5%

    let usdcAddress = USDC_ADDRESSES[chainId];
    let chainlinkRouter = CHAINLINK_ROUTERS[chainId];

    // ============================================
    // Deploy Mock USDC for local network
    // ============================================

    if (chainId === 31337) {
        console.log("📦 Deploying MockERC20 (USDC)...");
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const mockUSDC = await MockERC20.deploy("USD Coin", "USDC", 6);
        await mockUSDC.waitForDeployment();
        usdcAddress = await mockUSDC.getAddress();
        console.log(`✅ MockUSDC: ${usdcAddress}`);
    }

    // ============================================
    // Deploy Core Contracts
    // ============================================

    // 1. ACE Compliance
    console.log("\n📦 Deploying ACECompliance...");
    const ACECompliance = await ethers.getContractFactory("ACECompliance");
    const aceCompliance = await ACECompliance.deploy(deployer.address);
    await aceCompliance.waitForDeployment();
    const aceAddress = await aceCompliance.getAddress();
    console.log(`✅ ACECompliance: ${aceAddress}`);

    // 2. LeadNFTv2
    console.log("\n📦 Deploying LeadNFTv2...");
    const LeadNFTv2 = await ethers.getContractFactory("LeadNFTv2");
    const leadNFT = await LeadNFTv2.deploy(deployer.address);
    await leadNFT.waitForDeployment();
    const leadNFTAddress = await leadNFT.getAddress();
    console.log(`✅ LeadNFTv2: ${leadNFTAddress}`);

    // 3. RTB Escrow
    console.log("\n📦 Deploying RTBEscrow...");
    const RTBEscrow = await ethers.getContractFactory("RTBEscrow");
    const escrow = await RTBEscrow.deploy(
        usdcAddress,
        deployer.address,  // Fee recipient
        platformFeeBps,
        deployer.address
    );
    await escrow.waitForDeployment();
    const escrowAddress = await escrow.getAddress();
    console.log(`✅ RTBEscrow: ${escrowAddress}`);

    // 4. Marketplace
    console.log("\n📦 Deploying Marketplace...");
    const Marketplace = await ethers.getContractFactory("Marketplace");
    const marketplace = await Marketplace.deploy(
        leadNFTAddress,
        aceAddress,
        usdcAddress,
        escrowAddress,
        deployer.address
    );
    await marketplace.waitForDeployment();
    const marketplaceAddress = await marketplace.getAddress();
    console.log(`✅ Marketplace: ${marketplaceAddress}`);

    // 5. CREVerifier (skip on local)
    let creVerifierAddress = "0x0000000000000000000000000000000000000000";
    if (chainlinkRouter) {
        console.log("\n📦 Deploying CREVerifier...");
        const CREVerifier = await ethers.getContractFactory("CREVerifier");
        const creVerifier = await CREVerifier.deploy(
            chainlinkRouter,
            ethers.encodeBytes32String(DON_IDS[chainId] || "fun-ethereum-sepolia-1"),  // DON ID
            0,  // Subscription ID (set later)
            leadNFTAddress,
            deployer.address
        );
        await creVerifier.waitForDeployment();
        creVerifierAddress = await creVerifier.getAddress();
        console.log(`✅ CREVerifier: ${creVerifierAddress}`);
    } else {
        console.log("\n⏭️  Skipping CREVerifier (no Chainlink router for local)");
    }

    // ============================================
    // Post-Deployment Setup
    // ============================================

    console.log("\n🔧 Setting up permissions...");

    // Authorize Marketplace as LeadNFT minter
    await leadNFT.setMarketplace(marketplaceAddress);
    console.log("   ✓ Marketplace authorized as LeadNFT manager");

    // Authorize deployer as minter (for testing)
    await leadNFT.setAuthorizedMinter(deployer.address, true);
    console.log("   ✓ Deployer authorized as LeadNFT minter");

    // Authorize Marketplace as Escrow caller
    await escrow.setAuthorizedCaller(marketplaceAddress, true);
    console.log("   ✓ Marketplace authorized as Escrow caller");

    // Set deployer as ACE verifier
    await aceCompliance.setAuthorizedVerifier(deployer.address, true);
    console.log("   ✓ Deployer authorized as ACE verifier");

    // Set default vertical policies
    const verticals = ["solar", "mortgage", "roofing", "insurance", "home_services", "b2b_saas"];
    for (const v of verticals) {
        await aceCompliance.setDefaultVerticalPolicy(ethers.keccak256(ethers.toUtf8Bytes(v)), true);
    }
    console.log(`   ✓ Default policies set for ${verticals.length} verticals`);

    // ============================================
    // Summary
    // ============================================

    console.log("\n" + "═".repeat(60));
    console.log("📋 DEPLOYMENT SUMMARY");
    console.log("═".repeat(60));
    console.log(`
Contract Addresses:
  ACECompliance:  ${aceAddress}
  LeadNFTv2:      ${leadNFTAddress}
  RTBEscrow:      ${escrowAddress}
  Marketplace:    ${marketplaceAddress}
  CREVerifier:    ${creVerifierAddress}
  USDC:           ${usdcAddress}

Configuration:
  Platform Fee:   ${platformFeeBps / 100}%
  Chain ID:       ${chainId}
  
Next Steps:
  1. Verify contracts on block explorer
  2. Fund Chainlink Functions subscription
  3. Configure CREVerifier source code
  4. Add contract addresses to backend .env
`);
    console.log("═".repeat(60));

    // Return addresses for programmatic use
    return {
        aceCompliance: aceAddress,
        leadNFT: leadNFTAddress,
        escrow: escrowAddress,
        marketplace: marketplaceAddress,
        creVerifier: creVerifierAddress,
        usdc: usdcAddress,
    };
}

main()
    .then((addresses) => {
        console.log("\n✅ Deployment complete!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n❌ Deployment failed:", error);
        process.exit(1);
    });
