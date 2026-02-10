import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config({ path: "../backend/.env" });

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
const TESTNET_MNEMONIC = process.env.TESTNET_MNEMONIC || "";

// Use mnemonic-derived accounts if available, otherwise single private key
const accountsConfig = TESTNET_MNEMONIC
    ? { mnemonic: TESTNET_MNEMONIC, count: 10 }
    : [PRIVATE_KEY];

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
