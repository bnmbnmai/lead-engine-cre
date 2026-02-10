import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';

// ============================================
// x402 Payment Protocol Service
// ============================================
// Wraps RTBEscrow for HTTP-native payment flows

const ESCROW_CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || '';
const USDC_CONTRACT_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_SEPOLIA || 'https://eth-sepolia.g.alchemy.com/v2/demo';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

const ESCROW_ABI = [
    'function createEscrow(address seller, address buyer, uint256 amount, uint256 leadTokenId) returns (uint256 escrowId)',
    'function fundEscrow(uint256 escrowId)',
    'function releaseEscrow(uint256 escrowId)',
    'function refundEscrow(uint256 escrowId)',
    'function getEscrow(uint256 escrowId) view returns (tuple(address seller, address buyer, uint256 amount, uint256 leadTokenId, uint8 status, uint256 createdAt, uint256 releasedAt))',
    'function platformFeeBps() view returns (uint256)',
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
];

interface PaymentResult {
    success: boolean;
    escrowId?: string;
    txHash?: string;
    error?: string;
}

interface PaymentStatus {
    escrowId: string;
    seller: string;
    buyer: string;
    amount: string;
    status: 'PENDING' | 'ESCROWED' | 'RELEASED' | 'REFUNDED' | 'DISPUTED';
    createdAt: Date;
    releasedAt?: Date;
    platformFee?: string;
}

class X402Service {
    private provider: ethers.JsonRpcProvider;
    private escrowContract: ethers.Contract | null = null;
    private usdcContract: ethers.Contract | null = null;
    private signer: ethers.Wallet | null = null;

    constructor() {
        this.provider = new ethers.JsonRpcProvider(RPC_URL);

        if (DEPLOYER_KEY) {
            this.signer = new ethers.Wallet(DEPLOYER_KEY, this.provider);
        }

        if (ESCROW_CONTRACT_ADDRESS && this.signer) {
            this.escrowContract = new ethers.Contract(
                ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, this.signer
            );
        }

        if (USDC_CONTRACT_ADDRESS && this.signer) {
            this.usdcContract = new ethers.Contract(
                USDC_CONTRACT_ADDRESS, ERC20_ABI, this.signer
            );
        }
    }

    // ============================================
    // Create & Fund Payment (single flow)
    // ============================================

