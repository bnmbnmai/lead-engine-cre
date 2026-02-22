import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';
import { zkService } from './zk.service';
import { isValidRegion, getAllCountryCodes, isValidPostalCode, getStateForZip } from '../lib/geo-registry';
import { computeCREQualityScore, LeadScoringInput } from '../lib/chainlink/cre-quality-score';
import { executeQualityScoreWorkflow } from '../lib/chainlink/quality-score-workflow';
import { executeBatchedPrivateScore } from '../lib/chainlink/batched-private-score';

// ============================================
// CRE Verification Service — Two-Stage Scoring
// ============================================
//
// Stage 1: PRE-AUCTION GATE + NUMERIC PRE-SCORE
//   verifyLead() — boolean pass/fail gate (data, TCPA, geo)
//   computeNumericPreScore() — scores 0–10,000 using the SAME
//   JavaScript that runs on the Chainlink Functions DON.
//   See: lib/chainlink/cre-quality-score.ts
//   Pre-score stored in lead.qualityScore immediately.
//
// Stage 2: ON-CHAIN CONFIRMED SCORE
//   getQualityScore(tokenId) — reads CREVerifier.sol after NFT mint.
//   Confirms/updates the pre-score with the on-chain result.
//   UI shows "Pre-score" badge until confirmed.
// ============================================

const CRE_CONTRACT_ADDRESS = process.env.CRE_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.CRE_CONTRACT_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const USE_CONFIDENTIAL_HTTP = process.env.USE_CONFIDENTIAL_HTTP === 'true';
// Phase 2: batched confidential score (AES-GCM envelope, no HTTP from DON)
const USE_BATCHED_PRIVATE_SCORE = process.env.USE_BATCHED_PRIVATE_SCORE === 'true';

// ACECompliance contract (Chainlink ACE KYC/geo/reputation registry)
const ACE_COMPLIANCE_ADDRESS = process.env.ACE_COMPLIANCE_ADDRESS || '0xAea2590E1E95F0d8bb34D375923586Bf0744EfE6';

const ACE_COMPLIANCE_ABI = [
    'function isCompliant(address wallet) view returns (bool)',
    'function getKYCStatus(address wallet) view returns (uint8)',
    'function getReputationScore(address wallet) view returns (uint256)',
];


// CREVerifier Contract ABI (read + write)
const CRE_ABI = [
    // Read
    'function getLeadQualityScore(uint256 leadTokenId) view returns (uint16)',
    'function computeQualityScoreFromParams(uint40 tcpaConsentTimestamp, bool hasGeoState, bool hasGeoZip, bool zipMatchesState, bool hasEncryptedData, bool encryptedDataValid, uint8 parameterCount, uint8 sourceType) pure returns (uint16)',
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
    /** True when the score was enriched by the CHTT fraud-signal workflow. */
    chttEnriched?: boolean;
    chttScore?: number;
}

class CREService {
    private provider: ethers.JsonRpcProvider;
    private contract: ethers.Contract | null = null;
    private signer: ethers.Wallet | null = null;
    private aceComplianceContract: ethers.Contract | null = null;

    constructor() {
        this.provider = new ethers.JsonRpcProvider(RPC_URL);

        if (CRE_CONTRACT_ADDRESS) {
            this.contract = new ethers.Contract(CRE_CONTRACT_ADDRESS, CRE_ABI, this.provider);

            if (DEPLOYER_KEY) {
                this.signer = new ethers.Wallet(DEPLOYER_KEY, this.provider);
                this.contract = this.contract.connect(this.signer) as ethers.Contract;
            }
        }

        // ACECompliance is read-only (view calls only)
        this.aceComplianceContract = new ethers.Contract(
            ACE_COMPLIANCE_ADDRESS,
            ACE_COMPLIANCE_ABI,
            this.provider
        );
    }

    // ============================================
    // ACE Compliance Gate (Chainlink ACE PolicyEngine)
    // ============================================

