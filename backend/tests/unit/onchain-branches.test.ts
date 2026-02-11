/**
 * On-Chain Branch Coverage Tests
 * 
 * These tests inject mock contracts/signers into service singletons
 * to exercise the on-chain code paths (lines behind `if (this.contract && this.signer)`).
 * This boosts coverage for ace, cre, nft, and x402 services.
 */

// ─── Mock Prisma ─────────────────────────────
jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        lead: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
        ask: { findUnique: jest.fn() },
        complianceCheck: { findFirst: jest.fn(), create: jest.fn() },
        sellerProfile: { findFirst: jest.fn(), update: jest.fn() },
        user: { findUnique: jest.fn() },
        transaction: { findUnique: jest.fn(), update: jest.fn() },
    },
}));

import { prisma } from '../../src/lib/prisma';

// Mock contract & signer
function mockContract(methods: Record<string, jest.Mock>) {
    return methods;
}

function mockSigner() {
    return { address: '0xTestSigner' };
}

afterEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════
// ACE Service — On-Chain Branches
// ═══════════════════════════════════════════════

describe('ACE On-Chain Branches', () => {
    let aceService: any;

    beforeAll(async () => {
        const mod = await import('../../src/services/ace.service');
        aceService = mod.aceService;
    });

    afterEach(() => {
        // Reset contract/signer
        aceService['contract'] = null;
        aceService['signer'] = null;
    });

    it('isKYCValid: should call contract.isKYCValid on-chain', async () => {
        const mockCtx = mockContract({
            isKYCValid: jest.fn().mockResolvedValue(true),
        });
        aceService['contract'] = mockCtx;

        // No cached KYC
        (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({});

        const result = await aceService.isKYCValid('0xOnChainUser');
        expect(result).toBe(true);
        expect(mockCtx.isKYCValid).toHaveBeenCalledWith('0xOnChainUser');
    });

    it('isKYCValid: should catch on-chain error and fallback to DB', async () => {
        const mockCtx = mockContract({
            isKYCValid: jest.fn().mockRejectedValue(new Error('rpc fail')),
        });
        aceService['contract'] = mockCtx;

        (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await aceService.isKYCValid('0xRpcFail');
        expect(result).toBe(false);
        consoleSpy.mockRestore();
    });

    it('canTransact: should call contract.canTransact on-chain', async () => {
        const mockCtx = mockContract({
            canTransact: jest.fn().mockResolvedValue(true),
        });
        aceService['contract'] = mockCtx;

        // Not blacklisted, KYC valid via cache
        (prisma.complianceCheck.findFirst as jest.Mock)
            .mockResolvedValueOnce(null)  // blacklist
            .mockResolvedValueOnce({ id: 'kyc', status: 'PASSED', expiresAt: new Date(Date.now() + 86400000) });

        const result = await aceService.canTransact('0xOnChain', 'solar', 'FL');
        expect(result.allowed).toBe(true);
        expect(mockCtx.canTransact).toHaveBeenCalled();
    });

    it('canTransact: on-chain returns false', async () => {
        const mockCtx = mockContract({
            canTransact: jest.fn().mockResolvedValue(false),
        });
        aceService['contract'] = mockCtx;

        (prisma.complianceCheck.findFirst as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'kyc', status: 'PASSED', expiresAt: new Date(Date.now() + 86400000) });

        const result = await aceService.canTransact('0xBlocked', 'solar', 'FL');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('on-chain');
    });

    it('canTransact: on-chain error falls back gracefully', async () => {
        const mockCtx = mockContract({
            canTransact: jest.fn().mockRejectedValue(new Error('rpc timeout')),
        });
        aceService['contract'] = mockCtx;

        (prisma.complianceCheck.findFirst as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'kyc', status: 'PASSED', expiresAt: new Date(Date.now() + 86400000) });

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await aceService.canTransact('0xTimeout', 'solar', 'FL');
        expect(result.allowed).toBe(true); // Falls back to off-chain pass
        consoleSpy.mockRestore();
    });

    it('getReputationScore: should call contract on-chain', async () => {
        const mockCtx = mockContract({
            getReputationScore: jest.fn().mockResolvedValue(8200n),
        });
        aceService['contract'] = mockCtx;

        const score = await aceService.getReputationScore('0xRep');
        expect(score).toBe(8200);
    });

    it('getReputationScore: on-chain error falls back to DB', async () => {
        const mockCtx = mockContract({
            getReputationScore: jest.fn().mockRejectedValue(new Error('fail')),
        });
        aceService['contract'] = mockCtx;

        (prisma.sellerProfile.findFirst as jest.Mock).mockResolvedValue({ reputationScore: 6000 });
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        const score = await aceService.getReputationScore('0xFallback');
        expect(score).toBe(6000);
        consoleSpy.mockRestore();
    });

    it('enforceJurisdictionPolicy: on-chain allowed', async () => {
        const mockCtx = mockContract({
            isJurisdictionAllowed: jest.fn().mockResolvedValue(true),
        });
        aceService['contract'] = mockCtx;

        const result = await aceService.enforceJurisdictionPolicy('0xAddr', 'solar', 'FL', 'US');
        expect(result.allowed).toBe(true);
    });

    it('enforceJurisdictionPolicy: on-chain blocked', async () => {
        const mockCtx = mockContract({
            isJurisdictionAllowed: jest.fn().mockResolvedValue(false),
        });
        aceService['contract'] = mockCtx;

        const result = await aceService.enforceJurisdictionPolicy('0xAddr', 'solar', 'FL', 'US');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('not allowed');
    });

    it('enforceJurisdictionPolicy: on-chain error falls back', async () => {
        const mockCtx = mockContract({
            isJurisdictionAllowed: jest.fn().mockRejectedValue(new Error('fail')),
        });
        aceService['contract'] = mockCtx;

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        (prisma.complianceCheck.findFirst as jest.Mock).mockResolvedValue(null);
        const result = await aceService.enforceJurisdictionPolicy('0xAddr', 'solar', 'FL', 'US');
        expect(result.allowed).toBe(true);
        consoleSpy.mockRestore();
    });

    it('autoKYC: on-chain success', async () => {
        const mockCtx = mockContract({
            verifyKYC: jest.fn().mockResolvedValue({ wait: jest.fn().mockResolvedValue({ hash: '0xtxhash' }) }),
        });
        aceService['contract'] = mockCtx;
        aceService['signer'] = mockSigner();
        (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({});

        const result = await aceService.autoKYC('0xAddr');
        expect(result.verified).toBe(true);
        expect(result.txHash).toBe('0xtxhash');
    });

    it('autoKYC: on-chain failure', async () => {
        const mockCtx = mockContract({
            verifyKYC: jest.fn().mockRejectedValue(new Error('tx reverted')),
        });
        aceService['contract'] = mockCtx;
        aceService['signer'] = mockSigner();

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await aceService.autoKYC('0xAddr');
        expect(result.verified).toBe(false);
        expect(result.error).toContain('tx reverted');
        consoleSpy.mockRestore();
    });

    it('updateReputation: on-chain success', async () => {
        const mockCtx = mockContract({
            updateReputationScore: jest.fn().mockResolvedValue({ wait: jest.fn().mockResolvedValue({}) }),
            getReputationScore: jest.fn().mockResolvedValue(9000n),
        });
        aceService['contract'] = mockCtx;
        aceService['signer'] = mockSigner();

        const result = await aceService.updateReputation('0xAddr', 500);
        expect(result.success).toBe(true);
        expect(result.newScore).toBe(9000);
    });

    it('updateReputation: on-chain failure', async () => {
        const mockCtx = mockContract({
            updateReputationScore: jest.fn().mockRejectedValue(new Error('gas')),
        });
        aceService['contract'] = mockCtx;
        aceService['signer'] = mockSigner();

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await aceService.updateReputation('0xAddr', 500);
        expect(result.success).toBe(false);
        consoleSpy.mockRestore();
    });
});

// ═══════════════════════════════════════════════
// CRE Service — On-Chain Branches
// ═══════════════════════════════════════════════

describe('CRE On-Chain Branches', () => {
    let creService: any;

    beforeAll(async () => {
        const mod = await import('../../src/services/cre.service');
        creService = mod.creService;
    });

    afterEach(() => {
        creService['contract'] = null;
        creService['signer'] = null;
    });

    it('requestZKFraudDetection: on-chain success', async () => {
        const mockCtx = mockContract({
            requestZKProofVerification: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({
                    logs: [{ topics: ['0x00', '0xreqid123'] }],
                }),
            }),
        });
        creService['contract'] = mockCtx;
        creService['signer'] = mockSigner();

        (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
            id: 'lead-zk-chain',
            vertical: 'solar',
            geo: { state: 'FL', zip: '33101' },
            dataHash: null,
            tcpaConsentAt: new Date(),
            source: 'PLATFORM',
        });
        (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({});

        const result = await creService.requestZKFraudDetection('lead-zk-chain', 1);
        expect(result.isValid).toBe(true);
        expect(result.requestId).toBe('0xreqid123');
    });

    it('requestZKFraudDetection: on-chain error falls back to local', async () => {
        const mockCtx = mockContract({
            requestZKProofVerification: jest.fn().mockRejectedValue(new Error('chain fail')),
        });
        creService['contract'] = mockCtx;
        creService['signer'] = mockSigner();

        (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
            id: 'lead-zk-err',
            vertical: 'solar',
            geo: { state: 'FL' },
            dataHash: null,
            tcpaConsentAt: new Date(),
            source: 'API',
        });
        (prisma.complianceCheck.create as jest.Mock).mockResolvedValue({});

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await creService.requestZKFraudDetection('lead-zk-err', 1);
        expect(result.isValid).toBe(true); // Falls back to local verification
        consoleSpy.mockRestore();
    });

    it('requestParameterMatchOnChain: on-chain success', async () => {
        const mockCtx = mockContract({
            requestParameterMatch: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({
                    logs: [{ topics: ['0x00', '0xreqpm'] }],
                }),
            }),
        });
        creService['contract'] = mockCtx;
        creService['signer'] = mockSigner();

        const result = await creService.requestParameterMatchOnChain(1, {
            vertical: 'solar',
            geoStates: ['FL'],
            paramKeys: ['creditScore'],
            paramValues: ['720'],
        });
        expect(result.isValid).toBe(true);
        expect(result.requestId).toBe('0xreqpm');
    });

    it('requestParameterMatchOnChain: on-chain error', async () => {
        const mockCtx = mockContract({
            requestParameterMatch: jest.fn().mockRejectedValue(new Error('revert')),
        });
        creService['contract'] = mockCtx;
        creService['signer'] = mockSigner();

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await creService.requestParameterMatchOnChain(1, {
            vertical: 'solar', geoStates: ['FL'], paramKeys: [], paramValues: [],
        });
        expect(result.isValid).toBe(false);
        expect(result.reason).toContain('revert');
        consoleSpy.mockRestore();
    });

    it('requestGeoValidationOnChain: on-chain success', async () => {
        const mockCtx = mockContract({
            requestGeoValidation: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({
                    logs: [{ topics: ['0x00', '0xgeoid'] }],
                }),
            }),
        });
        creService['contract'] = mockCtx;
        creService['signer'] = mockSigner();

        const result = await creService.requestGeoValidationOnChain(1, 'FL');
        expect(result.isValid).toBe(true);
        expect(result.requestId).toBe('0xgeoid');
    });

    it('requestGeoValidationOnChain: on-chain error', async () => {
        const mockCtx = mockContract({
            requestGeoValidation: jest.fn().mockRejectedValue(new Error('geo fail')),
        });
        creService['contract'] = mockCtx;
        creService['signer'] = mockSigner();

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await creService.requestGeoValidationOnChain(1, 'FL');
        expect(result.isValid).toBe(false);
        consoleSpy.mockRestore();
    });
});

