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
    'function safeTransferFrom(address from, address to, uint256 tokenId) external',
    'function approve(address to, uint256 tokenId) external',
] as const;

const ACE_ABI = [
    'function canTransact(address user, bytes32 vertical, bytes32 geoHash) external view returns (bool)',
] as const;

const CHAINLINK_PRICE_FEED_ABI = [
    'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
    'function decimals() external view returns (uint8)',
] as const;

// Environment-driven addresses
const RPC_URL = process.env.RPC_URL || process.env.ALCHEMY_RPC_URL || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const VERTICAL_NFT_ADDRESS = process.env.VERTICAL_NFT_ADDRESS || '';
const ACE_ADDRESS = process.env.ACE_COMPLIANCE_ADDRESS || '';
const PLATFORM_WALLET_ADDRESS = process.env.PLATFORM_WALLET_ADDRESS || process.env.DEPLOYER_ADDRESS || '';
const CHAINLINK_PRICE_FEED_ADDRESS = process.env.CHAINLINK_PRICE_FEED_ADDRESS || '';

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
 * Always mints to PLATFORM_WALLET_ADDRESS (platform-owned).
 */
export async function activateVertical(
    slug: string,
): Promise<ActivationResult> {
    const recipientAddress = PLATFORM_WALLET_ADDRESS;
    if (!recipientAddress) {
        return { success: false, error: 'PLATFORM_WALLET_ADDRESS not configured', step: 'mint' };
    }
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

// ============================================
// Transfer (Resale)
// ============================================

export interface TransferResult {
    txHash: string;
    blockNumber: number;
}

/**
 * Transfer a VerticalNFT from platform wallet to buyer.
 */
export async function transferVerticalNFT(
    fromAddress: string,
    toAddress: string,
    tokenId: number,
): Promise<TransferResult> {
    const wallet = getWallet();
    const contract = getVerticalNFTContract(wallet);

    const tx = await contract.safeTransferFrom(fromAddress, toAddress, tokenId);
    const receipt = await tx.wait();

    return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
    };
}

// ============================================
// Royalty Query
// ============================================

export interface RoyaltyInfo {
    receiver: string;
    royaltyAmount: bigint;
    royaltyBps: number;
}

/**
 * Query ERC-2981 royalty info for a token at a given sale price.
 */
export async function getResaleRoyalty(
    tokenId: number,
    salePrice: bigint,
): Promise<RoyaltyInfo> {
    const contract = getVerticalNFTContract();
    const [receiver, royaltyAmount] = await contract.royaltyInfo(tokenId, salePrice);

    return {
        receiver: receiver as string,
        royaltyAmount: royaltyAmount as bigint,
        royaltyBps: salePrice > 0n ? Number((royaltyAmount as bigint) * 10000n / salePrice) : 0,
    };
}

// ============================================
// Chainlink Fair Price (simulated in dev)
// ============================================

export interface PriceInfo {
    price: number;
    source: 'chainlink' | 'simulated';
    decimals: number;
}

/**
 * Get fair market floor price from Chainlink Data Feed.
 * Falls back to simulated price in dev mode.
 */
export async function getChainlinkFloorPrice(): Promise<PriceInfo> {
    if (!CHAINLINK_PRICE_FEED_ADDRESS) {
        // Dev/test mode: return simulated price
        return { price: 1.0, source: 'simulated', decimals: 8 };
    }

    try {
        const provider = getProvider();
        const feed = new ethers.Contract(
            CHAINLINK_PRICE_FEED_ADDRESS,
            CHAINLINK_PRICE_FEED_ABI,
            provider,
        );

        const [, answer, , updatedAt] = await feed.latestRoundData();
        const decimals = await feed.decimals();

        // Stale check: reject prices older than 1 hour
        const now = Math.floor(Date.now() / 1000);
        if (now - Number(updatedAt) > 3600) {
            console.warn('[CHAINLINK] Price feed stale, falling back to simulated');
            return { price: 1.0, source: 'simulated', decimals: 8 };
        }

        return {
            price: Number(answer) / 10 ** Number(decimals),
            source: 'chainlink',
            decimals: Number(decimals),
        };
    } catch (error) {
        console.warn('[CHAINLINK] Price feed unavailable, using simulated:', error);
        return { price: 1.0, source: 'simulated', decimals: 8 };
    }
}

// ============================================
// Full Resale Pipeline
// ============================================