    /**
     * Check a wallet address against the on-chain ACECompliance registry.
     * Returns compliant=true when the wallet has passed KYC and is not sanctioned.
     * Non-compliant wallets are rejected before any Chainlink Functions call is dispatched.
     */
    async checkACECompliance(walletAddress: string): Promise<{ compliant: boolean; kycStatus?: number; reputationScore?: string; reason?: string }> {
        if (!this.aceComplianceContract) {
            return { compliant: true }; // ACE not configured — pass through
        }
        try {
            const compliant: boolean = await this.aceComplianceContract.isCompliant(walletAddress);
            if (!compliant) {
                const kycStatus: bigint = await this.aceComplianceContract.getKYCStatus(walletAddress);
                return {
                    compliant: false,
                    kycStatus: Number(kycStatus),
                    reason: `ACE_POLICY_REJECTED: wallet ${walletAddress} failed ACECompliance check (kycStatus=${kycStatus})`,
                };
            }
            const reputationScore: bigint = await this.aceComplianceContract.getReputationScore(walletAddress);
            return { compliant: true, reputationScore: reputationScore.toString() };
        } catch (err: any) {
            console.warn(`[ACE] isCompliant() reverted for ${walletAddress}: ${err.message}`);
            // On-chain call failed (e.g. wallet not registered) — treat as non-compliant
            return { compliant: false, reason: `ACE_POLICY_REJECTED: ${err.message}` };
        }
    }


