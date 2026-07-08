/**
 * On-chain AgentRegistry integration (Phase C3 / Option A).
 * Attests settlement outcomes when AGENT_REGISTRY_ADDRESS is configured.
 */

import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';

const AGENT_REGISTRY_ADDRESS = process.env.AGENT_REGISTRY_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

const REGISTRY_ABI = [
    'function registerAgent(address owner, string uri) external returns (uint256)',
    'function attestSettlement(address owner, bool won) external',
    'function ownerToAgent(address owner) view returns (uint256)',
    'function getAgent(uint256 agentId) view returns (tuple(address owner, string uri, uint32 wins, uint32 settlements, uint32 reputation, bool active))',
];

let registryContract: ethers.Contract | null = null;
let registrySigner: ethers.Wallet | null = null;

function getRegistry(): ethers.Contract | null {
    if (!AGENT_REGISTRY_ADDRESS) return null;
    if (!registryContract) {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        registryContract = new ethers.Contract(AGENT_REGISTRY_ADDRESS, REGISTRY_ABI, provider);
        if (DEPLOYER_KEY) {
            registrySigner = new ethers.Wallet(DEPLOYER_KEY, provider);
            registryContract = registryContract.connect(registrySigner) as ethers.Contract;
        }
    }
    return registryContract;
}

/** Register agent on-chain and persist onChainAgentId on profile. */
export async function registerAgentOnChain(ownerId: string, walletAddress: string, uri = ''): Promise<string | null> {
    const contract = getRegistry();
    if (!contract || !registrySigner) return null;

    try {
        const existing = await contract.ownerToAgent(walletAddress);
        if (Number(existing) > 0) {
            return String(existing);
        }
        const tx = await contract.registerAgent(walletAddress, uri);
        await tx.wait();
        const agentId = await contract.ownerToAgent(walletAddress);
        const idStr = String(agentId);

        await prisma.agentProfile.updateMany({
            where: { ownerId },
            data: { onChainAgentId: idStr, walletAddress },
        });

        return idStr;
    } catch (err: any) {
        console.warn(`[AgentRegistry] registerAgent failed for ${walletAddress}: ${err.message}`);
        return null;
    }
}

/** Attest win/loss after settlement saga finalizes. */
export async function attestAgentSettlementOnChain(walletAddress: string, won: boolean): Promise<void> {
    const contract = getRegistry();
    if (!contract || !registrySigner) return;

    try {
        const agentId = await contract.ownerToAgent(walletAddress);
        if (Number(agentId) === 0) return;

        const tx = await contract.attestSettlement(walletAddress, won);
        await tx.wait();
        console.log(`[AgentRegistry] attestSettlement owner=${walletAddress} won=${won} agentId=${agentId}`);
    } catch (err: any) {
        console.warn(`[AgentRegistry] attestSettlement failed for ${walletAddress}: ${err.message}`);
    }
}
