import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { prisma } from '../lib/prisma';
import { crossBorderRequirements, getPolicy } from '../lib/jurisdiction-policies';
import { isValidRegion } from '../lib/geo-registry';

// Global event bus for dev-log events (consumed by socket layer → frontend DevLog panel)
export const aceDevBus = new EventEmitter();
function devLog(action: string, data: Record<string, unknown>) {
    const entry = { ts: new Date().toISOString(), action, ...data };
    console.log(`[ACE:DEV] ${action}`, JSON.stringify(data));
    aceDevBus.emit('ace:dev-log', entry);
}

// ============================================
// ACE Compliance Service
// ============================================

const ACE_CONTRACT_ADDRESS = process.env.ACE_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.ACE_CONTRACT_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

if (!process.env.ACE_CONTRACT_ADDRESS_BASE_SEPOLIA) {
    console.warn('[ACE] ⚠️ ACE_CONTRACT_ADDRESS_BASE_SEPOLIA not set! Falling back to ACE_CONTRACT_ADDRESS which may be on wrong chain.');
    console.warn('[ACE]    Set ACE_CONTRACT_ADDRESS_BASE_SEPOLIA=0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6 in your env vars.');
}
if (!DEPLOYER_KEY) {
    console.warn('[ACE] ⚠️ DEPLOYER_PRIVATE_KEY not set! On-chain verifyKYC will fail (no signer).');
}
console.log(`[ACE] Using contract address: ${ACE_CONTRACT_ADDRESS || '(none)'}`);
console.log(`[ACE] Using RPC: ${RPC_URL}`);
console.log(`[ACE] Deployer key: ${DEPLOYER_KEY ? 'SET' : 'NOT SET'}`);

// ACE Contract ABI — Basescan-verified for deployed contract on Base Sepolia
// Address: 0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6
const ACE_ABI = [
    // Read
    'function isKYCValid(address user) view returns (bool)',
    'function checkKYCStatus(address user) view returns (uint8)',
    'function canTransact(address user, bytes32 vertical, bytes32 geoHash) view returns (bool)',
    'function getReputationScore(address user) view returns (uint16)',
    'function getUserCompliance(address user) view returns (tuple(uint8 kycStatus, uint8 amlStatus, bytes32 jurisdictionHash, uint40 kycExpiresAt, uint40 lastChecked, uint16 reputationScore, bool isBlacklisted))',
    'function isJurisdictionAllowed(bytes32 jurisdictionHash, bytes32 verticalHash) view returns (bool)',
    // Write
    'function verifyKYC(address user, bytes32 proofHash, bytes zkProof)',
    'function updateReputationScore(address user, int16 delta)',
    'function setJurisdictionPolicy(bytes32 jurisdictionHash, bytes32 verticalHash, bool allowed)',
    'function setDefaultVerticalPolicy(bytes32 vertical, bool allowed)',
];

class ACEService {
    private provider: ethers.JsonRpcProvider;
    private contract: ethers.Contract | null = null;
    private signer: ethers.Wallet | null = null;

    constructor() {
        this.provider = new ethers.JsonRpcProvider(RPC_URL);

        if (ACE_CONTRACT_ADDRESS) {
            this.contract = new ethers.Contract(ACE_CONTRACT_ADDRESS, ACE_ABI, this.provider);
            devLog('init', { contractAddress: ACE_CONTRACT_ADDRESS, rpc: RPC_URL, hasSigner: !!DEPLOYER_KEY });

            if (DEPLOYER_KEY) {
                this.signer = new ethers.Wallet(DEPLOYER_KEY, this.provider);
                this.contract = this.contract.connect(this.signer) as ethers.Contract;
            }
        } else {
            devLog('init', { contractAddress: 'NONE — contract disabled', rpc: RPC_URL });
        }
    }

    // ============================================
    // KYC Verification
    // ============================================

