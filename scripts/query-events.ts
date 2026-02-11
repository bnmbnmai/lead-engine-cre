/**
 * query-events.ts — On-Chain Event Explorer for Lead Engine CRE
 *
 * Queries deployed contract events from Etherscan/Basescan explorers.
 * Works on Sepolia, Base Sepolia, and mainnet.
 *
 * Usage:
 *   npx ts-node scripts/query-events.ts [--network sepolia|base-sepolia|base]
 *   npx ts-node scripts/query-events.ts --contract ACECompliance --event UserVerified
 *   npx ts-node scripts/query-events.ts --recent 100  # last 100 blocks
 */

import { ethers, JsonRpcProvider, Contract } from "ethers";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════

interface NetworkConfig {
    rpc: string;
    explorer: string;
    explorerApi: string;
    chainId: number;
}

const NETWORKS: Record<string, NetworkConfig> = {
    sepolia: {
        rpc: process.env.RPC_URL_SEPOLIA || "https://eth-sepolia.g.alchemy.com/v2/demo",
        explorer: "https://sepolia.etherscan.io",
        explorerApi: "https://api-sepolia.etherscan.io/api",
        chainId: 11155111,
    },
    "base-sepolia": {
        rpc: process.env.RPC_URL_BASE_SEPOLIA || "https://sepolia.base.org",
        explorer: "https://sepolia.basescan.org",
        explorerApi: "https://api-sepolia.basescan.org/api",
        chainId: 84532,
    },
    base: {
        rpc: process.env.RPC_URL_BASE_MAINNET || "https://mainnet.base.org",
        explorer: "https://basescan.org",
        explorerApi: "https://api.basescan.org/api",
        chainId: 8453,
    },
};

// Deployed contract addresses (Sepolia — update for other networks)
const CONTRACTS: Record<string, { address: string; events: string[] }> = {
    ACECompliance: {
        address: "0x746245858A5A5bCccfd0bdAa228b1489908b9546",
        events: [
            "event UserVerified(address indexed user, bytes32 indexed jurisdiction, uint40 expiry)",
            "event JurisdictionUpdated(bytes32 indexed jurisdiction, bool blocked, string reason)",
            "event UserBlacklisted(address indexed user, bytes32 reason)",
            "event PolicyUpdated(bytes32 indexed policyId, bool active)",
            "event VerifierAuthorized(address indexed verifier, bool authorized)",
            "event KYCValidityUpdated(uint40 newPeriod)",
            "event MinReputationUpdated(uint16 newMinScore)",
        ],
    },
    CREVerifier: {
        address: "0x00f1f1C16e1431FFaAc3d44c608EFb5F8Db257A4",
        events: [
            "event VerificationRequested(bytes32 indexed requestId, uint256 indexed leadId, uint8 verificationType)",
            "event VerificationFulfilled(bytes32 indexed requestId, uint256 indexed leadId, uint256 score)",
            "event VerificationFailed(bytes32 indexed requestId, uint256 indexed leadId, string reason)",
            "event SourceCodeUpdated(uint8 verificationType)",
            "event ConfigUpdated(bytes32 donId, uint64 subscriptionId, uint32 gasLimit)",
        ],
    },
    LeadNFT: {
        address: "0xB93A1Ff499BdEaf74710F760Eb2B6bc5b62f8546",
        events: [
            "event LeadMinted(uint256 indexed tokenId, address indexed seller, string vertical, string geo, bytes32 dataHash)",
            "event LeadSold(uint256 indexed tokenId, address indexed buyer, uint256 price)",
            "event LeadVerified(uint256 indexed tokenId, address verifier)",
            "event LeadExpired(uint256 indexed tokenId)",
            "event MinterAuthorized(address indexed minter, bool authorized)",
        ],
    },
    RTBEscrow: {
        address: "0x19B7a082e93B096B0516FA46E67d4168DdCD9004",
        events: [
            "event EscrowCreated(uint256 indexed escrowId, uint256 indexed listingId, address buyer, address seller, uint256 amount)",
            "event EscrowFunded(uint256 indexed escrowId, uint256 amount)",
            "event EscrowReleased(uint256 indexed escrowId, address seller, uint256 amount)",
            "event EscrowRefunded(uint256 indexed escrowId, address buyer, uint256 amount)",
            "event EscrowDisputed(uint256 indexed escrowId, address disputant)",
            "event CallerAuthorized(address indexed caller, bool authorized)",
            "event PlatformFeeUpdated(uint256 newFeeBps)",
        ],
    },
    Marketplace: {
        address: "0x3b1bBb196e65BE66c2fB18DB70A3513c1dDeB288",
        events: [
            "event ListingCreated(uint256 indexed listingId, uint256 indexed tokenId, address seller, uint96 minBid, uint96 buyNow)",
            "event BidCommitted(uint256 indexed listingId, address indexed bidder, bytes32 commitHash)",
            "event BidRevealed(uint256 indexed listingId, address indexed bidder, uint96 amount)",
            "event AuctionResolved(uint256 indexed listingId, address winner, uint96 winningBid)",
            "event ListingCancelled(uint256 indexed listingId)",
            "event BuyNowExecuted(uint256 indexed listingId, address indexed buyer, uint96 price)",
            "event SettingsUpdated(uint256 minDuration, uint256 maxDuration, uint256 revealWindow)",
        ],
    },
};