// ═══════════════════════════════════════════════
// NFT Service — On-Chain Branches
// ═══════════════════════════════════════════════

describe('NFT On-Chain Branches', () => {
    let nftService: any;

    beforeAll(async () => {
        const mod = await import('../../src/services/nft.service');
        nftService = mod.nftService;
    });

    afterEach(() => {
        nftService['contract'] = null;
        nftService['signer'] = null;
    });

    it('mintLeadNFT: on-chain mint success', async () => {
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const mockCtx = mockContract({
            mintLead: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({
                    hash: '0xminttx',
                    logs: [{
                        topics: [transferTopic, '0x00', '0xseller', '0x000000000000000000000000000000000000000000000000000000000000002a'],
                    }],
                }),
            }),
            totalSupply: jest.fn().mockResolvedValue(42n),
        });
        nftService['contract'] = mockCtx;
        nftService['signer'] = mockSigner();

        (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
            id: 'lead-onchain',
            nftTokenId: null,
            vertical: 'solar',
            geo: { state: 'FL' },
            dataHash: null,
            parameters: { creditScore: 750 },
            reservePrice: 50,
            source: 'PLATFORM',
            seller: { user: { walletAddress: '0xSeller' } },
            encryptedData: null,
        });
        (prisma.lead.update as jest.Mock).mockResolvedValue({});

        const result = await nftService.mintLeadNFT('lead-onchain');
        expect(result.success).toBe(true);
        expect(result.txHash).toBe('0xminttx');
    });

    it('mintLeadNFT: on-chain error falls back', async () => {
        const mockCtx = mockContract({
            mintLead: jest.fn().mockRejectedValue(new Error('out of gas')),
        });
        nftService['contract'] = mockCtx;
        nftService['signer'] = mockSigner();

        (prisma.lead.findUnique as jest.Mock).mockResolvedValue({
            id: 'lead-gas-fail',
            nftTokenId: null,
            vertical: 'solar',
            geo: { state: 'FL' },
            dataHash: null,
            parameters: {},
            reservePrice: 0,
            source: 'PLATFORM',
            seller: { user: { walletAddress: '0xSeller' } },
        });

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await nftService.mintLeadNFT('lead-gas-fail');
        expect(result.success).toBe(false);
        expect(result.error).toContain('out of gas');
        consoleSpy.mockRestore();
    });

    it('recordSaleOnChain: on-chain success', async () => {
        const mockCtx = mockContract({
            recordSale: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({ hash: '0xsaletx' }),
            }),
        });
        nftService['contract'] = mockCtx;
        nftService['signer'] = mockSigner();

        const result = await nftService.recordSaleOnChain('42', '0xBuyer', 100);
        expect(result.success).toBe(true);
        expect(result.txHash).toBe('0xsaletx');
    });

    it('recordSaleOnChain: on-chain error', async () => {
        const mockCtx = mockContract({
            recordSale: jest.fn().mockRejectedValue(new Error('sale revert')),
        });
        nftService['contract'] = mockCtx;
        nftService['signer'] = mockSigner();

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await nftService.recordSaleOnChain('42', '0xBuyer', 100);
        expect(result.success).toBe(false);
        consoleSpy.mockRestore();
    });

    it('getTokenMetadata: on-chain success', async () => {
        const mockCtx = mockContract({
            getLeadMetadata: jest.fn().mockResolvedValue({
                vertical: new Uint8Array(Buffer.from('solar')),
                geoHash: '0xgeo',
                dataHash: '0xdata',
                seller: '0xSeller',
                reservePrice: 50000000n,
                qualityScore: 8000,
                isVerified: true,
            }),
            ownerOf: jest.fn().mockResolvedValue('0xOwner'),
            tokenURI: jest.fn().mockResolvedValue('ipfs://Qm...'),
        });
        nftService['contract'] = mockCtx;

        const result = await nftService.getTokenMetadata('42');
        expect(result).not.toBeNull();
        expect(result.owner).toBe('0xOwner');
        expect(result.tokenURI).toBe('ipfs://Qm...');
    });

    it('getTokenMetadata: on-chain error falls back to DB', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const mockCtx = mockContract({
            getLeadMetadata: jest.fn().mockRejectedValue(new Error('metadata fail')),
            ownerOf: jest.fn().mockRejectedValue(new Error('metadata fail')),
            tokenURI: jest.fn().mockRejectedValue(new Error('metadata fail')),
        });
        nftService['contract'] = mockCtx;

        (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
            id: 'lead-fb',
            nftTokenId: '42',
            vertical: 'solar',
            geo: { state: 'FL' },
            dataHash: '0xhash',
            reservePrice: 100,
            isVerified: true,
            seller: { user: { walletAddress: '0xSeller' } },
        });

        const result = await nftService.getTokenMetadata('42');
        expect(result).not.toBeNull();
        expect(result!.vertical).toBe('solar');
        consoleSpy.mockRestore();
    });
});