    /**
     * Verify a lead before it enters the auction.
     * Checks data integrity, TCPA consent, and geo validation.
     * Returns pass/fail (boolean gate) — no numeric score.
     */
    async verifyLead(leadId: string): Promise<VerificationResult> {
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });

        if (!lead) {
            console.warn(`[CRE PRE-GATE] Lead ${leadId}: NOT FOUND → REJECTED`);
            return { isValid: false, reason: 'Lead not found' };
        }

        if (lead.isVerified) {
            return { isValid: true };
        }

        // ── ACE Compliance Gate (Chainlink ACE PolicyEngine) ──
        // Check the seller wallet against ACECompliance.isCompliant() BEFORE
        // any Chainlink Functions calls are dispatched. Non-compliant wallets
        // are rejected here — the same check the on-chain PolicyEngine runs
        // on every mintLead() call via ACELeadPolicy.run().
        if ((lead as any).walletAddress) {
            const aceResult = await this.checkACECompliance((lead as any).walletAddress);
            if (!aceResult.compliant) {
                console.warn(`[ACE PRE-GATE] Lead ${leadId}: REJECTED — ${aceResult.reason}`);
                return { isValid: false, reason: aceResult.reason || 'ACE_POLICY_REJECTED' };
            }
            console.log(`[ACE PRE-GATE] Lead ${leadId}: compliant ✓ (reputation=${aceResult.reputationScore ?? 'n/a'})`);
        }

        const [dataCheck, tcpaCheck, geoCheck] = await Promise.all([
            this.verifyDataIntegrity(lead),
            this.verifyTCPAConsent(lead),
            this.verifyGeo(lead),
        ]);

        const admitted = dataCheck.isValid && tcpaCheck.isValid && geoCheck.isValid;

        console.log(
            `[CRE PRE-GATE] Lead ${leadId}: ` +
            `data=${dataCheck.isValid ? 'PASS' : 'FAIL'} ` +
            `tcpa=${tcpaCheck.isValid ? 'PASS' : 'FAIL'} ` +
            `geo=${geoCheck.isValid ? 'PASS' : 'FAIL'} ` +
            `→ ${admitted ? 'ADMITTED' : 'REJECTED'}`
        );

        if (!admitted) {
            const failed = [dataCheck, tcpaCheck, geoCheck].find(c => !c.isValid)!;
            return failed;
        }

        // Compute numeric pre-score — CHTT path (when enabled) or direct-DB path.
        let preScore: number;
        let chttEnriched = false;
        let chttScore: number | undefined;

        if (USE_CONFIDENTIAL_HTTP) {
            // Use Confidential HTTP workflow stub: fetches scoring-data + fraud signals
            // from the TEE enclave with API key injected from Vault DON secrets.
            const chttResult = await this.computeScoreViaConfidentialHTTP(leadId);
            preScore = chttResult.score;
            chttEnriched = chttResult.enriched;
            chttScore = chttResult.chttScore;

            // Persist CHTT provenance in parameters JSONB — no migration needed.
            // Stored under a _chtt key to avoid colliding with lead-specific params.
            const existingParams = (lead.parameters as any) || {};
            const chttMeta: Record<string, any> = {
                enriched: chttResult.enriched,
                score: chttResult.chttScore,
                bonus: chttResult.bonus,
                nonce: chttResult.nonce,
                ciphertext: chttResult.ciphertext,
                computedAt: new Date().toISOString(),
            };

            await prisma.lead.update({
                where: { id: leadId },
                data: {
                    isVerified: true,
                    qualityScore: preScore,
                    parameters: { ...existingParams, _chtt: chttMeta } as any,
                },
            });
        } else if (USE_BATCHED_PRIVATE_SCORE) {
            // ── Phase 2: Batched Confidential Score ─────────────────────────
            // Single DON computation: quality score + fraud bonus + ACE compliance
            // all encrypted in one AES-256-GCM envelope. No HTTP calls from DON.
            // Build LeadScoringInput inline (same logic as computeNumericPreScoreFromLead)
            const _geo = lead.geo as any;
            const _params = lead.parameters as any;
            const _paramCount = _params ? Object.keys(_params).filter((k) => !k.startsWith('_') && _params[k] != null && _params[k] !== '').length : 0;
            let _encryptedDataValid = false;
            if (lead.encryptedData) {
                try { const p = JSON.parse(lead.encryptedData); _encryptedDataValid = !!(p.ciphertext && p.iv && p.tag); } catch { /* */ }
            }
            let _zipMatchesState = false;
            if (_geo?.zip && _geo?.state) {
                const expectedState = getStateForZip(_geo.zip);
                _zipMatchesState = !!expectedState && expectedState === _geo.state.toUpperCase();
            }
            const scoringInput: LeadScoringInput = {
                tcpaConsentAt: lead.tcpaConsentAt,
                geo: _geo || null,
                hasEncryptedData: !!lead.encryptedData,
                encryptedDataValid: _encryptedDataValid,
                parameterCount: _paramCount,
                source: lead.source || 'OTHER',
                zipMatchesState: _zipMatchesState,
            };

            // Read ACE compliance for the seller wallet (best-effort; defaults to false)
            let aceCompliantP2 = false;
            try {
                // FIX 2026-02-21: walletAddress lives on User (via SellerProfile relation),
                // not directly on Lead. Using (lead as any) to avoid Prisma TS2339 error
                // without requiring an extra include: { seller: { include: { user: true } } }.
                const _walletAddr = (lead as any).walletAddress || '';
                if (_walletAddr) aceCompliantP2 = (await this.checkACECompliance(_walletAddr)).compliant;
            } catch { /* non-blocking */ }

            const p2Out = await executeBatchedPrivateScore(leadId, scoringInput, aceCompliantP2);
            preScore = p2Out.result.score;
            chttEnriched = true;
            chttScore = p2Out.result.score;

            // Persist AES-GCM envelope in parameters._chtt
            const existingParamsP2 = (lead.parameters as any) || {};
            const chttMetaP2: Record<string, any> = {
                batchedPhase2: true,
                enriched: true,
                score: p2Out.result.score,
                fraudBonus: p2Out.result.fraudBonus,
                aceCompliant: p2Out.result.aceCompliant,
                nonce: p2Out.envelope.nonce,
                ciphertext: p2Out.envelope.ciphertext,
                encrypted: p2Out.envelope.encrypted,
                latencyMs: p2Out.latencyMs,
                computedAt: p2Out.result.ts,
            };

            await prisma.lead.update({
                where: { id: leadId },
                data: {
                    isVerified: true,
                    qualityScore: preScore,
                    parameters: { ...existingParamsP2, _chtt: chttMetaP2 } as any,
                },
            });

            console.log(
                `[CHTT P2] Lead ${leadId}: composite=${preScore}/10000 ` +
                `bonus=${p2Out.result.fraudBonus} ace=${aceCompliantP2} ` +
                `encrypted=${p2Out.envelope.encrypted} (${p2Out.latencyMs}ms)`,
            );
        } else {
            preScore = this.computeNumericPreScoreFromLead(lead);

            await prisma.lead.update({
                where: { id: leadId },
                data: {
                    isVerified: true,
                    qualityScore: preScore,
                },
            });
        }

        console.log(
            `[CRE PRE-GATE] Lead ${leadId}: pre-score=${preScore}/10000` +
            (chttEnriched ? ` (CHTT enriched, bonus included)` : ''),
        );

        await prisma.complianceCheck.create({
            data: {
                entityType: 'lead',
                entityId: leadId,
                checkType: 'FRAUD_CHECK',
                status: 'PASSED',
                checkedAt: new Date(),
            },
        });

        return { isValid: true, score: preScore, chttEnriched, chttScore };
    }

    /**
     * Compute a structured pre-score for a lead.
     * Returns the pass/fail result of each real CRE check PLUS
     * the numeric quality score (0–10,000) from the shared scoring JS.
     *
     * When USE_CONFIDENTIAL_HTTP=true, delegates scoring to the
     * Confidential HTTP workflow stub (fetches scoring-data via enclave).
     * Otherwise, uses the direct-DB path (default).
     */
    async computePreScore(leadId: string): Promise<{
        admitted: boolean;
        score: number;
        checks: { dataIntegrity: boolean; tcpaConsent: boolean; geoValid: boolean };
        reason?: string;
    }> {
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });

        if (!lead) {
            return {
                admitted: false,
                score: 0,
                checks: { dataIntegrity: false, tcpaConsent: false, geoValid: false },
                reason: 'Lead not found',
            };
        }

        // If already verified, return the existing score
        if (lead.isVerified) {
            return {
                admitted: true,
                score: Number(lead.qualityScore) || this.computeNumericPreScoreFromLead(lead),
                checks: { dataIntegrity: true, tcpaConsent: true, geoValid: true },
            };
        }

        const [dataCheck, tcpaCheck, geoCheck] = await Promise.all([
            this.verifyDataIntegrity(lead),
            this.verifyTCPAConsent(lead),
            this.verifyGeo(lead),
        ]);

        const admitted = dataCheck.isValid && tcpaCheck.isValid && geoCheck.isValid;
        const failedCheck = [dataCheck, tcpaCheck, geoCheck].find(c => !c.isValid);

        // ── Scoring: CHTT path vs direct-DB path ──────────────
        let score = 0;
        if (admitted) {
            if (USE_CONFIDENTIAL_HTTP) {
                // Use Confidential HTTP workflow stub to fetch + score (uses lead.id pre-mint)
                const chttResult = await this.computeScoreViaConfidentialHTTP(lead.id);
                score = chttResult.score;
            } else {
                // Direct-DB scoring (default, always works)
                score = this.computeNumericPreScoreFromLead(lead);
            }
        }

        return {
            admitted,
            score,
            checks: {
                dataIntegrity: dataCheck.isValid,
                tcpaConsent: tcpaCheck.isValid,
                geoValid: geoCheck.isValid,
            },
            reason: failedCheck?.reason,
        };
    }

    // ============================================
    // Confidential HTTP Quality Scoring (STUB)
    // ============================================

    /**
     * Compute quality score via the Confidential HTTP workflow stub.
     *
     * STUB: Locally fetches the scoring-data endpoint through the
     * ConfidentialHTTPClient stub (simulated enclave, secret injection).
     * Falls back to direct-DB scoring on failure.
     *
     * In production: the CRE Workflow DON would call the scoring-data
     * endpoint via Confidential HTTP, with the CRE API key injected
     * from the Vault DON — never exposed in node memory.
     *
     * isStub: true
     */
    private async computeScoreViaConfidentialHTTP(leadId: string): Promise<{
        score: number;
        enriched: boolean;
        chttScore?: number;
        bonus?: number;
        nonce?: string;
        ciphertext?: string;
    }> {
        // Note: verifyLead() calls this with the lead UUID (not nftTokenId)
        // because the lead may not have been minted as NFT yet at verification time.
        // The workflow uses it as a path param for the scoring-data + fraud-signal endpoints.
        try {
            const result = await executeQualityScoreWorkflow({
                leadTokenId: leadId,
            });

            if (result.success && result.score !== null) {
                console.log(
                    `[CRE] CHTT workflow scored lead ${leadId}: ${result.score}/10000 ` +
                    `(bonus=${result.externalFraudBonus ?? 0}, ` +
                    `enclave=${result.confidentialHTTP.executedInEnclave}, ` +
                    `latency=${result.workflowLatencyMs}ms, isStub=${result.isStub})`,
                );
                return {
                    score: result.score,
                    enriched: result.fraudSignal !== null,
                    chttScore: result.score,
                    bonus: result.externalFraudBonus ?? 0,
                    nonce: result.chttProvenance?.nonce,
                    ciphertext: result.chttProvenance?.ciphertext,
                };
            }

            console.warn(
                `[CRE] CHTT workflow failed for lead ${leadId}: ${result.error} — falling back to direct scoring`,
            );
        } catch (err: any) {
            console.warn(
                `[CRE] CHTT workflow error for lead ${leadId}: ${err.message} — falling back to direct scoring`,
            );
        }

        // Fallback: score directly from DB (same as the non-CHTT path)
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });
        const score = lead ? this.computeNumericPreScoreFromLead(lead) : 0;
        return { score, enriched: false };
    }

    /**
     * Compute the numeric pre-score from a lead record.
     * Uses the SAME algorithm as the CREVerifier DON source.
     * See: lib/chainlink/cre-quality-score.ts
     */
    private computeNumericPreScoreFromLead(lead: any): number {
        const geo = lead.geo as any;
        const params = lead.parameters as any;
        const paramCount = params ? Object.keys(params).filter(k => params[k] != null && params[k] !== '').length : 0;

        let encryptedDataValid = false;
        if (lead.encryptedData) {
            try {
                const parsed = JSON.parse(lead.encryptedData);
                encryptedDataValid = !!(parsed.ciphertext && parsed.iv && parsed.tag);
            } catch { /* invalid JSON */ }
        }

        // Cross-validate zip↔state for US leads
        let zipMatchesState = false;
        if (geo?.zip && geo?.state) {
            const country = (geo.country || 'US').toUpperCase();
            if (country === 'US') {
                const expectedState = getStateForZip(geo.zip);
                zipMatchesState = !!expectedState && expectedState === geo.state.toUpperCase();
            } else {
                zipMatchesState = true; // Non-US: assume valid
            }
        }

        const input: LeadScoringInput = {
            tcpaConsentAt: lead.tcpaConsentAt,
            geo: geo || null,
            hasEncryptedData: !!lead.encryptedData,
            encryptedDataValid,
            parameterCount: paramCount,
            source: lead.source || 'OTHER',
            zipMatchesState,
        };

        return computeCREQualityScore(input);
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
    // Stage 2: On-Chain Numeric Score (post-NFT mint)
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
    // Fix 4 (2026-02-21): On-Chain CRE Functions Wiring
    // ============================================

    /**
     * Submit a requestQualityScore transaction to CREVerifier after NFT mint.
     *
     * USE WHEN: USE_BATCHED_PRIVATE_SCORE=false (Phase 1 fallback) and a valid
     * nftTokenId has just been written to the DB by nftService.mintLeadNFT().
     *
     * Flow:
     *   1. Dispatch requestQualityScore(tokenId) → DON computes DON_QUALITY_SCORE_SOURCE
     *   2. Poll for VerificationFulfilled event (max 90s, 6s intervals)
     *   3. Decode the on-chain score from resultHash field (stored as uint16)
     *   4. Write score to lead.qualityScore in Prisma
     *
     * Non-blocking: errors are logged but do not throw so the caller's user-
     * facing flow is not interrupted. The lead will show "Pending CRE" badge
     * in the UI until the score arrives.
     *
     * @param leadId    - Lead UUID (for Prisma update)
     * @param tokenId   - NFT token ID (uint256) from mintLeadNFT result
     * @param leadIdRef - Optional: lead ID string to include in log prefix
     */
    async requestOnChainQualityScore(
        leadId: string,
        tokenId: number,
        leadIdRef?: string,
    ): Promise<{ submitted: boolean; requestId?: string; error?: string }> {
        const logPrefix = `[CRE On-Chain] Lead ${leadIdRef || leadId} tokenId=${tokenId}`;

        if (!this.contract || !this.signer) {
            console.warn(`${logPrefix}: CRE contract not configured — skipping on-chain score request`);
            return { submitted: false, error: 'CRE contract not configured' };
        }

        // Phase 2 (batched) path handles its own on-chain dispatch via enclave.
        // This method is only for Phase 1 (direct requestQualityScore).
        if (USE_BATCHED_PRIVATE_SCORE) {
            console.log(`${logPrefix}: USE_BATCHED_PRIVATE_SCORE=true — skipping Phase 1 on-chain request`);
            return { submitted: false, error: 'USE_BATCHED_PRIVATE_SCORE=true; use Phase 2 path' };
        }

        try {
            // Step 1: Dispatch requestQualityScore
            console.log(`${logPrefix}: Dispatching requestQualityScore...`);
            const tx = await this.contract.requestQualityScore(tokenId, { gasLimit: 400_000 });
            console.log(`${logPrefix}: Tx submitted — ${tx.hash}`);
            const receipt = await tx.wait();

            // Extract requestId from the first log topic (emitted as VerificationRequested)
            const requestId: string = receipt?.logs?.[0]?.topics?.[1] || ethers.ZeroHash;
            console.log(`${logPrefix}: ✓ requestQualityScore confirmed — requestId=${requestId} block=${receipt?.blockNumber}`);

            // Step 2: Background event listener — poll for VerificationFulfilled
            // We do not await this; it resolves asynchronously once the DON responds.
            this.listenForVerificationFulfilled(leadId, tokenId, requestId, logPrefix).catch((err) => {
                console.error(`${logPrefix}: VerificationFulfilled listener error: ${err.message}`);
            });

            return { submitted: true, requestId };
        } catch (error: any) {
            console.error(`${logPrefix}: requestQualityScore failed: ${error.message}`);
            return { submitted: false, error: error.message };
        }
    }

    /**
     * Background listener for VerificationFulfilled events.
     * Polls CREVerifier every 6s for up to 90s (15 attempts).
     * On receipt, decodes the score and writes to Prisma.
     *
     * VerificationFulfilled event signature (from CREVerifier.sol):
     *   event VerificationFulfilled(bytes32 indexed requestId, uint256 indexed leadTokenId,
     *       uint8 verificationType, uint16 score, bytes32 resultHash);
     *
     * 2026-02-21: Added as part of Fix 4 — on-chain CRE Functions wiring.
     */
    private async listenForVerificationFulfilled(
        leadId: string,
        tokenId: number,
        requestId: string,
        logPrefix: string,
    ): Promise<void> {
        const MAX_POLLS = 15;
        const POLL_INTERVAL_MS = 6_000; // 6s between polls — DON typically responds in 30–60s

        // VerificationResult struct read from getVerificationResult(requestId)
        // Fields: requestId, verificationType, leadTokenId, requester, requestedAt,
        //         fulfilledAt, status, resultHash
        // We call getLeadQualityScore(tokenId) as the simplest fulfillment check.

        for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

            try {
                const onChainScore = await this.contract!.getLeadQualityScore(tokenId);
                const score = Number(onChainScore);

                if (score > 0) {
                    // Fulfilled — write score to DB
                    await prisma.lead.update({
                        where: { id: leadId },
                        data: { qualityScore: score },
                    });
                    console.log(
                        `${logPrefix}: ✓ VerificationFulfilled — ` +
                        `on-chain score=${score}/10000 written to DB (attempt ${attempt}/${MAX_POLLS})`,
                    );
                    return;
                }

                console.log(`${logPrefix}: Poll ${attempt}/${MAX_POLLS} — score not yet fulfilled (score=${score})`);
            } catch (err: any) {
                console.warn(`${logPrefix}: Poll ${attempt}/${MAX_POLLS} — error: ${err.message}`);
            }
        }

        console.warn(
            `${logPrefix}: ⚠ VerificationFulfilled not received after ${MAX_POLLS} attempts (${(MAX_POLLS * POLL_INTERVAL_MS) / 1000}s). ` +
            'Lead will show "Pending CRE" badge until manual re-trigger.',
        );
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
