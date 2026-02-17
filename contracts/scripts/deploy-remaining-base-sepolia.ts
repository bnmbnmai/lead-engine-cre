import { ethers } from "hardhat";

/**
 * Deploy the 6 missing contracts to Base Sepolia.
 * 
 * Already deployed:
 *   LeadNFTv2:  0x37414bc0341e0AAb94e51E89047eD73C7086E303
 *   RTBEscrow:  0xff5d18a9fff7682a5285ccdafd0253e34761DbDB (redeployed Feb 17)
 *
 * This script deploys:
 *   1. ACECompliance
 *   2. VerticalNFT
 *   3. CREVerifier
 *   4. Marketplace
 *   5. VerticalAuction
 *   6. CustomLeadFeed
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const bal = await ethers.provider.getBalance(deployer.address);

    console.log("═".repeat(60));
    console.log("🚀 LEAD ENGINE CRE — DEPLOY REMAINING CONTRACTS (Base Sepolia)");
    console.log("═".repeat(60));
    console.log(`Deployer:  ${deployer.address}`);
    console.log(`Balance:   ${ethers.formatEther(bal)} ETH`);
    console.log();

    // ── Already-deployed addresses ───────────────────────────────
    const LEAD_NFT_ADDRESS = "0x37414bc0341e0AAb94e51E89047eD73C7086E303";
    const ESCROW_ADDRESS = "0xff5d18a9fff7682a5285ccdafd0253e34761DbDB";   // RTBEscrow (redeployed Feb 17)
    const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

    // Chainlink Functions (Base Sepolia) — from docs.chain.link
    const CHAINLINK_ROUTER = "0xf9B8fc078197181C841c296C876945aaa425B278";
    const DON_ID = ethers.encodeBytes32String("fun-base-sepolia-1");

    // ── 1. ACECompliance ─────────────────────────────────────────
    console.log("📦 1/6  Deploying ACECompliance...");
    const ACECompliance = await ethers.getContractFactory("ACECompliance");
    const ace = await ACECompliance.deploy(deployer.address);
    await ace.waitForDeployment();
    const aceAddr = await ace.getAddress();
    console.log(`   ✅ ACECompliance: ${aceAddr}`);
    console.log(`      TX: ${ace.deploymentTransaction()!.hash}`);

    // ── 2. VerticalNFT ───────────────────────────────────────────
    console.log("\n📦 2/6  Deploying VerticalNFT...");
    const VerticalNFT = await ethers.getContractFactory("VerticalNFT");
    const verticalNFT = await VerticalNFT.deploy(
        deployer.address,   // initialOwner
        200,                 // defaultRoyaltyBps = 2%
        deployer.address     // platformAddress
    );
    await verticalNFT.waitForDeployment();
    const vertNFTAddr = await verticalNFT.getAddress();
    console.log(`   ✅ VerticalNFT: ${vertNFTAddr}`);
    console.log(`      TX: ${verticalNFT.deploymentTransaction()!.hash}`);

    // ── 3. CREVerifier ───────────────────────────────────────────
    console.log("\n📦 3/6  Deploying CREVerifier...");
    const CREVerifier = await ethers.getContractFactory("CREVerifier");
    const cre = await CREVerifier.deploy(
        CHAINLINK_ROUTER,
        DON_ID,
        0,                   // subscriptionId — set later via setChainlinkSubscription()
        LEAD_NFT_ADDRESS,    // existing LeadNFTv2
        deployer.address
    );
    await cre.waitForDeployment();
    const creAddr = await cre.getAddress();
    console.log(`   ✅ CREVerifier: ${creAddr}`);
    console.log(`      TX: ${cre.deploymentTransaction()!.hash}`);

    // ── 4. Marketplace ───────────────────────────────────────────
    console.log("\n📦 4/6  Deploying Marketplace...");
    const Marketplace = await ethers.getContractFactory("Marketplace");
    const marketplace = await Marketplace.deploy(
        LEAD_NFT_ADDRESS,    // existing LeadNFTv2
        aceAddr,             // newly deployed ACECompliance
        USDC_BASE_SEPOLIA,
        ESCROW_ADDRESS,      // existing RTBEscrow
        deployer.address
    );
    await marketplace.waitForDeployment();
    const mktAddr = await marketplace.getAddress();
    console.log(`   ✅ Marketplace: ${mktAddr}`);
    console.log(`      TX: ${marketplace.deploymentTransaction()!.hash}`);

    // ── 5. VerticalAuction ───────────────────────────────────────
    console.log("\n📦 5/6  Deploying VerticalAuction...");
    const VerticalAuction = await ethers.getContractFactory("VerticalAuction");
    const vertAuction = await VerticalAuction.deploy();
    await vertAuction.waitForDeployment();
    const vertAuctionAddr = await vertAuction.getAddress();
    console.log(`   ✅ VerticalAuction: ${vertAuctionAddr}`);
    console.log(`      TX: ${vertAuction.deploymentTransaction()!.hash}`);

    // ── 6. CustomLeadFeed ────────────────────────────────────────
    console.log("\n📦 6/6  Deploying CustomLeadFeed...");
    const CustomLeadFeed = await ethers.getContractFactory("CustomLeadFeed");
    const feed = await CustomLeadFeed.deploy(
        deployer.address,
        86400                // maxStalenessSeconds = 24 hours
    );
    await feed.waitForDeployment();
    const feedAddr = await feed.getAddress();
    console.log(`   ✅ CustomLeadFeed: ${feedAddr}`);
    console.log(`      TX: ${feed.deploymentTransaction()!.hash}`);

    // ── Post-Deploy Setup ────────────────────────────────────────
    console.log("\n🔧 Setting up cross-contract permissions...");

    // Connect to existing contracts
    const leadNFT = await ethers.getContractAt("LeadNFTv2", LEAD_NFT_ADDRESS);
    const escrow = await ethers.getContractAt("RTBEscrow", ESCROW_ADDRESS);

    // Authorize Marketplace as LeadNFT minter
    try {
        await leadNFT.setAuthorizedMinter(mktAddr, true);
        console.log("   ✓ Marketplace authorized as LeadNFT minter");
    } catch (e: any) {
        console.log(`   ⚠ LeadNFT.setAuthorizedMinter failed: ${e.message?.slice(0, 80)}`);
    }

    // Authorize Marketplace as Escrow caller
    try {
        await escrow.setAuthorizedCaller(mktAddr, true);
        console.log("   ✓ Marketplace authorized as RTBEscrow caller");
    } catch (e: any) {
        console.log(`   ⚠ RTBEscrow.setAuthorizedCaller failed: ${e.message?.slice(0, 80)}`);
    }

    // Authorize deployer as ACE verifier
    await ace.setAuthorizedVerifier(deployer.address, true);
    console.log("   ✓ Deployer authorized as ACE verifier");

    // Authorize deployer as VerticalNFT minter
    await verticalNFT.setAuthorizedMinter(deployer.address, true);
    console.log("   ✓ Deployer authorized as VerticalNFT minter");

    // Set default vertical policies on ACE
    const verticals = ["solar", "mortgage", "roofing", "insurance", "home_services", "b2b_saas", "real_estate", "auto", "legal", "financial_services"];
    for (const v of verticals) {
        await ace.setDefaultVerticalPolicy(ethers.keccak256(ethers.toUtf8Bytes(v)), true);
    }
    console.log(`   ✓ Default vertical policies set for ${verticals.length} verticals`);

    // ── Summary ──────────────────────────────────────────────────
    const remainingBal = await ethers.provider.getBalance(deployer.address);
    const gasUsed = bal - remainingBal;

    console.log("\n" + "═".repeat(60));
    console.log("📋 DEPLOYMENT SUMMARY (Base Sepolia)");
    console.log("═".repeat(60));
    console.log(`
  EXISTING:
    LeadNFTv2:        ${LEAD_NFT_ADDRESS}
    RTBEscrow:        ${ESCROW_ADDRESS}

  NEW:
    ACECompliance:    ${aceAddr}
    VerticalNFT:      ${vertNFTAddr}
    CREVerifier:      ${creAddr}
    Marketplace:      ${mktAddr}
    VerticalAuction:  ${vertAuctionAddr}
    CustomLeadFeed:   ${feedAddr}

  CHAINLINK:
    Router:           ${CHAINLINK_ROUTER}
    DON ID:           fun-base-sepolia-1
    Subscription ID:  0 (set later via setChainlinkSubscription)

  GAS:
    ETH spent:        ${ethers.formatEther(gasUsed)} ETH
    Remaining:        ${ethers.formatEther(remainingBal)} ETH

  .env additions:
    ACE_CONTRACT_ADDRESS_BASE_SEPOLIA=${aceAddr}
    CRE_CONTRACT_ADDRESS_BASE_SEPOLIA=${creAddr}
    MARKETPLACE_CONTRACT_ADDRESS_BASE_SEPOLIA=${mktAddr}
    VERTICAL_NFT_CONTRACT_ADDRESS_BASE_SEPOLIA=${vertNFTAddr}
    VERTICAL_AUCTION_CONTRACT_ADDRESS_BASE_SEPOLIA=${vertAuctionAddr}
    CUSTOM_LEAD_FEED_CONTRACT_ADDRESS_BASE_SEPOLIA=${feedAddr}
    CHAINLINK_ROUTER_BASE_SEPOLIA=${CHAINLINK_ROUTER}
    CHAINLINK_DON_ID_BASE_SEPOLIA=0x66756e2d626173652d7365706f6c69612d310000000000000000000000000000

  NEXT STEPS:
    1. npx hardhat verify --network baseSepolia <address> <constructor args>
    2. Add .env vars shown above to backend/.env
    3. Create Chainlink Functions subscription at functions.chain.link
`);
    console.log("═".repeat(60));
}

main()
    .then(() => {
        console.log("\n✅ All 6 contracts deployed successfully!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n❌ Deployment failed:", error);
        process.exit(1);
    });
