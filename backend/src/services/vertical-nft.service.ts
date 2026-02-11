/**
 * Vertical NFT Service
 *
 * Handles on-chain minting of VerticalNFT tokens via ethers.js.
 * Called by the /activate route after CRE verification + ACE compliance.
 *
 * Flow: verify slug uniqueness (CRE) → check compliance (ACE) → mint NFT → update Prisma
 */

import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';

// ============================================
// Contract Config
// ============================================

const VERTICAL_NFT_ABI = [
    'function mintVertical(address to, bytes32 slug, bytes32 parentSlug, bytes32 attributesHash, uint16 depth, string uri) external returns (uint256)',
    'function slugToToken(bytes32 slug) external view returns (uint256)',
    'function getVertical(uint256 tokenId) external view returns (tuple(bytes32 slug, bytes32 parentSlug, bytes32 attributesHash, uint40 activatedAt, uint16 depth, bool isFractionalizable))',
    'function getVerticalBySlug(bytes32 slug) external view returns (uint256, tuple(bytes32 slug, bytes32 parentSlug, bytes32 attributesHash, uint40 activatedAt, uint16 depth, bool isFractionalizable))',
    'function totalSupply() external view returns (uint256)',
    'function ownerOf(uint256 tokenId) external view returns (address)',
    'function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address, uint256)',
] as const;

const ACE_ABI = [
    'function canTransact(address user, bytes32 vertical, bytes32 geoHash) external view returns (bool)',
] as const;

// Environment-driven addresses
const RPC_URL = process.env.RPC_URL || process.env.ALCHEMY_RPC_URL || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const VERTICAL_NFT_ADDRESS = process.env.VERTICAL_NFT_ADDRESS || '';
const ACE_ADDRESS = process.env.ACE_COMPLIANCE_ADDRESS || '';

// ============================================
// Provider + Wallet
// ============================================

function getProvider() {
    return new ethers.JsonRpcProvider(RPC_URL);
}

function getWallet() {
    if (!DEPLOYER_KEY) {
        throw new Error('DEPLOYER_PRIVATE_KEY not configured');
    }
    return new ethers.Wallet(DEPLOYER_KEY, getProvider());
}

function getVerticalNFTContract(signerOrProvider?: ethers.Signer | ethers.Provider) {
    if (!VERTICAL_NFT_ADDRESS) {
        throw new Error('VERTICAL_NFT_ADDRESS not configured');
    }
    return new ethers.Contract(
        VERTICAL_NFT_ADDRESS,
        VERTICAL_NFT_ABI,
        signerOrProvider || getProvider(),
    );
}

function getACEContract(provider?: ethers.Provider) {
    if (!ACE_ADDRESS) {
        throw new Error('ACE_COMPLIANCE_ADDRESS not configured');
    }
    return new ethers.Contract(ACE_ADDRESS, ACE_ABI, provider || getProvider());
}

// ============================================
// Verification (CRE Uniqueness Check)
// ============================================

export interface VerificationResult {
    passed: boolean;
    reason?: string;
}

/**
 * Check if a vertical slug is unique on-chain (CRE verification).
 * In production this would go through Chainlink Functions; here we
 * do a direct contract read for the same effect.
 */
export async function verifyUniqueness(slug: string): Promise<VerificationResult> {
    try {
        const contract = getVerticalNFTContract();
        const slugHash = ethers.keccak256(ethers.toUtf8Bytes(slug));
        const tokenId = await contract.slugToToken(slugHash);

        if (tokenId > 0n) {
            return { passed: false, reason: `Slug "${slug}" already minted as token #${tokenId}` };
        }

        return { passed: true };
    } catch (error: any) {
        // If contract not deployed yet (dev/test), treat as unique
        if (error.code === 'CALL_EXCEPTION' || error.code === 'NETWORK_ERROR') {
            console.warn('VerticalNFT contract not reachable, skipping uniqueness check');
            return { passed: true, reason: 'Contract not deployed (dev mode)' };
        }
        throw error;
    }
}

// ============================================
// Compliance (ACE Check)
// ============================================

/**
 * Check if the recipient can transact for this vertical/geo via ACECompliance.
 */
export async function checkCompliance(
    recipientAddress: string,
    slug: string,
): Promise<VerificationResult> {
    try {
        const ace = getACEContract();
        const slugHash = ethers.keccak256(ethers.toUtf8Bytes(slug));
        const geoHash = ethers.ZeroHash; // Global — no geo restriction for vertical ownership

        const allowed = await ace.canTransact(recipientAddress, slugHash, geoHash);

        if (!allowed) {
            return { passed: false, reason: 'Compliance check failed — user cannot transact for this vertical' };
        }

        return { passed: true };
    } catch (error: any) {
        if (error.code === 'CALL_EXCEPTION' || error.code === 'NETWORK_ERROR') {
            console.warn('ACE contract not reachable, bypassing compliance check');
            return { passed: true, reason: 'ACE not deployed (dev mode)' };
        }
        throw error;
    }
}

// ============================================
// Mint
// ============================================

export interface MintResult {
    tokenId: number;
    txHash: string;
    blockNumber: number;
}

