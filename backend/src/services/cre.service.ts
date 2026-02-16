import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { zkService } from './zk.service';
import { isValidRegion, getAllCountryCodes, isValidPostalCode, getStateForZip } from '../lib/geo-registry';

// ============================================
// CRE Verification Service
// ============================================

const CRE_CONTRACT_ADDRESS = process.env.CRE_CONTRACT_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

// CREVerifier Contract ABI (read + write)
const CRE_ABI = [
    // Read
    'function getLeadQualityScore(uint256 leadTokenId) view returns (uint16)',
    'function isVerificationValid(bytes32 requestId) view returns (bool)',
    'function getVerificationResult(bytes32 requestId) view returns (tuple(bytes32 requestId, uint8 verificationType, uint256 leadTokenId, address requester, uint40 requestedAt, uint40 fulfilledAt, uint8 status, bytes32 resultHash))',
    // Write
    'function requestParameterMatch(uint256 leadTokenId, tuple(bytes32 vertical, bytes32[] geoHashes, bytes32[] paramKeys, bytes32[] paramValues) buyerParams) returns (bytes32 requestId)',
    'function requestGeoValidation(uint256 leadTokenId, bytes32 expectedGeoHash, uint8 precision) returns (bytes32 requestId)',
    'function requestQualityScore(uint256 leadTokenId) returns (bytes32 requestId)',
    'function requestZKProofVerification(uint256 leadTokenId, bytes proof, bytes32[] publicInputs) returns (bytes32 requestId)',
];

interface VerificationResult {
    isValid: boolean;
    score?: number;
    reason?: string;
    requestId?: string;
}

class CREService {
    private provider: ethers.JsonRpcProvider;
    private contract: ethers.Contract | null = null;
    private signer: ethers.Wallet | null = null;

    constructor() {
        this.provider = new ethers.JsonRpcProvider(RPC_URL);

        if (CRE_CONTRACT_ADDRESS) {
            this.contract = new ethers.Contract(CRE_CONTRACT_ADDRESS, CRE_ABI, this.provider);

            if (DEPLOYER_KEY) {
                this.signer = new ethers.Wallet(DEPLOYER_KEY, this.provider);
                this.contract = this.contract.connect(this.signer) as ethers.Contract;
            }
        }
    }

    // ============================================
    // Lead Verification
    // ============================================

