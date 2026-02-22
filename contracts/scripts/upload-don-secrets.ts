// @ts-nocheck
/**
 * Upload Chainlink Functions DON Secrets
 *
 * Idempotent — safe to run multiple times. Overwrites slot 0 each run.
 *
 * Usage:  cd contracts && npx ts-node scripts/upload-don-secrets.ts
 *
 * Env required in backend/.env:
 *   - DEPLOYER_PRIVATE_KEY  (subscription owner)
 *   - CRE_API_KEY           (scoring-data endpoint auth)
 */

// functions-toolkit bundles ethers v5 — use the v5 sub-packages
const { Wallet } = require("@ethersproject/wallet");
const { JsonRpcProvider } = require("@ethersproject/providers");
const { SecretsManager } = require("@chainlink/functions-toolkit");
const dotenv = require("dotenv");

dotenv.config({ path: "../backend/.env" });

// ── Config ──────────────────────────────────────────────
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const CRE_API_KEY = process.env.CRE_API_KEY;
const API_BASE_URL = process.env.API_BASE_URL || "https://lead-engine-cre-api.onrender.com";
const CHTT_ENCLAVE_SECRET = process.env.CHTT_ENCLAVE_SECRET;

// Base Sepolia — official Chainlink Functions addresses
// https://docs.chain.link/chainlink-functions/supported-networks#base-sepolia-testnet
const RPC_URL = "https://sepolia.base.org";
const FUNCTIONS_ROUTER = "0xf9B8fc078197181C841c296C876945aaa425B278";
const DON_ID = "fun-base-sepolia-1";
const SLOT_ID = 0;
const EXPIRATION_MINUTES = 4320; // 72 hours

async function main() {
    if (!PRIVATE_KEY) { console.error("❌ DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }
    if (!CRE_API_KEY) { console.error("❌ CRE_API_KEY not set"); process.exit(1); }
    if (!CHTT_ENCLAVE_SECRET) { console.error("❌ CHTT_ENCLAVE_SECRET not set in backend/.env"); process.exit(1); }

    console.log("═".repeat(50));
    console.log("📤 Chainlink Functions DON Secrets Upload");
    console.log("═".repeat(50));
    console.log(`Router:      ${FUNCTIONS_ROUTER}`);
    console.log(`DON ID:      ${DON_ID}`);
    console.log(`Slot:        ${SLOT_ID}`);
    console.log(`API Base:    ${API_BASE_URL}`);
    console.log(`Expiration:  ${EXPIRATION_MINUTES / 60}h\n`);

    // ethers v5 signer (matches functions-toolkit internals)
    const provider = new JsonRpcProvider(RPC_URL);
    const signer = new Wallet(PRIVATE_KEY, provider);
    console.log(`Signer:      ${signer.address}`);

    const secretsManager = new SecretsManager({
        signer,
        functionsRouterAddress: FUNCTIONS_ROUTER,
        donId: DON_ID,
    });
    await secretsManager.initialize();
    console.log("✅ SecretsManager initialized\n");

    const secrets = { apiBaseUrl: API_BASE_URL, creApiKey: CRE_API_KEY, enclaveKey: CHTT_ENCLAVE_SECRET };

    console.log("🔐 Encrypting secrets...");
    const encrypted = await secretsManager.encryptSecrets(secrets);
    console.log("✅ Encrypted\n");

    console.log("📤 Uploading to DON (slot 0)...");
    const { version, success } = await secretsManager.uploadEncryptedSecretsToDON({
        encryptedSecretsHexstring: encrypted.encryptedSecrets,
        gatewayUrls: [
            "https://01.functions-gateway.testnet.chain.link/",
            "https://02.functions-gateway.testnet.chain.link/",
        ],
        slotId: SLOT_ID,
        minutesUntilExpiration: EXPIRATION_MINUTES,
    });

    if (!success) { console.error("❌ Upload failed"); process.exit(1); }

    console.log("\n" + "═".repeat(50));
    console.log("✅ DON SECRETS UPLOADED");
    console.log("═".repeat(50));
    console.log(`Slot: ${SLOT_ID}  Version: ${version}  Expires: ${EXPIRATION_MINUTES / 60}h`);
    console.log(`Secrets: apiBaseUrl, creApiKey, enclaveKey (CHTT Phase 2)`);
    console.log("═".repeat(50));
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error("❌ Upload failed:", e); process.exit(1); });
