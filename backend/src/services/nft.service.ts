import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';

// ============================================
// NFT Service — LeadNFTv2 Integration
// ============================================

// Read contract address — backend .env uses LEAD_NFT_CONTRACT_ADDRESS
const LEAD_NFT_ADDRESS = process.env.LEAD_NFT_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.LEAD_NFT_CONTRACT_ADDRESS || process.env.LEAD_NFT_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

// Startup diagnostics
console.log(`[NFT SERVICE] LEAD_NFT_ADDRESS=${LEAD_NFT_ADDRESS ? LEAD_NFT_ADDRESS.slice(0, 10) + '…' : '(empty)'}, DEPLOYER_KEY=${DEPLOYER_KEY ? 'set' : '(empty)'}, RPC=${RPC_URL.slice(0, 40)}`);

// LeadNFTv2 ABI — matches deployed contract at LEAD_NFT_CONTRACT_ADDRESS
const LEAD_NFT_ABI = [
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function totalSupply() view returns (uint256)',
    'function authorizedMinters(address) view returns (bool)',
    'function owner() view returns (address)',
    // v2 mintLead: 10 params (source is uint8 enum: 0=PLATFORM, 1=API, 2=OFFSITE)
    'function mintLead(address to, bytes32 platformLeadId, bytes32 vertical, bytes32 geoHash, bytes32 piiHash, uint96 reservePrice, uint40 expiresAt, uint8 source, bool tcpaConsent, string uri) returns (uint256)',
    // v2 recordSale: price is uint256
    'function recordSale(uint256 tokenId, address buyer, uint256 price)',
    'function setAuthorizedMinter(address minter, bool authorized)',
    'function verifyLead(uint256 tokenId)',
    // v2 read helpers — used by getTokenMetadata() and updateQualityScoreOnChain()
    'function getLeadMetadata(uint256 tokenId) view returns (tuple(bytes32 vertical, bytes32 geoHash, bytes32 dataHash, address seller, uint96 reservePrice, uint16 qualityScore, bool isVerified))',
    'function updateQualityScore(uint256 tokenId, uint16 score)',
];

// LeadSource enum values (mirrors ILeadNFT.sol)
const LEAD_SOURCE_MAP: Record<string, number> = {
    'PLATFORM': 0,
    'API': 1,
    'OFFSITE': 2,
};

