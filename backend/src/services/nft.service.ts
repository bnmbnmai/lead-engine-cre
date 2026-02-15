import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { privacyService } from './privacy.service';

// ============================================
// NFT Service — LeadNFTv2 Integration
// ============================================

const LEAD_NFT_ADDRESS = process.env.LEAD_NFT_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_SEPOLIA || 'https://eth-sepolia.g.alchemy.com/v2/demo';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

const LEAD_NFT_ABI = [
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function getLeadMetadata(uint256 tokenId) view returns (tuple(bytes32 vertical, bytes32 geoHash, bytes32 dataHash, address seller, uint96 reservePrice, uint40 createdAt, uint16 qualityScore, bool isVerified))',
    'function totalSupply() view returns (uint256)',
    'function mintLead(address to, bytes32 vertical, bytes32 geoHash, bytes32 dataHash, uint96 reservePrice) returns (uint256 tokenId)',
    'function recordSale(uint256 tokenId, address buyer, uint96 salePrice)',
    'function updateQualityScore(uint256 tokenId, uint16 score)',
    'function setTokenURI(uint256 tokenId, string uri)',
];

interface MintResult {
    success: boolean;
    tokenId?: string;
    txHash?: string;
    error?: string;
}

interface TokenMetadata {
    tokenId: string;
    vertical: string;
    geoHash: string;
    dataHash: string;
    seller: string;
    reservePrice: number;
    qualityScore: number;
    isVerified: boolean;
    owner: string;
    tokenURI?: string;
}

class NFTService {
    private provider: ethers.JsonRpcProvider;
    private contract: ethers.Contract | null = null;
    private signer: ethers.Wallet | null = null;

    constructor() {
        this.provider = new ethers.JsonRpcProvider(RPC_URL);

        if (DEPLOYER_KEY) {
            this.signer = new ethers.Wallet(DEPLOYER_KEY, this.provider);
        }

        if (LEAD_NFT_ADDRESS && this.signer) {
            this.contract = new ethers.Contract(LEAD_NFT_ADDRESS, LEAD_NFT_ABI, this.signer);
        }
    }

    // ============================================
    // Mint Lead NFT
    // ============================================

