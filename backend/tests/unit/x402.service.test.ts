/**
 * x402 Service Unit Tests
 * 
 * Tests payment lifecycle (create, settle, refund), off-chain fallback,
 * payment status retrieval, and x402 HTTP header generation.
 */

jest.mock('../../src/lib/prisma', () => ({
    prisma: {
        transaction: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    },
}));

import { prisma } from '../../src/lib/prisma';

let x402Service: any;

beforeAll(async () => {
    const mod = await import('../../src/services/x402.service');
    x402Service = mod.x402Service;
});

afterEach(() => {
    jest.clearAllMocks();
});

describe('X402Service', () => {

    // ─── createPayment (off-chain fallback) ──────

    describe('createPayment', () => {
        it('should create off-chain escrow when no contract configured', async () => {
            (prisma.transaction.update as jest.Mock).mockResolvedValue({});

            const result = await x402Service.createPayment(
                '0xSeller', '0xBuyer', 35.50, 1, 'tx-123'
            );

            expect(result.success).toBe(true);
            expect(result.escrowId).toMatch(/^offchain-/);
            expect(prisma.transaction.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'tx-123' },
                    data: expect.objectContaining({
                        escrowId: expect.stringContaining('offchain-'),
                        status: 'ESCROWED',
                    }),
                })
            );
        });
    });

    // ─── settlePayment ───────────────────────────

    describe('settlePayment', () => {
        it('should settle off-chain transaction', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx-1',
                escrowId: 'offchain-12345',
                status: 'ESCROWED',
            });
            (prisma.transaction.update as jest.Mock).mockResolvedValue({});

            const result = await x402Service.settlePayment('tx-1');
            expect(result.success).toBe(true);
            expect(prisma.transaction.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        status: 'RELEASED',
                        escrowReleased: true,
                    }),
                })
            );
        });

        it('should return error for non-existent transaction', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await x402Service.settlePayment('tx-missing');
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });

        it('should return error for transaction without escrow', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx-2',
                escrowId: null,
            });

            const result = await x402Service.settlePayment('tx-2');
            expect(result.success).toBe(false);
        });
    });

    // ─── refundPayment ───────────────────────────

    describe('refundPayment', () => {
        it('should refund off-chain transaction', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx-3',
                escrowId: 'offchain-67890',
                status: 'ESCROWED',
            });
            (prisma.transaction.update as jest.Mock).mockResolvedValue({});

            const result = await x402Service.refundPayment('tx-3');
            expect(result.success).toBe(true);
            expect(prisma.transaction.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: { status: 'REFUNDED' },
                })
            );
        });

        it('should return error for non-existent transaction', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await x402Service.refundPayment('tx-missing');
            expect(result.success).toBe(false);
        });
    });

    // ─── getPaymentStatus ────────────────────────

    describe('getPaymentStatus', () => {
        it('should return null for non-existent transaction', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await x402Service.getPaymentStatus('tx-missing');
            expect(result).toBeNull();
        });

        it('should return DB-based status for off-chain escrow', async () => {
            const mockTx = {
                id: 'tx-4',
                escrowId: 'offchain-111',
                buyerId: 'user-1',
                amount: 35.50,
                status: 'ESCROWED',
                createdAt: new Date('2025-01-01'),
                releasedAt: null,
                lead: {
                    seller: {
                        user: { walletAddress: '0xSeller' },
                    },
                },
                buyer: {
                    walletAddress: '0xBuyer',
                },
            };
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(mockTx);

            const result = await x402Service.getPaymentStatus('tx-4');
            expect(result).not.toBeNull();
            expect(result!.escrowId).toBe('offchain-111');
            expect(result!.seller).toBe('0xSeller');
            expect(result!.buyer).toBe('0xBuyer');
            expect(result!.status).toBe('ESCROWED');
        });
    });

    // ─── generatePaymentHeader ───────────────────

    describe('generatePaymentHeader', () => {
        it('should generate correct x402 payment headers', () => {
            const headers = x402Service.generatePaymentHeader(
                'escrow-123', 35.50, '0xRecipient'
            );

            expect(headers['X-Payment-Protocol']).toBe('x402');
            expect(headers['X-Payment-Version']).toBe('1.0');
            expect(headers['X-Payment-Escrow-Id']).toBe('escrow-123');
            expect(headers['X-Payment-Amount']).toBe('35.500000');
            expect(headers['X-Payment-Currency']).toBe('USDC');
            expect(headers['X-Payment-Recipient']).toBe('0xRecipient');
            expect(headers['X-Payment-Network']).toBe('sepolia');
        });

        it('should handle zero amount', () => {
            const headers = x402Service.generatePaymentHeader('esc-0', 0, '0x0');
            expect(headers['X-Payment-Amount']).toBe('0.000000');
        });
    });

    // ─── Edge Cases ──────────────────────────────

    describe('edge cases', () => {
        it('should handle double-settle gracefully', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx-double',
                escrowId: 'offchain-double',
                status: 'RELEASED',
            });
            (prisma.transaction.update as jest.Mock).mockResolvedValue({});

            const result = await x402Service.settlePayment('tx-double');
            expect(result.success).toBe(true);
        });

        it('should create escrow with large USDC amount', async () => {
            (prisma.transaction.update as jest.Mock).mockResolvedValue({});

            const result = await x402Service.createPayment(
                '0xSeller', '0xBuyer', 999999.99, 42, 'tx-large'
            );
            expect(result.success).toBe(true);
            expect(result.escrowId).toMatch(/^offchain-/);
        });

        it('should create escrow with zero amount', async () => {
            (prisma.transaction.update as jest.Mock).mockResolvedValue({});

            const result = await x402Service.createPayment(
                '0xSeller', '0xBuyer', 0, 1, 'tx-zero'
            );
            expect(result.success).toBe(true);
        });

        it('should handle refund for already-refunded transaction', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx-refunded',
                escrowId: 'offchain-refunded',
                status: 'REFUNDED',
            });
            (prisma.transaction.update as jest.Mock).mockResolvedValue({});

            const result = await x402Service.refundPayment('tx-refunded');
            expect(result.success).toBe(true);
        });

        it('should return error for refund without escrow', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx-noesc',
                escrowId: null,
            });

            const result = await x402Service.refundPayment('tx-noesc');
            expect(result.success).toBe(false);
        });

        it('should return status with releasedAt timestamp', async () => {
            const relDate = new Date('2025-06-15T12:00:00Z');
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx-rel',
                escrowId: 'offchain-rel',
                buyerId: 'usr-1',
                amount: 100,
                status: 'RELEASED',
                createdAt: new Date('2025-06-15T11:59:50Z'),
                releasedAt: relDate,
                lead: { seller: { user: { walletAddress: '0xS' } } },
                buyer: { walletAddress: '0xB' },
            });

            const result = await x402Service.getPaymentStatus('tx-rel');
            expect(result).not.toBeNull();
            expect(result!.status).toBe('RELEASED');
            expect(result!.releasedAt).toEqual(relDate);
        });

        it('should generate headers with custom escrow ID', () => {
            const headers = x402Service.generatePaymentHeader('custom-esc', 100, '0xR');
            expect(headers['X-Payment-Escrow-Id']).toBe('custom-esc');
            expect(headers['X-Payment-Amount']).toBe('100.000000');
        });
    });
});
