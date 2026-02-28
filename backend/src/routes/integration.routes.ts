import { Router, Request, Response } from 'express';
import { creService } from '../services/cre.service';
import { aceService } from '../services/ace.service';
import { x402Service } from '../services/escrow.service';
import { privacyService } from '../services/privacy.service';
import { nftService } from '../services/nft.service';
import { zkService } from '../services/zk.service';
import { prisma } from '../lib/prisma';
import { calculateFees } from '../lib/fees';

const router = Router();

// ============================================
// End-to-End Demo Flow
// ============================================

/**
 * POST /api/v1/demo/e2e-bid
 * 
 * Full pipeline demo:
 * 1. Create lead → 2. CRE verify → 3. ZK fraud check → 4. Mint NFT
 * 5. ACE compliance → 6. Encrypted bid → 7. Auction resolve → 8. x402 settlement
 */
router.post('/e2e-bid', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const steps: Array<{ step: string; status: string; duration: number; data?: any }> = [];

    try {
        const {
            // Seller/lead data
            sellerId,
            vertical = 'solar',
            geoState = 'FL',
            geoZip = '33101',
            reservePrice = 25.00,
            parameters = { creditScore: 720, propertyType: 'single_family' },
            // Buyer data
            buyerAddress = '0x0000000000000000000000000000000000000001',
            bidAmount = 35.00,
        } = req.body;

        let stepStart = Date.now();

        // ── PII defense-in-depth: strip any PII from parameters ──
        const PII_KEYS = new Set([
            'firstName', 'lastName', 'name', 'fullName',
            'email', 'emailAddress', 'phone', 'phoneNumber', 'mobile',
            'address', 'streetAddress', 'street', 'apartment', 'unit',
            'ssn', 'socialSecurity', 'taxId',
            'dob', 'dateOfBirth', 'birthDate',
            'ip', 'ipAddress', 'userAgent',
        ]);
        const piiData: Record<string, any> = {};
        const safeParameters: Record<string, any> = {};
        for (const [key, value] of Object.entries(parameters as Record<string, any>)) {
            if (PII_KEYS.has(key)) piiData[key] = value;
            else safeParameters[key] = value;
        }
        let encryptedData: any = null;
        let dataHash = '';
        if (Object.keys(piiData).length > 0) {
            const piiResult = privacyService.encryptLeadPII(piiData);
            encryptedData = JSON.stringify(piiResult.encrypted);
            dataHash = piiResult.dataHash;
        }

        // ─── Step 1: Create Lead ───────────────────
        const lead = await prisma.lead.create({
            data: {
                sellerId: sellerId || (await getOrCreateDemoSeller()),
                vertical,
                geo: { state: geoState, zip: geoZip, city: 'Miami' },
                source: 'PLATFORM',
                parameters: safeParameters,
                encryptedData: encryptedData as any,
                dataHash,
                reservePrice,
                tcpaConsentAt: new Date(),
            },
        });
        steps.push({ step: '1. Create Lead', status: 'OK', duration: Date.now() - stepStart, data: { leadId: lead.id } });

        // ─── Step 2: CRE Pre-Auction Gate (Stage 1) ──────────────
        stepStart = Date.now();
        const verification = await creService.verifyLead(lead.id);
        steps.push({ step: '2. CRE Verify', status: verification.isValid ? 'PASSED' : 'FAILED', duration: Date.now() - stepStart, data: verification });

        if (!verification.isValid) {
            return res.status(400).json({ success: false, steps, error: verification.reason });
        }

        // CRE workflow: fire buyer-rules evaluation (fire-and-forget)
        creService.afterLeadCreated(lead.id);

        // ─── Step 3: ZK Fraud Detection ────────────
        stepStart = Date.now();
        const zkProof = zkService.generateFraudProof({
            vertical,
            geoState,
            geoZip,
            dataHash: lead.dataHash || '',
            tcpaConsentAt: lead.tcpaConsentAt || undefined,
            source: lead.source,
        });
        const zkVerify = zkService.verifyProofLocally(zkProof);
        steps.push({
            step: '3. ZK Fraud Check',
            status: zkVerify.valid ? 'PASSED' : 'FAILED',
            duration: Date.now() - stepStart,
            data: { commitment: zkProof.commitment, publicInputs: zkProof.publicInputs.length },
        });

        // ─── Step 4: Mint NFT ──────────────────────
        stepStart = Date.now();
        const mintResult = await nftService.mintLeadNFT(lead.id);
        steps.push({
            step: '4. Mint NFT',
            status: mintResult.success ? 'MINTED' : 'FAILED',
            duration: Date.now() - stepStart,
            data: { tokenId: mintResult.tokenId, txHash: mintResult.txHash },
        });

        // ─── Step 5: ACE Compliance ────────────────
        stepStart = Date.now();
        const jurisdictionCheck = await aceService.enforceJurisdictionPolicy(
            buyerAddress, vertical, geoState
        );
        const kycCheck = await aceService.isKYCValid(buyerAddress);
        steps.push({
            step: '5. ACE Compliance',
            status: jurisdictionCheck.allowed ? 'PASSED' : 'BLOCKED',
            duration: Date.now() - stepStart,
            data: { jurisdiction: jurisdictionCheck, kycValid: kycCheck },
        });

        // ─── Step 6: Encrypted Bid ─────────────────
        stepStart = Date.now();
        const bidCommitment = privacyService.encryptBid(bidAmount, buyerAddress);
        const bid = await prisma.bid.create({
            data: {
                leadId: lead.id,
                buyerId: (await getOrCreateDemoBuyer(buyerAddress)),
                amount: bidAmount,
                commitment: bidCommitment.commitment,
                status: 'PENDING',
            },
        });
        steps.push({
            step: '6. Encrypted Bid',
            status: 'COMMITTED',
            duration: Date.now() - stepStart,
            data: { bidId: bid.id, commitment: bidCommitment.commitment },
        });

        // ─── Step 7: Reveal & Auction Resolve ──────
        stepStart = Date.now();
        const revealResult = privacyService.decryptBid(
            bidCommitment.encryptedBid, buyerAddress
        );
        // Mark as winner (only bidder in demo)
        await prisma.bid.update({
            where: { id: bid.id },
            data: { status: 'ACCEPTED', revealedAt: new Date() },
        });
        await prisma.lead.update({
            where: { id: lead.id },
            data: {
                winningBid: bidAmount,
                status: 'SOLD',
                soldAt: new Date(),
            },
        });
        steps.push({
            step: '7. Auction Resolve',
            status: 'RESOLVED',
            duration: Date.now() - stepStart,
            data: { winner: buyerAddress, amount: revealResult.amount, bidValid: revealResult.valid },
        });

        // ─── Step 8: x402 Settlement ───────────────
        stepStart = Date.now();
        const e2eFees = calculateFees(bidAmount, 'AGENT');
        const transaction = await prisma.transaction.create({
            data: {
                leadId: lead.id,
                buyerId: (await getOrCreateDemoBuyer(buyerAddress)),
                amount: bidAmount,
                platformFee: e2eFees.platformFee,
                convenienceFee: e2eFees.convenienceFee || undefined,
                convenienceFeeType: e2eFees.convenienceFeeType,
                currency: 'USDC',
                status: 'PENDING',
            },
        });
        const paymentResult = await x402Service.createPayment(
            '0x0000000000000000000000000000000000000002', // demo seller address
            buyerAddress,
            bidAmount,
            transaction.leadId,
            transaction.id
        );

        let settlementResult: { success: boolean; txHash?: string } = { success: false };
        if (paymentResult.success) {
            const settleRes = await x402Service.settlePayment(transaction.id);
            settlementResult = { success: settleRes.success, txHash: settleRes.txHash };
        }

        // Update reputation after successful trade
        await aceService.updateReputation(buyerAddress, 100).catch(() => { });

        steps.push({
            step: '8. x402 Settlement',
            status: settlementResult.success ? 'SETTLED' : 'FAILED',
            duration: Date.now() - stepStart,
            data: {
                escrowId: paymentResult.escrowId,
                txHash: settlementResult.txHash,
                paymentHeaders: x402Service.generatePaymentHeader(
                    paymentResult.escrowId || '', bidAmount, buyerAddress
                ),
            },
        });

        // Record NFT sale
        if (mintResult.tokenId) {
            await nftService.recordSaleOnChain(
                mintResult.tokenId, buyerAddress, bidAmount
            ).catch(() => { });
        }

        res.json({
            success: true,
            totalDuration: Date.now() - startTime,
            steps,
            summary: {
                leadId: lead.id,
                tokenId: mintResult.tokenId,
                bidAmount,
                escrowId: paymentResult.escrowId,
                settled: settlementResult.success,
            },
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message,
            steps,
            totalDuration: Date.now() - startTime,
        });
    }
});