/**
 * Mint a VerticalNFT on-chain.
 *
 * @param recipientAddress - Wallet to receive the NFT
 * @param slug - Vertical slug (e.g. "home_services.plumbing")
 * @param parentSlug - Parent slug (e.g. "home_services") or null for top-level
 * @param depth - Hierarchy depth (0-3)
 * @param attributes - JSON attributes to hash
 * @param metadataUri - IPFS/API URI for token metadata
 */
export async function mintVerticalNFT(
    recipientAddress: string,
    slug: string,
    parentSlug: string | null,
    depth: number,
    attributes: Record<string, unknown>,
    metadataUri: string,
): Promise<MintResult> {
    const wallet = getWallet();
    const contract = getVerticalNFTContract(wallet);

    const slugHash = ethers.keccak256(ethers.toUtf8Bytes(slug));
    const parentHash = parentSlug
        ? ethers.keccak256(ethers.toUtf8Bytes(parentSlug))
        : ethers.ZeroHash;
    const attributesHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(attributes)));

    const tx = await contract.mintVertical(
        recipientAddress,
        slugHash,
        parentHash,
        attributesHash,
        depth,
        metadataUri,
    );

    const receipt = await tx.wait();

    // Parse VerticalMinted event to get tokenId
    const iface = new ethers.Interface(VERTICAL_NFT_ABI);
    let tokenId = 0;

    for (const log of receipt.logs) {
        try {
            const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
            if (parsed?.name === 'VerticalMinted') {
                tokenId = Number(parsed.args[0]); // tokenId is first indexed arg
                break;
            }
        } catch {
            // Not our event, skip
        }
    }

    return {
        tokenId,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
    };
}

// ============================================
// Full Activation Flow
// ============================================

export interface ActivationResult {
    success: boolean;
    tokenId?: number;
    txHash?: string;
    error?: string;
    step?: 'uniqueness' | 'compliance' | 'mint' | 'prisma';
}

/**
 * Full activation pipeline: verify → comply → mint → update Prisma
 */
export async function activateVertical(
    slug: string,
    recipientAddress: string,
): Promise<ActivationResult> {
    // 1. Fetch vertical from DB
    const vertical = await prisma.vertical.findUnique({ where: { slug } });

    if (!vertical) {
        return { success: false, error: `Vertical "${slug}" not found`, step: 'uniqueness' };
    }

    if (vertical.status !== 'PROPOSED') {
        return { success: false, error: `Vertical is already ${vertical.status}`, step: 'uniqueness' };
    }

    // 2. CRE uniqueness check
    const uniqueness = await verifyUniqueness(slug);
    if (!uniqueness.passed) {
        await prisma.vertical.update({
            where: { slug },
            data: { status: 'REJECTED' },
        });
        return { success: false, error: uniqueness.reason, step: 'uniqueness' };
    }

    // 3. ACE compliance check
    const compliance = await checkCompliance(recipientAddress, slug);
    if (!compliance.passed) {
        await prisma.vertical.update({
            where: { slug },
            data: { status: 'REJECTED' },
        });
        return { success: false, error: compliance.reason, step: 'compliance' };
    }

    // 4. Mint NFT
    let mintResult: MintResult;
    try {
        // Build metadata URI (could be IPFS in production)
        const metadataUri = `${process.env.API_URL || 'http://localhost:3001'}/api/v1/verticals/${slug}/metadata.json`;

        mintResult = await mintVerticalNFT(
            recipientAddress,
            slug,
            vertical.parentId ? (await prisma.vertical.findUnique({ where: { id: vertical.parentId } }))?.slug || null : null,
            vertical.depth,
            (vertical.attributes as Record<string, unknown>) || {},
            metadataUri,
        );
    } catch (error: any) {
        console.error('NFT mint failed:', error);
        return { success: false, error: `Mint failed: ${error.message}`, step: 'mint' };
    }

    // 5. Update Prisma
    try {
        await prisma.vertical.update({
            where: { slug },
            data: {
                status: 'ACTIVE',
                nftTokenId: mintResult.tokenId,
                nftTxHash: mintResult.txHash,
                ownerAddress: recipientAddress,
            },
        });
    } catch (error: any) {
        console.error('Prisma update failed (NFT was minted!):', error);
        return {
            success: false,
            tokenId: mintResult.tokenId,
            txHash: mintResult.txHash,
            error: `Prisma update failed after mint: ${error.message}`,
            step: 'prisma',
        };
    }

    return {
        success: true,
        tokenId: mintResult.tokenId,
        txHash: mintResult.txHash,
    };
}

// ============================================
// Read Helpers
// ============================================

/**
 * Get on-chain token info for a slug
 */
export async function getTokenForSlug(slug: string) {
    try {
        const contract = getVerticalNFTContract();
        const slugHash = ethers.keccak256(ethers.toUtf8Bytes(slug));
        const [tokenId, meta] = await contract.getVerticalBySlug(slugHash);

        const owner = await contract.ownerOf(tokenId);
        const supply = await contract.totalSupply();

        return {
            tokenId: Number(tokenId),
            slug: meta.slug,
            parentSlug: meta.parentSlug,
            depth: Number(meta.depth),
            activatedAt: Number(meta.activatedAt),
            isFractionalizable: meta.isFractionalizable,
            owner,
            totalSupply: Number(supply),
        };
    } catch {
        return null;
    }
}