// ═══════════════════════════════════════════════
// X402 Service — On-Chain Branches
// ═══════════════════════════════════════════════

describe('X402 On-Chain Branches', () => {
    let x402Service: any;

    beforeAll(async () => {
        const mod = await import('../../src/services/x402.service');
        x402Service = mod.x402Service;
    });

    afterEach(() => {
        x402Service['escrowContract'] = null;
        x402Service['usdcContract'] = null;
        x402Service['signer'] = null;
    });

    it('createPayment: on-chain with USDC approval', async () => {
        const mockEscrow = mockContract({
            createEscrow: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({
                    hash: '0xcreatetx',
                    logs: [{ topics: ['0x00', '0xescrow1'] }],
                }),
            }),
            fundEscrow: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({}),
            }),
        });
        const mockUsdc = mockContract({
            allowance: jest.fn().mockResolvedValue(0n),
            approve: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({}),
            }),
        });
        x402Service['escrowContract'] = mockEscrow;
        x402Service['usdcContract'] = mockUsdc;
        x402Service['signer'] = { address: '0xSigner' };

        (prisma.transaction.update as jest.Mock).mockResolvedValue({});

        const result = await x402Service.createPayment('0xS', '0xB', 100, 1, 'tx-1');
        expect(result.success).toBe(true);
        expect(result.escrowId).toBe('0xescrow1');
        expect(result.txHash).toBe('0xcreatetx');
        expect(mockUsdc.approve).toHaveBeenCalled();
    });

    it('createPayment: on-chain without USDC (no usdc contract)', async () => {
        const mockEscrow = mockContract({
            createEscrow: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({
                    hash: '0xcreatetx2',
                    logs: [{ topics: ['0x00', '0xescrow2'] }],
                }),
            }),
        });
        x402Service['escrowContract'] = mockEscrow;
        x402Service['usdcContract'] = null;
        x402Service['signer'] = { address: '0xSigner' };

        (prisma.transaction.update as jest.Mock).mockResolvedValue({});

        const result = await x402Service.createPayment('0xS', '0xB', 50, 2, 'tx-2');
        expect(result.success).toBe(true);
        expect(result.escrowId).toBe('0xescrow2');
    });

    it('createPayment: on-chain error', async () => {
        const mockEscrow = mockContract({
            createEscrow: jest.fn().mockRejectedValue(new Error('insufficient funds')),
        });
        x402Service['escrowContract'] = mockEscrow;
        x402Service['signer'] = { address: '0xSigner' };

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await x402Service.createPayment('0xS', '0xB', 100, 1, 'tx-err');
        expect(result.success).toBe(false);
        expect(result.error).toContain('insufficient');
        consoleSpy.mockRestore();
    });

    it('settlePayment: on-chain release', async () => {
        const mockEscrow = mockContract({
            releaseEscrow: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({ hash: '0xreltx' }),
            }),
        });
        x402Service['escrowContract'] = mockEscrow;
        x402Service['signer'] = mockSigner();

        (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
            id: 'tx-release',
            escrowId: '123', // numeric = on-chain
        });
        (prisma.transaction.update as jest.Mock).mockResolvedValue({});

        const result = await x402Service.settlePayment('tx-release');
        expect(result.success).toBe(true);
        expect(result.txHash).toBe('0xreltx');
    });

    it('settlePayment: on-chain error', async () => {
        const mockEscrow = mockContract({
            releaseEscrow: jest.fn().mockRejectedValue(new Error('not funded')),
        });
        x402Service['escrowContract'] = mockEscrow;
        x402Service['signer'] = mockSigner();

        (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
            id: 'tx-fail', escrowId: '456',
        });

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await x402Service.settlePayment('tx-fail');
        expect(result.success).toBe(false);
        consoleSpy.mockRestore();
    });

    it('refundPayment: on-chain refund', async () => {
        const mockEscrow = mockContract({
            refundEscrow: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({ hash: '0xreftx' }),
            }),
        });
        x402Service['escrowContract'] = mockEscrow;
        x402Service['signer'] = mockSigner();

        (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
            id: 'tx-refund', escrowId: '789',
        });
        (prisma.transaction.update as jest.Mock).mockResolvedValue({});

        const result = await x402Service.refundPayment('tx-refund');
        expect(result.success).toBe(true);
        expect(result.txHash).toBe('0xreftx');
    });

    it('refundPayment: on-chain error', async () => {
        const mockEscrow = mockContract({
            refundEscrow: jest.fn().mockRejectedValue(new Error('already refunded')),
        });
        x402Service['escrowContract'] = mockEscrow;
        x402Service['signer'] = mockSigner();

        (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
            id: 'tx-ref-err', escrowId: '101',
        });

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await x402Service.refundPayment('tx-ref-err');
        expect(result.success).toBe(false);
        consoleSpy.mockRestore();
    });

    it('getPaymentStatus: on-chain status', async () => {
        const mockEscrow = mockContract({
            getEscrow: jest.fn().mockResolvedValue({
                seller: '0xSeller',
                buyer: '0xBuyer',
                amount: 100000000n,
                status: 2, // RELEASED
                createdAt: 1700000000n,
                releasedAt: 1700010000n,
            }),
        });
        x402Service['escrowContract'] = mockEscrow;

        (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
            id: 'tx-onchain',
            escrowId: '42',
        });

        const result = await x402Service.getPaymentStatus('tx-onchain');
        expect(result).not.toBeNull();
        expect(result!.status).toBe('RELEASED');
        expect(result!.seller).toBe('0xSeller');
    });

    it('getPaymentStatus: on-chain error falls back to DB', async () => {
        const mockEscrow = mockContract({
            getEscrow: jest.fn().mockRejectedValue(new Error('fail')),
        });
        x402Service['escrowContract'] = mockEscrow;

        (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
            id: 'tx-fb',
            escrowId: '99',
            amount: 100,
            status: 'ESCROWED',
            createdAt: new Date(),
            lead: { seller: { user: { walletAddress: '0xS' } } },
            buyer: { walletAddress: '0xB' },
        });

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await x402Service.getPaymentStatus('tx-fb');
        expect(result).not.toBeNull();
        expect(result!.status).toBe('ESCROWED');
        consoleSpy.mockRestore();
    });

    it('createPayment: on-chain with sufficient USDC allowance (skip approve)', async () => {
        const approveFn = jest.fn();
        const mockEscrow = mockContract({
            createEscrow: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({
                    hash: '0xcreatetx3',
                    logs: [{ topics: ['0x00', '0xescrow3'] }],
                }),
            }),
            fundEscrow: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({}),
            }),
        });
        const mockUsdc = mockContract({
            allowance: jest.fn().mockResolvedValue(999999999999n), // Huge allowance
            approve: approveFn,
        });
        x402Service['escrowContract'] = mockEscrow;
        x402Service['usdcContract'] = mockUsdc;
        x402Service['signer'] = { address: '0xSigner' };

        (prisma.transaction.update as jest.Mock).mockResolvedValue({});

        const result = await x402Service.createPayment('0xS', '0xB', 50, 1, 'tx-noappv');
        expect(result.success).toBe(true);
        // approve should NOT have been called since allowance is sufficient
        expect(approveFn).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════