    async isKYCValid(walletAddress: string): Promise<boolean> {
        // DEMO_MODE bypass removed — KYC always enforced
        if (process.env.DEMO_MODE === 'true') {
            console.warn(`[ACE] ⚠️ DEMO_MODE is set but KYC is still enforced. Remove DEMO_MODE from production.`);
        }

        // Check local cache first
        const cached = await prisma.complianceCheck.findFirst({
            where: {
                entityType: 'user',
                entityId: walletAddress.toLowerCase(),
                checkType: 'KYC',
                status: 'PASSED',
                expiresAt: { gt: new Date() },
            },
        });

        if (cached) return true;

        // Check on-chain if contract available
        if (this.contract) {
            try {
                const isValid = await this.contract.isKYCValid(walletAddress);

                // Cache result
                await prisma.complianceCheck.create({
                    data: {
                        entityType: 'user',
                        entityId: walletAddress.toLowerCase(),
                        checkType: 'KYC',
                        status: isValid ? 'PASSED' : 'FAILED',
                        checkedAt: new Date(),
                        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h cache
                    },
                });

                return isValid;
            } catch (error) {
                console.error('ACE KYC check failed:', error);
            }
        }

        // Fallback: check database
        const user = await prisma.user.findUnique({
            where: { walletAddress: walletAddress.toLowerCase() },
            include: { buyerProfile: true, sellerProfile: true },
        });

        const profile = user?.buyerProfile || user?.sellerProfile;
        return profile?.kycStatus === 'VERIFIED';
    }

    // ============================================
    // Transaction Eligibility
    // ============================================

    async canTransact(
        walletAddress: string,
        vertical: string,
        geoHash: string
    ): Promise<{ allowed: boolean; reason?: string }> {
        // DEMO_MODE bypass removed — compliance always enforced
        if (process.env.DEMO_MODE === 'true') {
            console.warn(`[ACE] ⚠️ DEMO_MODE is set but compliance is still enforced.`);
        }

        // Check blacklist first
        const isBlacklisted = await this.isBlacklisted(walletAddress);
        if (isBlacklisted) {
            return { allowed: false, reason: 'User is blacklisted' };
        }

        // Check KYC
        const kycValid = await this.isKYCValid(walletAddress);
        if (!kycValid) {
            return { allowed: false, reason: 'KYC verification required' };
        }

        // Check on-chain — Basescan: canTransact(address, bytes32, bytes32)
        if (this.contract) {
            try {
                const verticalHash = ethers.keccak256(ethers.toUtf8Bytes(vertical || 'default'));
                const geoHashBytes = ethers.keccak256(ethers.toUtf8Bytes(geoHash || 'default'));

                devLog('canTransact:call', {
                    wallet: walletAddress,
                    vertical,
                    verticalHash,
                    geoHash,
                    geoHashBytes,
                    contractAddress: ACE_CONTRACT_ADDRESS,
                });

                const canTx = await this.contract.canTransact(walletAddress, verticalHash, geoHashBytes);

                devLog('canTransact:result', { wallet: walletAddress, vertical, allowed: canTx });

                if (!canTx) {
                    return { allowed: false, reason: 'Compliance check failed on-chain' };
                }
            } catch (error: any) {
                devLog('canTransact:error', {
                    wallet: walletAddress,
                    vertical,
                    error: error.message,
                    code: error.code,
                    contractAddress: ACE_CONTRACT_ADDRESS,
                });
                console.error('[ACE] ⚠️ canTransact on-chain check FAILED — denying transaction:', error);
                return { allowed: false, reason: 'ACE compliance contract unavailable' };
            }
        }

        return { allowed: true };
    }

    // ============================================
    // Reputation
    // ============================================