    async mintLeadNFT(leadId: string): Promise<MintResult> {
        const lead = await prisma.lead.findUnique({
            where: { id: leadId },
            include: { seller: { include: { user: true } } },
        });

        if (!lead) {
            return { success: false, error: 'Lead not found' };
        }

        // Already minted
        if (lead.nftTokenId) {
            return { success: true, tokenId: lead.nftTokenId };
        }

        const geo = lead.geo as any;
        const verticalHash = ethers.keccak256(ethers.toUtf8Bytes(lead.vertical));
        const geoHash = ethers.keccak256(ethers.toUtf8Bytes(geo?.state || ''));
        const dataHash = lead.dataHash
            ? lead.dataHash
            : ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(lead.parameters || {})));
        const reservePrice = Math.floor(Number(lead.reservePrice || 0) * 1e6);
        const sellerAddress = lead.seller?.user?.walletAddress || ethers.ZeroAddress;

        // On-chain mint
        if (this.contract && this.signer) {
            try {
                const tx = await this.contract.mintLead(
                    sellerAddress, verticalHash, geoHash, dataHash, reservePrice
                );
                const receipt = await tx.wait();

                // Extract tokenId from Transfer event
                const transferLog = receipt?.logs?.find(
                    (log: any) => log.topics?.[0] === ethers.id('Transfer(address,address,uint256)')
                );
                const tokenId = transferLog
                    ? BigInt(transferLog.topics[3]).toString()
                    : (await this.contract!.totalSupply()).toString();

                // Update database with tokenId — NEVER overwrite encryptedData (PII).
                // The on-chain mint already used only verticalHash/geoHash/dataHash
                // (no PII). The original AES-256-GCM PII in encryptedData must be
                // preserved so the settled buyer can decrypt it later.
                await prisma.lead.update({
                    where: { id: leadId },
                    data: {
                        nftTokenId: tokenId,
                        nftContractAddr: LEAD_NFT_ADDRESS,
                    },
                });

                return { success: true, tokenId, txHash: receipt?.hash };
            } catch (error: any) {
                console.error('NFT mintLeadNFT on-chain failed:', error);
                return { success: false, error: error.message };
            }
        }

        // Off-chain fallback: generate pseudo-tokenId
        const offchainTokenId = `offchain-${Date.now()}`;

        await prisma.lead.update({
            where: { id: leadId },
            data: {
                nftTokenId: offchainTokenId,
            },
        });

        return { success: true, tokenId: offchainTokenId };
    }

    // ============================================
    // Record Sale On-Chain
    // ============================================

    async recordSaleOnChain(
        nftTokenId: string,
        buyerAddress: string,
        salePrice: number
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        const salePriceWei = Math.floor(salePrice * 1e6);

        if (this.contract && this.signer && !nftTokenId.startsWith('offchain-')) {
            try {
                const tx = await this.contract.recordSale(nftTokenId, buyerAddress, salePriceWei);
                const receipt = await tx.wait();
                return { success: true, txHash: receipt?.hash };
            } catch (error: any) {
                console.error('NFT recordSale on-chain failed:', error);
                return { success: false, error: error.message };
            }
        }

        console.log(`NFT sale recorded off-chain: token=${nftTokenId}, buyer=${buyerAddress}, price=${salePrice}`);
        return { success: true };
    }

    // ============================================
    // Get Token Metadata
    // ============================================

    async getTokenMetadata(nftTokenId: string): Promise<TokenMetadata | null> {
        if (this.contract && !nftTokenId.startsWith('offchain-')) {
            try {
                const [metadata, owner, uri] = await Promise.all([
                    this.contract.getLeadMetadata(nftTokenId),
                    this.contract.ownerOf(nftTokenId),
                    this.contract.tokenURI(nftTokenId).catch(() => ''),
                ]);

                return {
                    tokenId: nftTokenId,
                    vertical: ethers.toUtf8String(metadata.vertical).replace(/\0/g, ''),
                    geoHash: metadata.geoHash,
                    dataHash: metadata.dataHash,
                    seller: metadata.seller,
                    reservePrice: Number(metadata.reservePrice) / 1e6,
                    qualityScore: Number(metadata.qualityScore),
                    isVerified: metadata.isVerified,
                    owner,
                    tokenURI: uri,
                };
            } catch (error) {
                console.error('NFT getTokenMetadata on-chain failed:', error);
            }
        }

        // Fallback: check database
        const lead = await prisma.lead.findFirst({
            where: { nftTokenId },
            include: { seller: { include: { user: true } } },
        });

        if (!lead) return null;

        const geo = lead.geo as any;
        return {
            tokenId: nftTokenId,
            vertical: lead.vertical,
            geoHash: ethers.keccak256(ethers.toUtf8Bytes(geo?.state || '')),
            dataHash: lead.dataHash || ethers.ZeroHash,
            seller: lead.seller?.user?.walletAddress || ethers.ZeroAddress,
            reservePrice: Number(lead.reservePrice || 0),
            qualityScore: 5000,
            isVerified: lead.isVerified,
            owner: lead.seller?.user?.walletAddress || ethers.ZeroAddress,
        };
    }

    // ============================================
    // Update Quality Score On-Chain
    // ============================================

    async updateQualityScoreOnChain(
        nftTokenId: string,
        score: number
    ): Promise<{ success: boolean; error?: string }> {
        if (this.contract && this.signer && !nftTokenId.startsWith('offchain-')) {
            try {
                const tx = await this.contract.updateQualityScore(nftTokenId, score);
                await tx.wait();
                return { success: true };
            } catch (error: any) {
                console.error('NFT updateQualityScore on-chain failed:', error);
                return { success: false, error: error.message };
            }
        }

        return { success: true };
    }
}

export const nftService = new NFTService();
