import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config({ path: "../backend/.env" });

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
const TESTNET_MNEMONIC = process.env.TESTNET_MNEMONIC || "";

// Deployer private key is always account[0]; mnemonic-derived wallets [1]-[7] for simulation
import { HDNodeWallet, Mnemonic } from "ethers";
function buildAccounts(): string[] {
    const keys = [PRIVATE_KEY];
    if (TESTNET_MNEMONIC) {
        const mn = Mnemonic.fromPhrase(TESTNET_MNEMONIC);
        for (let i = 0; i < 7; i++) {
            const w = HDNodeWallet.fromMnemonic(mn, `m/44'/60'/0'/0/${i}`);
            keys.push(w.privateKey);
        }
    }
    return keys;
}
const accountsConfig = buildAccounts();

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: true,
        },
    },
    networks: {
        hardhat: {
            chainId: 31337,
            accounts: { count: 10 },
            // Optional: fork Sepolia for realistic E2E tests
            ...(ALCHEMY_API_KEY ? {
                forking: {
                    url: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
                    enabled: process.env.FORK_SEPOLIA === "true",
                },
            } : {}),
        },
        sepolia: {
            url: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
            accounts: accountsConfig as any,
            chainId: 11155111,
        },
        baseSepolia: {
            url: "https://sepolia.base.org",
            accounts: accountsConfig as any,
            chainId: 84532,
        },
    },
    etherscan: {
        apiKey: {
            sepolia: process.env.ETHERSCAN_API_KEY || "",
            baseSepolia: process.env.BASESCAN_API_KEY || "",
        },
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts",
    },
};

export default config;