    async verifyLead(leadId: string): Promise<VerificationResult> {
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });

        if (!lead) {
            return { isValid: false, reason: 'Lead not found' };
        }

        if (lead.isVerified) {
            return { isValid: true };
        }

        const checks = await Promise.all([
            this.verifyDataIntegrity(lead),
            this.verifyTCPAConsent(lead),
            this.verifyGeo(lead),
        ]);

        const failed = checks.find(c => !c.isValid);
        if (failed) return failed;

        await prisma.lead.update({
            where: { id: leadId },
            data: { isVerified: true },
        });

        await prisma.complianceCheck.create({
            data: {
                entityType: 'lead',
                entityId: leadId,
                checkType: 'FRAUD_CHECK',
                status: 'PASSED',
                checkedAt: new Date(),
            },
        });

        return { isValid: true };
    }

    // ============================================
    // Data Integrity Check
    // ============================================

    private async verifyDataIntegrity(lead: any): Promise<VerificationResult> {
        if (lead.dataHash && lead.encryptedData) {
            // dataHash = keccak256(plaintext PII JSON)
            // encryptedData = JSON.stringify({ciphertext, iv, tag, commitment})
            // We can't re-derive plaintext from encrypted data, so verify the encrypted
            // payload is structurally valid (parseable with expected fields).
            try {
                const parsed = JSON.parse(lead.encryptedData);
                if (!parsed.ciphertext || !parsed.iv || !parsed.tag) {
                    await this.logCheck(lead.id, 'FRAUD_CHECK', 'FAILED', 'Encrypted data missing required fields');
                    return { isValid: false, reason: 'Data integrity verification failed — malformed encrypted payload' };
                }
            } catch {
                await this.logCheck(lead.id, 'FRAUD_CHECK', 'FAILED', 'Encrypted data is not valid JSON');
                return { isValid: false, reason: 'Data integrity verification failed — invalid encrypted data' };
            }
        }
        return { isValid: true };
    }
    // ============================================
    // TCPA Consent Verification
    // ============================================

    private async verifyTCPAConsent(lead: any): Promise<VerificationResult> {
        if (!lead.tcpaConsentAt) {
            await this.logCheck(lead.id, 'TCPA_CONSENT', 'FAILED', 'Missing TCPA consent');
            return { isValid: false, reason: 'TCPA consent required' };
        }

        const consentAge = Date.now() - new Date(lead.tcpaConsentAt).getTime();
        const maxAge = 30 * 24 * 60 * 60 * 1000;

        if (consentAge > maxAge) {
            await this.logCheck(lead.id, 'TCPA_CONSENT', 'FAILED', 'TCPA consent expired');
            return { isValid: false, reason: 'TCPA consent has expired' };
        }

        await this.logCheck(lead.id, 'TCPA_CONSENT', 'PASSED');
        return { isValid: true };
    }

    // ============================================
    // Geo Verification
    // ============================================

    private async verifyGeo(lead: any): Promise<VerificationResult> {
        const geo = lead.geo as any;

        if (!geo || (!geo.state && !geo.zip && !geo.geoHash && !geo.region)) {
            await this.logCheck(lead.id, 'GEO_VALIDATION', 'FAILED', 'Missing geo data');
            return { isValid: false, reason: 'Geographic information required' };
        }

        const country = (geo.country || 'US').toUpperCase();

        // Validate country is supported
        if (!getAllCountryCodes().includes(country)) {
            // Allow unknown countries — don't block, just log
            console.warn(`CRE: unknown country code "${country}" for lead ${lead.id}`);
            await this.logCheck(lead.id, 'GEO_VALIDATION', 'PASSED', `Unknown country ${country} — allowed`);
            return { isValid: true };
        }

        // Validate region/state if provided
        if (geo.state) {
            if (!isValidRegion(country, geo.state.toUpperCase())) {
                await this.logCheck(lead.id, 'GEO_VALIDATION', 'FAILED', `Invalid region ${geo.state} for country ${country}`);
                return { isValid: false, reason: `Invalid region "${geo.state}" for ${country}` };
            }
        }

        // Validate postal code format if provided (warn, don't block)
        if (geo.zip && !isValidPostalCode(country, geo.zip)) {
            console.warn(`CRE: invalid postal code "${geo.zip}" for ${country} — lead ${lead.id}`);
            await this.logCheck(lead.id, 'GEO_VALIDATION', 'PASSED', `Invalid postal format "${geo.zip}" for ${country} — allowed`);
        }

        // Cross-validate state ↔ zip for US leads
        if (country === 'US' && geo.state && geo.zip) {
            const expectedState = getStateForZip(geo.zip);
            if (expectedState && expectedState !== geo.state.toUpperCase()) {
                await this.logCheck(
                    lead.id, 'GEO_VALIDATION', 'FAILED',
                    `Zip ${geo.zip} belongs to ${expectedState}, not ${geo.state.toUpperCase()}`
                );
                return {
                    isValid: false,
                    reason: `Geographic mismatch: zip ${geo.zip} does not match state "${geo.state}" (expected ${expectedState})`,
                };
            }
        }

        await this.logCheck(lead.id, 'GEO_VALIDATION', 'PASSED');
        return { isValid: true };
    }

    // ============================================
    // Quality Score (on-chain only — no fallback)
    // ============================================

    /**
     * Get CRE quality score from on-chain CREVerifier ONLY.
     * Returns null if no tokenId, no contract, or on-chain call fails.
     * null = "Pending CRE" — never returns a fake 0.
     */
    async getQualityScore(leadId: string, tokenId?: number): Promise<number | null> {
        if (tokenId && this.contract) {
            try {
                const onChainScore = await this.contract.getLeadQualityScore(tokenId);
                if (Number(onChainScore) > 0) return Number(onChainScore);
            } catch (error) {
                console.error('CRE on-chain quality score failed:', error);
            }
        }

        return null; // No on-chain score available → "Pending CRE"
    }


    // ============================================
    // Parameter Matching
    // ============================================

    async matchLeadToAsk(leadId: string, askId: string): Promise<{ matches: boolean; score: number; details: string[] }> {
        const [lead, ask] = await Promise.all([
            prisma.lead.findUnique({ where: { id: leadId } }),
            prisma.ask.findUnique({ where: { id: askId } }),
        ]);

        if (!lead || !ask) {
            return { matches: false, score: 0, details: ['Lead or Ask not found'] };
        }

        const details: string[] = [];
        let score = 0;

        if (lead.vertical !== ask.vertical) {
            return { matches: false, score: 0, details: ['Vertical mismatch'] };
        }
        score += 3000;
        details.push('Vertical: match');

        const leadGeo = lead.geo as any;
        const askGeo = ask.geoTargets as any;

        // Country match
        if (askGeo?.country && leadGeo?.country) {
            if (askGeo.country !== leadGeo.country) {
                return { matches: false, score: 0, details: ['Country mismatch'] };
            }
            score += 500;
            details.push('Country: match');
        }

        // Region match (support both "regions" and legacy "states")
        const askRegions = askGeo?.regions || askGeo?.states;
        if (askRegions?.length > 0) {
            if (leadGeo?.state && askRegions.includes(leadGeo.state)) {
                score += 2000;
                details.push('Geo: region match');
            } else {
                return { matches: false, score: 0, details: ['Lead geo not in targeted regions'] };
            }
        } else {
            score += 1000;
            details.push('Geo: no restrictions');
        }

        if (lead.reservePrice && ask.reservePrice) {
            if (Number(ask.reservePrice) >= Number(lead.reservePrice)) {
                score += 1500;
                details.push('Price: meets reserve');
            }
        }

        const leadParams = lead.parameters as any;
        const askParams = ask.parameters as any;

        if (askParams && leadParams) {
            let paramMatches = 0;
            for (const [key, value] of Object.entries(askParams)) {
                if (leadParams[key] !== undefined) {
                    if (typeof value === 'number' && typeof leadParams[key] === 'number') {
                        if (leadParams[key] >= value) paramMatches++;
                    } else if (leadParams[key] === value) {
                        paramMatches++;
                    }
                }
            }
            score += paramMatches * 300;
            details.push(`Parameters: ${paramMatches} matches`);
        }

        return { matches: score >= 5000, score: Math.min(10000, score), details };
    }

    // ============================================
    // On-Chain: ZK Fraud Detection
    // ============================================

    async requestZKFraudDetection(leadId: string, tokenId: number): Promise<VerificationResult> {
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (!lead) return { isValid: false, reason: 'Lead not found' };

        const geo = lead.geo as any;
        const zkProof = zkService.generateFraudProof({
            vertical: lead.vertical,
            geoState: geo?.state || '',
            geoZip: geo?.zip,
            dataHash: lead.dataHash || ethers.ZeroHash,
            tcpaConsentAt: lead.tcpaConsentAt || undefined,
            source: lead.source,
        });

        const localCheck = zkService.verifyProofLocally(zkProof);
        if (!localCheck.valid) {
            await this.logCheck(leadId, 'FRAUD_CHECK', 'FAILED', `ZK proof invalid: ${localCheck.reason}`);
            return { isValid: false, reason: localCheck.reason };
        }

        if (this.contract && this.signer) {
            try {
                const tx = await this.contract.requestZKProofVerification(
                    tokenId, zkProof.proof, zkProof.publicInputs
                );
                const receipt = await tx.wait();
                const requestId = receipt?.logs?.[0]?.topics?.[1] || ethers.ZeroHash;

                await this.logCheck(leadId, 'FRAUD_CHECK', 'PASSED', `ZK proof submitted: ${requestId}`);
                return { isValid: true, requestId };
            } catch (error) {
                console.error('CRE ZK on-chain submission failed:', error);
            }
        }

        await this.logCheck(leadId, 'FRAUD_CHECK', 'PASSED', `ZK proof verified locally: ${zkProof.commitment}`);
        return { isValid: true, requestId: zkProof.commitment };
    }

    // ============================================
    // On-Chain: Parameter Match via Chainlink
    // ============================================

    async requestParameterMatchOnChain(
        tokenId: number,
        buyerParams: {
            vertical: string;
            geoStates: string[];
            paramKeys: string[];
            paramValues: string[];
        }
    ): Promise<VerificationResult> {
        if (!this.contract || !this.signer) {
            return { isValid: false, reason: 'CRE contract not configured' };
        }

        try {
            const verticalHash = ethers.keccak256(ethers.toUtf8Bytes(buyerParams.vertical));
            const geoHashes = buyerParams.geoStates.map(s =>
                ethers.keccak256(ethers.toUtf8Bytes(s))
            );
            const paramKeys = buyerParams.paramKeys.map(k =>
                ethers.keccak256(ethers.toUtf8Bytes(k))
            );
            const paramValues = buyerParams.paramValues.map(v =>
                ethers.keccak256(ethers.toUtf8Bytes(v))
            );

            const tx = await this.contract.requestParameterMatch(tokenId, {
                vertical: verticalHash,
                geoHashes,
                paramKeys,
                paramValues,
            });
            const receipt = await tx.wait();
            const requestId = receipt?.logs?.[0]?.topics?.[1] || ethers.ZeroHash;

            return { isValid: true, requestId };
        } catch (error: any) {
            console.error('CRE parameter match on-chain failed:', error);
            return { isValid: false, reason: error.message };
        }
    }

    // ============================================
    // On-Chain: Geo Validation
    // ============================================

    async requestGeoValidationOnChain(
        tokenId: number,
        geoState: string,
        precision: number = 4
    ): Promise<VerificationResult> {
        if (!this.contract || !this.signer) {
            return { isValid: false, reason: 'CRE contract not configured' };
        }

        try {
            const geoHash = ethers.keccak256(ethers.toUtf8Bytes(geoState));
            const tx = await this.contract.requestGeoValidation(tokenId, geoHash, precision);
            const receipt = await tx.wait();
            const requestId = receipt?.logs?.[0]?.topics?.[1] || ethers.ZeroHash;

            return { isValid: true, requestId };
        } catch (error: any) {
            console.error('CRE geo validation on-chain failed:', error);
            return { isValid: false, reason: error.message };
        }
    }

    // ============================================
    // Helper
    // ============================================

    private async logCheck(
        entityId: string,
        checkType: 'TCPA_CONSENT' | 'KYC' | 'AML' | 'GEO_VALIDATION' | 'FRAUD_CHECK' | 'PARAMETER_MATCH',
        status: 'PASSED' | 'FAILED' | 'PENDING' | 'MANUAL_REVIEW',
        message?: string
    ) {
        await prisma.complianceCheck.create({
            data: {
                entityType: 'lead',
                entityId,
                checkType,
                status,
                message,
                checkedAt: new Date(),
            },
        });
    }
}

export const creService = new CREService();