interface MintResult {
    success: boolean;
    tokenId?: string;
    txHash?: string;
    error?: string;
    offChain?: boolean;
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
        } else {
            console.warn('[NFT SERVICE] ⚠️  Contract/signer not configured — NFT operations will use off-chain fallback');
        }
    }

    // ============================================
    // Mint Lead NFT (LeadNFTv2)
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
        const sellerAddress = lead.seller?.user?.walletAddress;
        if (!sellerAddress) {
            return { success: false, error: `Seller wallet missing for lead ${leadId} — cannot mint NFT to ZeroAddress` };
        }

        // v2 parameters
        const platformLeadId = ethers.keccak256(ethers.toUtf8Bytes(leadId));
        const verticalHash = ethers.keccak256(ethers.toUtf8Bytes(lead.vertical));
        const geoHash = ethers.keccak256(ethers.toUtf8Bytes(geo?.state || ''));
        const piiHash = lead.dataHash
            ? lead.dataHash
            : ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(lead.parameters || {})));
        const reservePrice = Math.floor(Number(lead.reservePrice || 0) * 1e6);
        // Expiry: at least 1 hour from now (contract requires future timestamp)
        const expiresAt = lead.expiresAt
            ? Math.max(Math.floor(new Date(lead.expiresAt).getTime() / 1000), Math.floor(Date.now() / 1000) + 3600)
            : Math.floor(Date.now() / 1000) + 3600;
        const sourceEnum = LEAD_SOURCE_MAP[lead.source] ?? 0;
        const tcpaConsent = !!lead.tcpaConsentAt;
        const uri = ''; // no off-chain metadata URI for now

        // On-chain mint
        if (this.contract && this.signer) {
            try {
                // Pre-flight diagnostics
                const signerAddr = await this.signer.getAddress();
                let contractOwner = 'unknown';
                let isMinterAuthorized = false;
                try {
                    contractOwner = await this.contract.owner();
                    isMinterAuthorized = await this.contract.authorizedMinters(signerAddr);
                } catch (e: any) {
                    console.warn('[NFT MINT] Could not read owner/authorizedMinters:', e.message);
                }

                console.log('[NFT MINT] ──── PRE-FLIGHT ────');
                console.log('[NFT MINT] Contract:', LEAD_NFT_ADDRESS);
                console.log('[NFT MINT] Signer:', signerAddr);
                console.log('[NFT MINT] Contract Owner:', contractOwner);
                console.log('[NFT MINT] Is Authorized Minter:', isMinterAuthorized);
                console.log('[NFT MINT] Is Owner:', signerAddr.toLowerCase() === contractOwner.toLowerCase());
                console.log('[NFT MINT] Params:', JSON.stringify({
                    to: sellerAddress,
                    platformLeadId,
                    vertical: verticalHash,
                    geoHash,
                    piiHash,
                    reservePrice,
                    expiresAt,
                    source: sourceEnum,
                    tcpaConsent,
                    uri,
                }, null, 2));

                // [CRE-DISPATCH] — log before on-chain mint so Render always shows this
                console.log(`[CRE-DISPATCH] mintLeadNFT starting — leadId=${leadId} seller=${sellerAddress} contract=${LEAD_NFT_ADDRESS.slice(0, 10)}…`);

                // Mint with dynamic gas + up to 3 retries (+3 gwei each) to avoid
                // "replacement fee too low" on Base Sepolia during consecutive runs.
                let tx: any;
                let lastMintErr: any;
                const feeData = await this.provider.getFeeData().catch(() => null);
                const baseMaxFee = feeData?.maxFeePerGas ?? ethers.parseUnits('12', 'gwei');
                for (let attempt = 0; attempt < 3; attempt++) {
                    const maxFeePerGas = baseMaxFee + ethers.parseUnits(String(attempt * 3), 'gwei');
                    try {
                        tx = await this.contract!.mintLead(
                            sellerAddress,
                            platformLeadId,
                            verticalHash,
                            geoHash,
                            piiHash,
                            reservePrice,
                            expiresAt,
                            sourceEnum,
                            tcpaConsent,
                            uri,
                            { gasLimit: 500_000, maxFeePerGas }
                        );
                        break; // success
                    } catch (retryErr: any) {
                        lastMintErr = retryErr;
                        const isReplacement = retryErr?.message?.includes('replacement fee too low') ||
                            retryErr?.code === 'REPLACEMENT_UNDERPRICED';
                        if (!isReplacement || attempt >= 2) throw retryErr;
                        console.warn(`[NFT MINT] Attempt ${attempt + 1} replacement fee too low — retrying with +3 gwei`);
                        await new Promise(r => setTimeout(r, 500));
                    }
                }
                console.log('[NFT MINT] Tx sent:', tx.hash);
                const receipt = await tx.wait();
                console.log('[NFT MINT] Tx confirmed, block:', receipt?.blockNumber);

                // Extract tokenId from Transfer event log.
                // ERC-721 Transfer: Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
                // topics[0]=sig, topics[1]=from, topics[2]=to, topics[3]=tokenId
                const TRANSFER_SIG = ethers.id('Transfer(address,address,uint256)');
                const transferLog = receipt?.logs?.find(
                    (log: any) => log.topics?.[0] === TRANSFER_SIG
                );

                let tokenId: string;
                if (transferLog?.topics?.[3]) {
                    // Preferred path: parse directly from indexed topic
                    tokenId = BigInt(transferLog.topics[3]).toString();
                } else {
                    // Fallback: decode log data via ABI (handles non-indexed variants)
                    // If still not found, abort — never write tokenId='0' to DB.
                    const fallbackSupply = await this.contract!.totalSupply();
                    if (!fallbackSupply || BigInt(fallbackSupply) === 0n) {
                        throw new Error('[NFT MINT] Could not extract tokenId from receipt and totalSupply()=0 — aborting to prevent ghost token write');
                    }
                    tokenId = BigInt(fallbackSupply).toString();
                    console.warn('[NFT MINT] ⚠️  tokenId extracted from totalSupply() fallback — verify receipt logs');
                }

                // Paranoia guard: token ID 0 is the "not tokenized" sentinel on-chain.
                // If somehow tokenId=0 reaches here, reject it rather than corrupt the DB.
                if (tokenId === '0') {
                    throw new Error('[NFT MINT] Invariant violation: tokenId=0 received — token ID 0 is the not-tokenized sentinel. Aborting DB write.');
                }

                // Update database with tokenId — NEVER overwrite encryptedData (PII).
                await prisma.lead.update({
                    where: { id: leadId },
                    data: {
                        nftTokenId: tokenId,
                        nftContractAddr: LEAD_NFT_ADDRESS,
                        nftMintTxHash: receipt?.hash || null,
                    },
                });

                console.log(`[CRE-DISPATCH] mintLeadNFT ✅ tokenId=${tokenId} txHash=${receipt?.hash}`);
                console.log(`[NFT MINT] ✅ Success — tokenId=${tokenId}, txHash=${receipt?.hash}`);
                return { success: true, tokenId, txHash: receipt?.hash };
            } catch (error: any) {
                console.error('[NFT MINT] ❌ On-chain mint FAILED:', error);
                // Surface the full error info
                const errorDetails = {
                    message: error.message,
                    code: error.code,
                    reason: error.reason,
                    data: error.data,
                    transaction: error.transaction,
                    revert: error.revert,
                    info: error.info,
                };
                // [DEMO-REVERT] — surface revert reason for Render log visibility
                console.error(
                    `[DEMO-REVERT] mintLeadNFT FAILED — ` +
                    `reason="${error.reason || error.revert?.name || '(no reason)'}" ` +
                    `data="${error.data || '(no data)'}" ` +
                    `code=${error.code || ''} ` +
                    `msg="${(error.message || '').slice(0, 160)}"`
                );
                console.error('[NFT MINT] Error details:', JSON.stringify(errorDetails, null, 2));
                return { success: false, error: JSON.stringify(errorDetails) };
            }
        }

        // No contract/signer — fail explicitly, no off-chain fallback
        const missing = [];
        if (!LEAD_NFT_ADDRESS) missing.push('LEAD_NFT_CONTRACT_ADDRESS');
        if (!DEPLOYER_KEY) missing.push('DEPLOYER_PRIVATE_KEY');
        const msg = `On-chain NFT mint not configured: missing ${missing.join(', ')}`;
        console.error(`[NFT MINT] ${msg}`);
        return { success: false, error: msg };
    }

    // ============================================
    // Schedule Mint Retry (BUG-08)
    // ============================================

    /**
     * Called by route handlers when mintLeadNFT() fails.
     *
     * - Persists nftMintFailed=true and nftMintError to the Lead record so the
     *   failure is visible in dashboards and queryable for re-trigger scripts.
     * - Sets nftMintRetryAt to retryDelayMs from now (default 5 minutes).
     * - Does NOT throw — always returns gracefully so the caller (e.g. confirm-
     *   escrow, demo settle) can continue completing the user-facing flow.
     *
     * Production re-trigger: a cron / admin command queries
     *   WHERE nftMintFailed=true AND nftMintRetryAt <= now() AND nftTokenId IS NULL
     * and calls mintLeadNFT() for each.
     */
    async scheduleMintRetry(
        leadId: string,
        error: string,
        retryDelayMs = 5 * 60 * 1000, // 5 minutes
    ): Promise<void> {
        const retryAt = new Date(Date.now() + retryDelayMs);
        const truncatedError = error.slice(0, 500); // Guard against oversized error blobs

        console.warn(
            `[NFT MINT] ⚠️  BUG-08 graceful degradation — lead=${leadId} mint failed.` +
            ` Flag set: nftMintFailed=true. Retry scheduled at ${retryAt.toISOString()}.` +
            ` Error: ${truncatedError}`,
        );

        try {
            await prisma.lead.update({
                where: { id: leadId },
                data: {
                    nftMintFailed: true,
                    nftMintError: truncatedError,
                    nftMintRetryAt: retryAt,
                },
            });
        } catch (dbErr: any) {
            // Non-fatal: log but don't rethrow — the lead sale already succeeded.
            console.error(`[NFT MINT] scheduleMintRetry DB update failed for lead=${leadId}:`, dbErr.message);
        }
    }


    // ============================================
    // Record Sale On-Chain
    // ============================================

    async recordSaleOnChain(
        nftTokenId: string,
        buyerAddress: string,
        salePrice: number
    ): Promise<{ success: boolean; txHash?: string; error?: string; offChain?: boolean }> {
        const salePriceWei = Math.floor(salePrice * 1e6);

        if (!this.contract || !this.signer) {
            return { success: false, error: 'On-chain NFT contract not configured — cannot record sale' };
        }

        try {
            console.log(`[NFT SALE] Recording sale — tokenId=${nftTokenId}, buyer=${buyerAddress}, price=${salePriceWei}`);
            const tx = await this.contract.recordSale(nftTokenId, buyerAddress, salePriceWei, { gasLimit: 200_000 });
            const receipt = await tx.wait();
            console.log(`[NFT SALE] ✅ Sale recorded — txHash=${receipt?.hash}`);
            return { success: true, txHash: receipt?.hash };
        } catch (error: any) {
            console.error('[NFT SALE] ❌ recordSale failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // Get Token Metadata
    // ============================================

    async getTokenMetadata(nftTokenId: string): Promise<TokenMetadata | null> {
        if (this.contract) {
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
            qualityScore: 0,
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
    ): Promise<{ success: boolean; error?: string; offChain?: boolean }> {
        if (this.contract && this.signer) {
            try {
                const tx = await this.contract.updateQualityScore(nftTokenId, score);
                await tx.wait();
                return { success: true };
            } catch (error: any) {
                console.error('NFT updateQualityScore on-chain failed:', error);
                return { success: false, error: error.message };
            }
        }

        return { success: false, error: 'On-chain NFT contract not configured — cannot update quality score' };
    }
}

export const nftService = new NFTService();