    async getReputationScore(walletAddress: string): Promise<number | null> {
        if (this.contract) {
            try {
                const score = await this.contract.getReputationScore(walletAddress);
                return Number(score);
            } catch (error) {
                console.error('[ACE] ⚠️ Reputation fetch failed:', error);
            }
        }

        // Fallback to database — no hardcoded default
        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { walletAddress: walletAddress.toLowerCase() } },
        });

        return seller ? Number(seller.reputationScore) : null;
    }

    // ============================================
    // Blacklist Check
    // ============================================

    async isBlacklisted(walletAddress: string): Promise<boolean> {
        const check = await prisma.complianceCheck.findFirst({
            where: {
                entityType: 'user',
                entityId: walletAddress.toLowerCase(),
                checkType: 'FRAUD_CHECK',
                status: 'FAILED',
            },
        });

        return !!check;
    }

    // ============================================
    // Full Compliance Check
    // ============================================

    async checkFullCompliance(
        sellerAddress: string,
        buyerAddress: string,
        leadId: string
    ): Promise<{ passed: boolean; failedCheck?: string; reason?: string }> {
        // Check seller
        const sellerCheck = await this.canTransact(sellerAddress, '', '');
        if (!sellerCheck.allowed) {
            return { passed: false, failedCheck: 'SELLER_COMPLIANCE', reason: sellerCheck.reason };
        }

        // Check buyer
        const buyerCheck = await this.canTransact(buyerAddress, '', '');
        if (!buyerCheck.allowed) {
            return { passed: false, failedCheck: 'BUYER_COMPLIANCE', reason: buyerCheck.reason };
        }

        // Get lead details for specific checks
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (!lead) {
            return { passed: false, failedCheck: 'LEAD_NOT_FOUND', reason: 'Lead does not exist' };
        }

        // Check TCPA consent if required
        if (!lead.tcpaConsentAt) {
            return { passed: false, failedCheck: 'TCPA_CONSENT', reason: 'Missing TCPA consent' };
        }

        // Log compliance check
        await prisma.complianceCheck.create({
            data: {
                entityType: 'transaction',
                entityId: `${sellerAddress}-${buyerAddress}-${leadId}`,
                checkType: 'KYC',
                status: 'PASSED',
                checkedAt: new Date(),
                result: { seller: sellerAddress, buyer: buyerAddress, leadId },
            },
        });

        return { passed: true };
    }

    // ============================================
    // Jurisdiction Policy Enforcement
    // ============================================

    async enforceJurisdictionPolicy(
        walletAddress: string,
        vertical: string,
        geoState: string,
        country: string = 'US'
    ): Promise<{ allowed: boolean; reason?: string }> {
        const jurisdictionHash = ethers.keccak256(ethers.toUtf8Bytes(`${country}:${geoState}`));
        const verticalHash = ethers.keccak256(ethers.toUtf8Bytes(vertical));

        // Check on-chain if available
        if (this.contract) {
            try {
                const allowed = await this.contract.isJurisdictionAllowed(
                    jurisdictionHash, verticalHash
                );
                if (!allowed) {
                    return {
                        allowed: false,
                        reason: `Jurisdiction ${country}/${geoState} not allowed for ${vertical}`,
                    };
                }
                return { allowed: true };
            } catch (error) {
                console.error('ACE jurisdiction check failed:', error);
            }
        }

        // Check jurisdiction policy for restricted verticals
        const policy = getPolicy(country);
        if (policy?.restrictedVerticals.includes(vertical)) {
            return {
                allowed: false,
                reason: `Vertical "${vertical}" is restricted in ${country} under ${policy.framework}`,
            };
        }

        // Off-chain fallback: check database for known restrictions
        const restriction = await prisma.complianceCheck.findFirst({
            where: {
                entityType: 'jurisdiction',
                entityId: `${country}:${geoState}-${vertical}`,
                checkType: 'GEO_VALIDATION',
                status: 'FAILED',
            },
        });

        if (restriction) {
            return {
                allowed: false,
                reason: `Jurisdiction ${country}/${geoState} restricted for ${vertical}`,
            };
        }

        return { allowed: true };
    }

    // ============================================
    // Automated KYC Verification
    // ============================================

    async autoKYC(
        walletAddress: string,
        proofHash?: string
    ): Promise<{ verified: boolean; txHash?: string; error?: string; isOnChain?: boolean }> {
        const kycProofHash = proofHash || ethers.keccak256(
            ethers.toUtf8Bytes(`kyc-${walletAddress}-${Date.now()}`)
        );

        // On-chain KYC — Basescan: verifyKYC(address, bytes32, bytes)
        if (this.contract && this.signer) {
            try {
                devLog('verifyKYC:call', { wallet: walletAddress, proofHash: kycProofHash, contractAddress: ACE_CONTRACT_ADDRESS });
                const tx = await this.contract.verifyKYC(walletAddress, kycProofHash, '0x');
                const receipt = await tx.wait();
                devLog('verifyKYC:result', { wallet: walletAddress, txHash: receipt?.hash });

                // Cache in database
                await prisma.complianceCheck.create({
                    data: {
                        entityType: 'user',
                        entityId: walletAddress.toLowerCase(),
                        checkType: 'KYC',
                        status: 'PASSED',
                        checkedAt: new Date(),
                        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
                        result: { proofHash: kycProofHash, txHash: receipt?.hash },
                    },
                });

                // Ensure common vertical policies are set so canTransact returns true
                await this.ensureVerticalPolicies();

                return { verified: true, txHash: receipt?.hash };
            } catch (error: any) {
                devLog('verifyKYC:error', { wallet: walletAddress, error: error.message, code: error.code });
                console.error('ACE autoKYC on-chain failed:', error);
                return { verified: false, error: error.message };
            }
        }

        // Off-chain: mark as verified in database
        await prisma.complianceCheck.create({
            data: {
                entityType: 'user',
                entityId: walletAddress.toLowerCase(),
                checkType: 'KYC',
                status: 'PASSED',
                checkedAt: new Date(),
                expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            },
        });

        return { verified: true, isOnChain: false };
    }

    // ============================================
    // Cross-Border Compliance
    // ============================================

    async checkCrossBorderCompliance(
        sellerGeo: string,
        buyerGeo: string,
        vertical: string,
        sellerCountry: string = 'US',
        buyerCountry: string = 'US'
    ): Promise<{ allowed: boolean; reason?: string; requirements?: string[] }> {
        // Same jurisdiction: always allowed
        if (sellerCountry === buyerCountry && sellerGeo === buyerGeo) {
            return { allowed: true };
        }

        // ── Cross-country compliance (jurisdiction policies) ──
        if (sellerCountry !== buyerCountry) {
            const xbResult = crossBorderRequirements(sellerCountry, buyerCountry);
            if (xbResult.requirements.length > 0) {
                // Allow but flag requirements — don't block
                return {
                    allowed: true,
                    reason: xbResult.reason,
                    requirements: xbResult.requirements,
                };
            }
        }

        // ── US-specific cross-state rules ──
        if (sellerCountry === 'US' && buyerCountry === 'US') {
            const restrictedCrossState: Record<string, string[]> = {
                mortgage: ['NY', 'CA', 'FL'],
                insurance: ['NY'],
            };

            const restricted = restrictedCrossState[vertical];
            if (restricted) {
                if (restricted.includes(sellerGeo) || restricted.includes(buyerGeo)) {
                    return {
                        allowed: false,
                        reason: `Cross-state ${vertical} trade between ${sellerGeo} and ${buyerGeo} requires additional compliance`,
                    };
                }
            }
        }

        return { allowed: true };
    }

    // ============================================
    // Reputation Update
    // ============================================

    async updateReputation(
        walletAddress: string,
        delta: number
    ): Promise<{ success: boolean; newScore?: number; error?: string; isOnChain?: boolean }> {
        // On-chain update
        if (this.contract && this.signer) {
            try {
                const tx = await this.contract.updateReputationScore(walletAddress, delta);
                await tx.wait();

                const newScore = await this.getReputationScore(walletAddress);
                return { success: true, newScore: newScore ?? undefined };
            } catch (error: any) {
                console.error('ACE updateReputation on-chain failed:', error);
                return { success: false, error: error.message };
            }
        }

        // Off-chain: update in database
        const seller = await prisma.sellerProfile.findFirst({
            where: { user: { walletAddress: walletAddress.toLowerCase() } },
        });

        if (seller) {
            const newScore = Math.max(0, Math.min(10000, Number(seller.reputationScore) + delta));
            await prisma.sellerProfile.update({
                where: { id: seller.id },
                data: { reputationScore: newScore },
            });
            return { success: true, newScore, isOnChain: false };
        }

        return { success: false, error: 'Seller not found' };
    }

    // ============================================
    // Vertical Policy Setup
    // ============================================

    private policiesInitialized = false;

    /**
     * Ensure common vertical policies are set on-chain.
     * canTransact checks _defaultVerticalPolicy[verticalHash] — if not set,
     * it returns false even for KYC-approved users. This sets policies once.
     */
    async ensureVerticalPolicies(): Promise<void> {
        if (this.policiesInitialized || !this.contract || !this.signer) return;

        const verticals = [
            'mortgage', 'insurance', 'solar', 'legal', 'home-services',
            'roofing', 'hvac', 'plumbing', 'auto-insurance', 'health-insurance',
            'life-insurance', 'real-estate', 'personal-injury', 'tax',
            'debt-settlement', 'credit-repair', 'education', 'moving',
            'pest-control', 'windows', 'default',
        ];

        for (const v of verticals) {
            const hash = ethers.keccak256(ethers.toUtf8Bytes(v));
            try {
                devLog('setDefaultVerticalPolicy:call', { vertical: v, hash });
                const tx = await this.contract.setDefaultVerticalPolicy(hash, true);
                await tx.wait();
                devLog('setDefaultVerticalPolicy:result', { vertical: v, hash, set: true });
            } catch (error: any) {
                // Already set or gas issue — log but don't block
                devLog('setDefaultVerticalPolicy:skip', { vertical: v, error: error.message });
            }
        }

        this.policiesInitialized = true;
        devLog('verticalPolicies:initialized', { count: verticals.length });
    }
}

export const aceService = new ACEService();