// NFT Service — updateQualityScoreOnChain On-Chain
// ═══════════════════════════════════════════════

describe('NFT updateQualityScoreOnChain On-Chain', () => {
    let nftService: any;

    beforeAll(async () => {
        const mod = await import('../../src/services/nft.service');
        nftService = mod.nftService;
    });

    afterEach(() => {
        nftService['contract'] = null;
        nftService['signer'] = null;
    });

    it('updateQualityScoreOnChain: on-chain success', async () => {
        const mockCtx = mockContract({
            updateQualityScore: jest.fn().mockResolvedValue({
                wait: jest.fn().mockResolvedValue({}),
            }),
        });
        nftService['contract'] = mockCtx;
        nftService['signer'] = mockSigner();

        const result = await nftService.updateQualityScoreOnChain('42', 8500);
        expect(result.success).toBe(true);
        expect(mockCtx.updateQualityScore).toHaveBeenCalledWith('42', 8500);
    });

    it('updateQualityScoreOnChain: on-chain error', async () => {
        const mockCtx = mockContract({
            updateQualityScore: jest.fn().mockRejectedValue(new Error('gas limit')),
        });
        nftService['contract'] = mockCtx;
        nftService['signer'] = mockSigner();

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        const result = await nftService.updateQualityScoreOnChain('42', 8500);
        expect(result.success).toBe(false);
        expect(result.error).toContain('gas limit');
        consoleSpy.mockRestore();
    });

    it('updateQualityScoreOnChain: skips for offchain token', async () => {
        const mockCtx = mockContract({
            updateQualityScore: jest.fn(),
        });
        nftService['contract'] = mockCtx;
        nftService['signer'] = mockSigner();

        const result = await nftService.updateQualityScoreOnChain('offchain-123', 8500);
        expect(result.success).toBe(true);
        expect(mockCtx.updateQualityScore).not.toHaveBeenCalled();
    });
});