    async createPayment(
        sellerAddress: string,
        buyerAddress: string,
        amountUSDC: number,
        leadTokenId: number,
        transactionId: string
    ): Promise<PaymentResult> {
        const amountWei = BigInt(Math.floor(amountUSDC * 1e6));

        if (this.escrowContract && this.signer) {
            try {
                const createTx = await this.escrowContract.createEscrow(
                    sellerAddress, buyerAddress, amountWei, leadTokenId
                );
                const createReceipt = await createTx.wait();
                const escrowId = createReceipt?.logs?.[0]?.topics?.[1] || '0';
                const parsedEscrowId = escrowId.toString();

                if (this.usdcContract) {
                    const currentAllowance = await this.usdcContract.allowance(
                        this.signer.address, ESCROW_CONTRACT_ADDRESS
                    );
                    if (currentAllowance < amountWei) {
                        const approveTx = await this.usdcContract.approve(
                            ESCROW_CONTRACT_ADDRESS, amountWei * 10n
                        );
                        await approveTx.wait();
                    }

                    const fundTx = await this.escrowContract.fundEscrow(parsedEscrowId);
                    await fundTx.wait();
                }

                await prisma.transaction.update({
                    where: { id: transactionId },
                    data: {
                        escrowId: parsedEscrowId,
                        status: 'ESCROWED',
                    },
                });

                return {
                    success: true,
                    escrowId: parsedEscrowId,
                    txHash: createReceipt?.hash,
                };
            } catch (error: any) {
                console.error('x402 createPayment on-chain failed:', error);
                return { success: false, error: error.message };
            }
        }

        // Off-chain fallback
        const escrowId = `offchain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        await prisma.transaction.update({
            where: { id: transactionId },
            data: {
                escrowId,
                status: 'ESCROWED',
            },
        });

        return { success: true, escrowId };
    }

    // ============================================
    // Settle Payment (release from escrow)
    // ============================================

    async settlePayment(transactionId: string): Promise<PaymentResult> {
        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId },
        });

        if (!transaction || !transaction.escrowId) {
            return { success: false, error: 'Transaction or escrow not found' };
        }

        if (this.escrowContract && this.signer && !transaction.escrowId.startsWith('offchain-')) {
            try {
                const tx = await this.escrowContract.releaseEscrow(transaction.escrowId);
                const receipt = await tx.wait();

                await prisma.transaction.update({
                    where: { id: transactionId },
                    data: {
                        status: 'RELEASED',
                        escrowReleased: true,
                        releasedAt: new Date(),
                    },
                });

                return { success: true, txHash: receipt?.hash };
            } catch (error: any) {
                console.error('x402 settlePayment on-chain failed:', error);
                return { success: false, error: error.message };
            }
        }

        await prisma.transaction.update({
            where: { id: transactionId },
            data: {
                status: 'RELEASED',
                escrowReleased: true,
                releasedAt: new Date(),
            },
        });

        return { success: true };
    }

    // ============================================
    // Refund Payment
    // ============================================

    async refundPayment(transactionId: string): Promise<PaymentResult> {
        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId },
        });

        if (!transaction || !transaction.escrowId) {
            return { success: false, error: 'Transaction or escrow not found' };
        }

        if (this.escrowContract && this.signer && !transaction.escrowId.startsWith('offchain-')) {
            try {
                const tx = await this.escrowContract.refundEscrow(transaction.escrowId);
                const receipt = await tx.wait();

                await prisma.transaction.update({
                    where: { id: transactionId },
                    data: { status: 'REFUNDED' },
                });

                return { success: true, txHash: receipt?.hash };
            } catch (error: any) {
                console.error('x402 refundPayment on-chain failed:', error);
                return { success: false, error: error.message };
            }
        }

        await prisma.transaction.update({
            where: { id: transactionId },
            data: { status: 'REFUNDED' },
        });

        return { success: true };
    }

    // ============================================
    // Get Payment Status
    // ============================================

    async getPaymentStatus(transactionId: string): Promise<PaymentStatus | null> {
        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId },
            include: { lead: { include: { seller: { include: { user: true } } } }, buyer: true },
        });

        if (!transaction) return null;

        // Try on-chain status
        if (this.escrowContract && transaction.escrowId && !transaction.escrowId.startsWith('offchain-')) {
            try {
                const escrow = await this.escrowContract.getEscrow(transaction.escrowId);
                const statusMap = ['PENDING', 'ESCROWED', 'RELEASED', 'REFUNDED', 'DISPUTED'] as const;

                return {
                    escrowId: transaction.escrowId,
                    seller: escrow.seller,
                    buyer: escrow.buyer,
                    amount: ethers.formatUnits(escrow.amount, 6),
                    status: statusMap[Number(escrow.status)] || 'PENDING',
                    createdAt: new Date(Number(escrow.createdAt) * 1000),
                    releasedAt: escrow.releasedAt > 0 ? new Date(Number(escrow.releasedAt) * 1000) : undefined,
                };
            } catch (error) {
                console.error('x402 getPaymentStatus on-chain failed:', error);
            }
        }

        // Fallback to database
        const sellerAddress = transaction.lead?.seller?.user?.walletAddress || '';
        return {
            escrowId: transaction.escrowId || '',
            seller: sellerAddress,
            buyer: transaction.buyer?.walletAddress || '',
            amount: transaction.amount?.toString() || '0',
            status: transaction.status as any,
            createdAt: transaction.createdAt,
            releasedAt: transaction.releasedAt || undefined,
        };
    }

    // ============================================
    // x402 Payment Header (HTTP-native)
    // ============================================

    generatePaymentHeader(
        escrowId: string,
        amount: number,
        recipient: string
    ): Record<string, string> {
        return {
            'X-Payment-Protocol': 'x402',
            'X-Payment-Version': '1.0',
            'X-Payment-Escrow-Id': escrowId,
            'X-Payment-Amount': amount.toFixed(6),
            'X-Payment-Currency': 'USDC',
            'X-Payment-Recipient': recipient,
            'X-Payment-Network': 'sepolia',
        };
    }
}

export const x402Service = new X402Service();