// ═══════════════════════════════════════════════
// CLI Argument Parsing
// ═══════════════════════════════════════════════

function parseArgs() {
    const args = process.argv.slice(2);
    const config: {
        network: string;
        contract?: string;
        event?: string;
        recent: number;
        output: string;
    } = {
        network: "sepolia",
        recent: 10000,
        output: "test-results",
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--network":
                config.network = args[++i];
                break;
            case "--contract":
                config.contract = args[++i];
                break;
            case "--event":
                config.event = args[++i];
                break;
            case "--recent":
                config.recent = parseInt(args[++i]);
                break;
            case "--output":
                config.output = args[++i];
                break;
        }
    }
    return config;
}

// ═══════════════════════════════════════════════
// Event Query Engine
// ═══════════════════════════════════════════════

interface EventResult {
    contract: string;
    event: string;
    blockNumber: number;
    txHash: string;
    args: Record<string, string>;
    timestamp?: string;
    explorerUrl: string;
}

async function queryContractEvents(
    provider: JsonRpcProvider,
    contractName: string,
    contractAddress: string,
    eventSignatures: string[],
    fromBlock: number,
    explorerBase: string
): Promise<EventResult[]> {
    const iface = new ethers.Interface(eventSignatures);
    const results: EventResult[] = [];

    for (const eventSig of eventSignatures) {
        const eventName = eventSig.match(/event\s+(\w+)\(/)?.[1];
        if (!eventName) continue;

        try {
            const fragment = iface.getEvent(eventName);
            if (!fragment) continue;

            const topicHash = iface.getEvent(eventName)?.topicHash;
            if (!topicHash) continue;

            const logs = await provider.getLogs({
                address: contractAddress,
                topics: [topicHash],
                fromBlock,
                toBlock: "latest",
            });

            for (const log of logs) {
                try {
                    const parsed = iface.parseLog({
                        topics: log.topics as string[],
                        data: log.data,
                    });

                    if (parsed) {
                        const args: Record<string, string> = {};
                        for (const [key, value] of Object.entries(parsed.args)) {
                            if (isNaN(Number(key))) {
                                args[key] = String(value);
                            }
                        }

                        results.push({
                            contract: contractName,
                            event: eventName,
                            blockNumber: log.blockNumber,
                            txHash: log.transactionHash,
                            args,
                            explorerUrl: `${explorerBase}/tx/${log.transactionHash}`,
                        });
                    }
                } catch {
                    // Skip unparseable logs
                }
            }

            console.log(
                `  ${contractName}.${eventName}: ${logs.length} event(s) found`
            );
        } catch (err: any) {
            console.warn(`  ⚠ ${contractName}.${eventName}: ${err.message}`);
        }
    }

    return results;
}

// ═══════════════════════════════════════════════
// Reorg Safety Check
// ═══════════════════════════════════════════════

async function checkForReorgs(
    provider: JsonRpcProvider,
    blockNumbers: number[]
): Promise<{ safe: boolean; warnings: string[] }> {
    const warnings: string[] = [];
    const latestBlock = await provider.getBlockNumber();
    const SAFE_CONFIRMATIONS = 12;

    for (const blockNum of blockNumbers) {
        const confirmations = latestBlock - blockNum;
        if (confirmations < SAFE_CONFIRMATIONS) {
            warnings.push(
                `Block ${blockNum} has only ${confirmations} confirmations (need ${SAFE_CONFIRMATIONS})`
            );
        }
    }

    return { safe: warnings.length === 0, warnings };
}

// ═══════════════════════════════════════════════
// Gas Usage Analysis
// ═══════════════════════════════════════════════

async function analyzeGasUsage(
    provider: JsonRpcProvider,
    txHashes: string[]
): Promise<{ txHash: string; gasUsed: string; gasPrice: string; costETH: string }[]> {
    const results = [];

    for (const txHash of txHashes.slice(0, 20)) {
        // Limit to 20
        try {
            const receipt = await provider.getTransactionReceipt(txHash);
            if (receipt) {
                const gasUsed = receipt.gasUsed;
                const gasPrice = receipt.gasPrice || 0n;
                const cost = gasUsed * gasPrice;

                results.push({
                    txHash,
                    gasUsed: gasUsed.toString(),
                    gasPrice: `${ethers.formatUnits(gasPrice, "gwei")} gwei`,
                    costETH: ethers.formatEther(cost),
                });
            }
        } catch {
            // Skip failed receipts
        }
    }

    return results;
}

// ═══════════════════════════════════════════════
// Main Execution
// ═══════════════════════════════════════════════

async function main() {
    const config = parseArgs();
    const network = NETWORKS[config.network];

    if (!network) {
        console.error(`Unknown network: ${config.network}`);
        console.error(`Available: ${Object.keys(NETWORKS).join(", ")}`);
        process.exit(1);
    }

    console.log("\n" + "═".repeat(60));
    console.log("🔍 LEAD ENGINE CRE — ON-CHAIN EVENT QUERY");
    console.log("═".repeat(60));
    console.log(`  Network:  ${config.network} (chain ${network.chainId})`);
    console.log(`  Explorer: ${network.explorer}`);
    console.log(`  Recent:   last ${config.recent} blocks\n`);

    const provider = new JsonRpcProvider(network.rpc);
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - config.recent);

    console.log(`  Latest block: ${latestBlock}`);
    console.log(`  Scanning from: ${fromBlock}\n`);

    // Select contracts to query
    const contractsToQuery = config.contract
        ? { [config.contract]: CONTRACTS[config.contract] }
        : CONTRACTS;

    const allResults: EventResult[] = [];

    for (const [name, contract] of Object.entries(contractsToQuery)) {
        if (!contract) {
            console.warn(`  ⚠ Unknown contract: ${name}`);
            continue;
        }

        console.log(`\n📋 ${name} (${contract.address})`);
        console.log(`   ${network.explorer}/address/${contract.address}`);

        const events = config.event
            ? contract.events.filter((e) => e.includes(config.event!))
            : contract.events;

        const results = await queryContractEvents(
            provider,
            name,
            contract.address,
            events,
            fromBlock,
            network.explorer
        );

        allResults.push(...results);
    }

    // ─── Reorg Safety Check ─────────────────
    const blockNumbers = [...new Set(allResults.map((r) => r.blockNumber))];
    if (blockNumbers.length > 0) {
        console.log("\n\n🔒 Reorg Safety Check");
        const reorgCheck = await checkForReorgs(provider, blockNumbers);
        if (reorgCheck.safe) {
            console.log("  ✅ All events have sufficient confirmations");
        } else {
            for (const warning of reorgCheck.warnings) {
                console.log(`  ⚠ ${warning}`);
            }
        }
    }

    // ─── Gas Analysis ───────────────────────
    const txHashes = [...new Set(allResults.map((r) => r.txHash))];
    if (txHashes.length > 0) {
        console.log("\n⛽ Gas Usage Analysis (up to 20 txs)");
        const gasResults = await analyzeGasUsage(provider, txHashes);
        for (const gas of gasResults) {
            console.log(
                `  ${gas.txHash.slice(0, 10)}...  gas: ${gas.gasUsed}  price: ${gas.gasPrice}  cost: ${gas.costETH} ETH`
            );
        }
    }

    // ─── Write Results ──────────────────────
    const outputDir = config.output;
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const reportPath = path.join(outputDir, "on-chain-events.json");
    fs.writeFileSync(
        reportPath,
        JSON.stringify(
            {
                network: config.network,
                chainId: network.chainId,
                latestBlock,
                fromBlock,
                totalEvents: allResults.length,
                timestamp: new Date().toISOString(),
                events: allResults,
            },
            null,
            2
        )
    );

    // ─── Summary ────────────────────────────
    console.log("\n\n" + "═".repeat(60));
    console.log("📊 SUMMARY");
    console.log("═".repeat(60));

    const byContract: Record<string, number> = {};
    for (const r of allResults) {
        byContract[r.contract] = (byContract[r.contract] || 0) + 1;
    }

    for (const [contract, count] of Object.entries(byContract)) {
        console.log(`  ${contract}: ${count} events`);
    }

    console.log(`\n  Total events found: ${allResults.length}`);
    console.log(`  Report saved:       ${reportPath}`);

    // Print explorer links
    if (allResults.length > 0) {
        console.log("\n🔗 Explorer Links (most recent 10):");
        for (const r of allResults.slice(-10)) {
            console.log(`  ${r.contract}.${r.event}`);
            console.log(`    ${r.explorerUrl}`);
        }
    } else {
        console.log("\n  ℹ No events found. This is expected if contracts");
        console.log("    were just deployed and haven't been interacted with.");
        console.log("    Run the simulation script to generate test transactions:");
        console.log("    npx hardhat run scripts/simulate-e2e.ts --network sepolia");
    }

    console.log("\n" + "═".repeat(60));
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