// ============================================
// Compliance Check Endpoint
// ============================================

router.post('/compliance-check', async (req: Request, res: Response) => {
    try {
        const { walletAddress, vertical, geoState } = req.body;

        if (!walletAddress) {
            return res.status(400).json({ error: 'walletAddress required' });
        }

        const [kycValid, reputation, jurisdiction, crossBorder] = await Promise.all([
            aceService.isKYCValid(walletAddress),
            aceService.getReputationScore(walletAddress),
            aceService.enforceJurisdictionPolicy(walletAddress, vertical || 'solar', geoState || 'FL'),
            aceService.checkCrossBorderCompliance(geoState || 'FL', geoState || 'FL', vertical || 'solar'),
        ]);

        res.json({
            walletAddress,
            kycValid,
            reputationScore: reputation,
            jurisdiction,
            crossBorder,
            canTransact: kycValid && jurisdiction.allowed,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ZK Verify Endpoint
// ============================================

router.post('/zk-verify', async (req: Request, res: Response) => {
    try {
        const {
            vertical = 'solar',
            geoState = 'FL',
            geoZip = '33101',
            // Optional: buyer criteria for match proof
            targetStates,
            minParameters,
        } = req.body;

        const fraudProof = zkService.generateFraudProof({
            vertical,
            geoState,
            geoZip,
            dataHash: '0x0',
            source: 'demo',
        });

        const fraudVerify = zkService.verifyProofLocally(fraudProof);

        let matchProof: any = null;
        if (targetStates) {
            matchProof = zkService.generateGeoParameterMatchProof(
                { vertical, geoState, geoZip, parameters: req.body.parameters || {} },
                { vertical, targetStates, minParameters }
            );
        }

        res.json({
            fraudDetection: {
                proof: fraudProof.proof,
                commitment: fraudProof.commitment,
                publicInputs: fraudProof.publicInputs,
                verified: fraudVerify.valid,
            },
            matchProof: matchProof ? {
                proof: matchProof.proof,
                commitment: matchProof.commitment,
                geoMatch: matchProof.geoMatch,
                parameterMatch: matchProof.parameterMatch,
            } : null,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Auto-KYC Endpoint
// ============================================

router.post('/auto-kyc', async (req: Request, res: Response) => {
    try {
        const { walletAddress } = req.body;

        if (!walletAddress) {
            return res.status(400).json({ error: 'walletAddress required' });
        }

        const result = await aceService.autoKYC(walletAddress);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Privacy — Encrypt/Decrypt Test
// ============================================

router.post('/privacy-test', async (req: Request, res: Response) => {
    try {
        const { amount = 25.00, buyerAddress = '0x424CaC929939377f221348af52d4cb1247fE4379' } = req.body;

        // Encrypt a bid
        const bidCommitment = privacyService.encryptBid(amount, buyerAddress);

        // Decrypt and verify
        const revealed = privacyService.decryptBid(bidCommitment.encryptedBid, buyerAddress);

        // PII encryption
        const piiResult = privacyService.encryptLeadPII({
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@example.com',
            phone: '555-0123',
        });

        res.json({
            bid: {
                commitment: bidCommitment.commitment,
                encrypted: { iv: bidCommitment.encryptedBid.iv, tagLength: bidCommitment.encryptedBid.tag.length },
                revealed: { amount: revealed.amount, valid: revealed.valid },
            },
            pii: {
                dataHash: piiResult.dataHash,
                encrypted: { iv: piiResult.encrypted.iv, commitment: piiResult.encrypted.commitment },
            },
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// NFT Metadata Endpoint
// ============================================

router.get('/nft/:tokenId', async (req: Request, res: Response) => {
    try {
        const metadata = await nftService.getTokenMetadata(req.params.tokenId);

        if (!metadata) {
            return res.status(404).json({ error: 'Token not found' });
        }

        res.json(metadata);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Helpers
// ============================================

async function getOrCreateDemoSeller(): Promise<string> {
    let user = await prisma.user.findFirst({ where: { walletAddress: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58' } });
    if (!user) {
        user = await prisma.user.create({
            data: {
                walletAddress: '0x88DDA5D4b22FA15EDAF94b7a97508ad7693BDc58',
                role: 'SELLER',
                nonce: Math.random().toString(36).slice(2),
            },
        });
    }

    let seller = await prisma.sellerProfile.findFirst({ where: { userId: user.id } });
    if (!seller) {
        seller = await prisma.sellerProfile.create({
            data: {
                userId: user.id,
                companyName: 'Demo Seller',
                verticals: ['solar'],
                isVerified: true,
            },
        });
    }

    return seller.id;
}

async function getOrCreateDemoBuyer(walletAddress: string): Promise<string> {
    let user = await prisma.user.findFirst({ where: { walletAddress } });
    if (!user) {
        user = await prisma.user.create({
            data: {
                walletAddress,
                role: 'BUYER',
                nonce: Math.random().toString(36).slice(2),
            },
        });
    }
    return user.id;
}

export default router;