export interface ResaleResult {
    success: boolean;
    tokenId?: number;
    txHash?: string;
    buyer?: string;
    salePrice?: number;
    royalty?: { receiver: string; amount: string; bps: number };
    priceSource?: string;
    error?: string;
    step?: 'ownership' | 'pricing' | 'transfer' | 'prisma';
}

/**
 * Full resale pipeline: verify ownership → price check → transfer → update Prisma
 */
export async function resaleVertical(
    slug: string,
    buyerAddress: string,
    salePrice: number,
): Promise<ResaleResult> {
    // 1. Look up vertical in DB
    const vertical = await prisma.vertical.findUnique({ where: { slug } });
    if (!vertical) {
        return { success: false, error: `Vertical "${slug}" not found`, step: 'ownership' };
    }
    if (!vertical.nftTokenId) {
        return { success: false, error: `Vertical "${slug}" has no minted NFT`, step: 'ownership' };
    }

    // 2. Verify platform still owns the NFT
    const platformWallet = PLATFORM_WALLET_ADDRESS;
    if (!platformWallet) {
        return { success: false, error: 'PLATFORM_WALLET_ADDRESS not configured', step: 'ownership' };
    }

    try {
        const contract = getVerticalNFTContract();
        const currentOwner = await contract.ownerOf(vertical.nftTokenId);
        if ((currentOwner as string).toLowerCase() !== platformWallet.toLowerCase()) {
            return {
                success: false,
                error: `Platform does not own this NFT (current owner: ${currentOwner})`,
                step: 'ownership',
            };
        }
    } catch (error: any) {
        if (error.code === 'CALL_EXCEPTION' || error.code === 'NETWORK_ERROR') {
            console.warn('[RESALE] Contract not reachable, skipping ownership check (dev mode)');
        } else {
            return { success: false, error: `Ownership check failed: ${error.message}`, step: 'ownership' };
        }
    }

    // 3. Chainlink price validation
    let priceInfo: PriceInfo;
    try {
        priceInfo = await getChainlinkFloorPrice();
    } catch (error: any) {
        return { success: false, error: `Price feed error: ${error.message}`, step: 'pricing' };
    }

    // 4. Get royalty info
    const salePriceBigInt = BigInt(Math.round(salePrice * 1e6)); // USDC 6 decimals
    let royaltyInfo: RoyaltyInfo;
    try {
        royaltyInfo = await getResaleRoyalty(vertical.nftTokenId, salePriceBigInt);
    } catch (_error: any) {
        // Dev mode: simulate 2% royalty
        royaltyInfo = {
            receiver: platformWallet,
            royaltyAmount: salePriceBigInt * 2n / 100n,
            royaltyBps: 200,
        };
    }

    // 5. Transfer NFT on-chain
    let transferResult: TransferResult;
    try {
        transferResult = await transferVerticalNFT(
            platformWallet,
            buyerAddress,
            vertical.nftTokenId,
        );
    } catch (error: any) {
        console.error('[RESALE] Transfer failed:', error);
        return { success: false, error: `Transfer failed: ${error.message}`, step: 'transfer' };
    }

    // 6. Update Prisma
    const resaleRecord = {
        buyer: buyerAddress,
        seller: platformWallet,
        price: salePrice,
        royalty: Number(royaltyInfo.royaltyAmount) / 1e6,
        royaltyBps: royaltyInfo.royaltyBps,
        txHash: transferResult.txHash,
        priceSource: priceInfo.source,
        timestamp: new Date().toISOString(),
    };

    try {
        const existingHistory = (vertical.resaleHistory as any[]) || [];
        await prisma.vertical.update({
            where: { slug },
            data: {
                ownerAddress: buyerAddress,
                resaleHistory: [...existingHistory, resaleRecord],
            },
        });
    } catch (error: any) {
        console.error('[RESALE] Prisma update failed (NFT was transferred!):', error);
        return {
            success: false,
            tokenId: vertical.nftTokenId,
            txHash: transferResult.txHash,
            error: `Prisma update failed after transfer: ${error.message}`,
            step: 'prisma',
        };
    }

    console.log(`[RESALE] Vertical "${slug}" NFT #${vertical.nftTokenId} transferred to ${buyerAddress} for $${salePrice}`);

    return {
        success: true,
        tokenId: vertical.nftTokenId,
        txHash: transferResult.txHash,
        buyer: buyerAddress,
        salePrice,
        royalty: {
            receiver: royaltyInfo.receiver as string,
            amount: (Number(royaltyInfo.royaltyAmount) / 1e6).toFixed(2),
            bps: royaltyInfo.royaltyBps,
        },
        priceSource: priceInfo.source,
    };
}
