import { ethers } from 'ethers';
import { prisma } from '../lib/prisma';

// ============================================
// x402 Payment Protocol Service
// ============================================
// Wraps RTBEscrow for HTTP-native payment flows

const ESCROW_CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS_BASE_SEPOLIA || process.env.ESCROW_CONTRACT_ADDRESS || '';
const USDC_CONTRACT_ADDRESS = process.env.USDC_CONTRACT_ADDRESS || '';
const RPC_URL = process.env.RPC_URL_BASE_SEPOLIA || process.env.RPC_URL_SEPOLIA || 'https://sepolia.base.org';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const PLATFORM_WALLET_ADDRESS = process.env.PLATFORM_WALLET_ADDRESS || process.env.DEPLOYER_ADDRESS || '';

const ESCROW_ABI = [
    'function createEscrow(string calldata leadId, address seller, address buyer, uint256 amount) returns (uint256)',
    'function createAndFundEscrow(string calldata leadId, address seller, uint256 amount, uint256 convenienceFee) returns (uint256)',
    'function fundEscrow(uint256 escrowId)',
    'function releaseEscrow(uint256 escrowId)',
    'function refundEscrow(uint256 escrowId)',

    'function getEscrow(uint256 escrowId) view returns (tuple(string leadId, address seller, address buyer, uint256 amount, uint256 platformFee, uint256 createdAt, uint256 releaseTime, uint8 state))',
    'function platformFeeBps() view returns (uint256)',
    'function owner() view returns (address)',
    'function authorizedCallers(address) view returns (bool)',
    'function setAuthorizedCaller(address caller, bool authorized)',
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
];

interface PaymentResult {
    success: boolean;
    escrowId?: string;
    txHash?: string;
    error?: string;
    offChain?: boolean;
}

interface PreparedEscrowTx {
    /** Data the buyer needs to sign with MetaMask */
    escrowContractAddress: string;
    usdcContractAddress: string;
    /** ABI-encoded calldata for createEscrow() — legacy 2-step flow */
    createEscrowCalldata: string;
    /** ABI-encoded calldata for createAndFundEscrow() — single-signature flow */
    createAndFundEscrowCalldata?: string;
    /** ABI-encoded calldata for USDC approve() */
    approveCalldata: string;
    /** Amount in USDC wei (6 decimals) */
    amountWei: string;
    /** Human-readable amount */
    amountUSDC: number;
    /** Chain ID */
    chainId: number;
    /** Transaction ID in our DB */
    transactionId: string;
    leadId: string;
    /** Optional: USDC transfer calldata for $1 convenience fee (legacy path) */
    convenienceFeeTransferCalldata?: string;
    convenienceFeeAmountWei?: string;
    platformWalletAddress?: string;
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
    offChain?: boolean;
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
        leadId: string,
        transactionId: string
    ): Promise<PaymentResult> {
        const amountWei = BigInt(Math.floor(amountUSDC * 1e6));

        // ── Guard: on-chain infra required ──
        if (!this.escrowContract || !this.signer) {
            const missing = [];
            if (!ESCROW_CONTRACT_ADDRESS) missing.push('ESCROW_CONTRACT_ADDRESS');
            if (!DEPLOYER_KEY) missing.push('DEPLOYER_PRIVATE_KEY');
            const msg = `On-chain escrow not configured: missing ${missing.join(', ')}`;
            console.error(`[x402] createPayment FAILED: ${msg}`);
            return { success: false, error: msg };
        }

        console.log(`[x402] createPayment START:`, {
            leadId,
            seller: sellerAddress,
            buyer: buyerAddress,
            amountUSDC,
            amountWei: amountWei.toString(),
            transactionId,
            signerAddress: this.signer.address,
            escrowContract: ESCROW_CONTRACT_ADDRESS,
            usdcContract: USDC_CONTRACT_ADDRESS || '(not set)',
        });

        try {
            // Step 1: Create escrow on-chain
            // Contract: createEscrow(string leadId, address seller, address buyer, uint256 amount)
            console.log(`[x402] Step 1: createEscrow("${leadId}", ${sellerAddress}, ${buyerAddress}, ${amountWei})`);
            const createTx = await this.escrowContract.createEscrow(
                leadId, sellerAddress, buyerAddress, amountWei
            );
            console.log(`[x402] createEscrow tx sent: ${createTx.hash}`);
            const createReceipt = await createTx.wait();
            const escrowId = createReceipt?.logs?.[0]?.topics?.[1] || '0';
            const parsedEscrowId = escrowId.toString();
            console.log(`[x402] createEscrow confirmed — escrowId=${parsedEscrowId}, block=${createReceipt?.blockNumber}`);

            // Step 2: Approve + Fund escrow
            if (this.usdcContract) {
                const currentAllowance = await this.usdcContract.allowance(
                    this.signer.address, ESCROW_CONTRACT_ADDRESS
                );
                console.log(`[x402] Step 2a: USDC allowance check — current=${currentAllowance.toString()}, needed=${amountWei.toString()}`);

                if (currentAllowance < amountWei) {
                    console.log(`[x402] Step 2b: Approving USDC spend...`);
                    const approveTx = await this.usdcContract.approve(
                        ESCROW_CONTRACT_ADDRESS, amountWei * 10n
                    );
                    await approveTx.wait();
                    console.log(`[x402] USDC approved: ${approveTx.hash}`);
                }

                console.log(`[x402] Step 2c: fundEscrow(${parsedEscrowId})`);
                const fundTx = await this.escrowContract.fundEscrow(parsedEscrowId);
                await fundTx.wait();
                console.log(`[x402] fundEscrow confirmed: ${fundTx.hash}`);
            } else {
                console.warn(`[x402] USDC contract not configured — escrow created but NOT funded`);
            }

            // Step 3: Transfer convenience fee to platform wallet (if applicable)
            const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
            const convFee = (transaction as any)?.convenienceFee ? Number((transaction as any).convenienceFee) : 0;
            if (convFee > 0 && this.usdcContract && PLATFORM_WALLET_ADDRESS) {
                try {
                    const feeWei = BigInt(Math.floor(convFee * 1e6));
                    console.log(`[x402] Step 3: Transferring $${convFee} convenience fee → ${PLATFORM_WALLET_ADDRESS.slice(0, 10)}…`);
                    const feeTx = await this.usdcContract.transfer(PLATFORM_WALLET_ADDRESS, feeWei);
                    await feeTx.wait();
                    console.log(`[x402] Convenience fee transfer confirmed: ${feeTx.hash}`);
                } catch (feeErr: any) {
                    console.error(`[x402] Convenience fee transfer FAILED (non-fatal):`, feeErr.message);
                }
            }

            // Step 4: Update DB
            await prisma.transaction.update({
                where: { id: transactionId },
                data: {
                    escrowId: parsedEscrowId,
                    status: 'ESCROWED',
                },
            });

            console.log(`[x402] createPayment COMPLETE — escrowId=${parsedEscrowId}, txHash=${createReceipt?.hash}`);
            return {
                success: true,
                escrowId: parsedEscrowId,
                txHash: createReceipt?.hash,
            };
        } catch (error: any) {
            // ── Handle "Escrow exists for lead" — recover the existing escrow ──
            if (error.reason === 'Escrow exists for lead' && this.escrowContract && this.signer) {
                console.warn(`[x402] Escrow already exists for lead ${leadId} — scanning on-chain to recover escrowId`);
                try {
                    const existingEscrowId = await this.findEscrowByLeadId(leadId);
                    if (existingEscrowId !== null) {
                        const escrow = await this.escrowContract.getEscrow(existingEscrowId);
                        const stateMap = ['PENDING', 'ESCROWED', 'RELEASED', 'REFUNDED', 'DISPUTED'] as const;
                        const escrowState = stateMap[Number(escrow.state)] || 'PENDING';
                        console.log(`[x402] Found existing escrow ${existingEscrowId} — state=${escrowState}`);

                        // Fund if still in PENDING (created but not funded)
                        if (escrowState === 'PENDING' && this.usdcContract) {
                            console.log(`[x402] Funding existing escrow ${existingEscrowId}`);
                            const currentAllowance = await this.usdcContract.allowance(
                                this.signer.address, ESCROW_CONTRACT_ADDRESS
                            );
                            if (currentAllowance < amountWei) {
                                const approveTx = await this.usdcContract.approve(
                                    ESCROW_CONTRACT_ADDRESS, amountWei * 10n
                                );
                                await approveTx.wait();
                            }
                            const fundTx = await this.escrowContract.fundEscrow(existingEscrowId);
                            await fundTx.wait();
                            console.log(`[x402] fundEscrow confirmed for recovered escrow`);
                        }

                        // Update DB
                        const parsedId = existingEscrowId.toString();
                        await prisma.transaction.update({
                            where: { id: transactionId },
                            data: {
                                escrowId: parsedId,
                                status: escrowState === 'PENDING' ? 'ESCROWED' : escrowState,
                            },
                        });

                        console.log(`[x402] Recovered existing escrow — escrowId=${parsedId}, state=${escrowState}`);
                        return { success: true, escrowId: parsedId };
                    }
                } catch (recoveryErr: any) {
                    console.error(`[x402] Escrow recovery scan failed:`, recoveryErr.message);
                }
            }

            // ── Detailed error diagnostics ──
            const errorInfo = {
                message: error.message,
                code: error.code,
                reason: error.reason,
                shortMessage: error.shortMessage,
                transaction: error.transaction ? {
                    to: error.transaction.to,
                    from: error.transaction.from,
                    data: error.transaction.data?.slice(0, 66) + '...',
                } : undefined,
                signerAddress: this.signer.address,
                signerBalance: 'unknown',
            };

            // Check ETH balance for gas
            try {
                const balance = await this.provider.getBalance(this.signer.address);
                errorInfo.signerBalance = ethers.formatEther(balance) + ' ETH';
            } catch { /* ignore */ }

            console.error(`[x402] createPayment FAILED:`, JSON.stringify(errorInfo, null, 2));
            console.error(`[x402] Full stack:`, error.stack || error);

            // Human-readable error
            let userError = error.shortMessage || error.reason || error.message;
            if (error.code === 'INSUFFICIENT_FUNDS') {
                userError = `Deployer wallet has insufficient ETH for gas (${errorInfo.signerBalance}). Fund ${this.signer.address} on Base Sepolia.`;
            } else if (error.code === 'CALL_EXCEPTION') {
                userError = `Contract call reverted: ${error.reason || error.message}. Check that ESCROW_CONTRACT_ADDRESS is correct and deployed on Base Sepolia.`;
            }

            return { success: false, error: userError };
        }
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

        if (!this.escrowContract || !this.signer) {
            return { success: false, error: 'On-chain escrow contract not configured' };
        }

        console.log(`[x402] settlePayment START: txId=${transactionId}, escrowId=${transaction.escrowId}`);

        try {
            const tx = await this.escrowContract.releaseEscrow(transaction.escrowId);
            console.log(`[x402] releaseEscrow tx sent: ${tx.hash}`);
            const receipt = await tx.wait();

            await prisma.transaction.update({
                where: { id: transactionId },
                data: {
                    status: 'RELEASED',
                    escrowReleased: true,
                    releasedAt: new Date(),
                    txHash: receipt?.hash || tx.hash,
                    chainId: 84532, // Base Sepolia
                },
            });

            console.log(`[x402] settlePayment COMPLETE — txHash=${receipt?.hash}`);
            return { success: true, txHash: receipt?.hash };
        } catch (error: any) {
            console.error(`[x402] settlePayment FAILED:`, {
                message: error.message,
                code: error.code,
                reason: error.reason,
                shortMessage: error.shortMessage,
            });
            console.error(`[x402] Full stack:`, error.stack || error);
            return { success: false, error: error.shortMessage || error.reason || error.message };
        }
    }

    // ============================================
    // Find existing escrow by leadId (scan on-chain)
    // ============================================

    private async findEscrowByLeadId(leadId: string): Promise<number | null> {
        if (!this.escrowContract) return null;
        // Scan recent escrow IDs (contract has sequential IDs starting from 1)
        for (let id = 1; id <= 50; id++) {
            try {
                const escrow = await this.escrowContract.getEscrow(id);
                if (escrow.leadId === leadId) {
                    console.log(`[x402] Found escrow #${id} for lead ${leadId}`);
                    return id;
                }
            } catch {
                // getEscrow reverts for non-existent IDs — we've scanned all
                break;
            }
        }
        console.warn(`[x402] No existing escrow found for lead ${leadId} (scanned 1-50)`);
        return null;
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

        // Off-chain / unconfigured: DB-only refund
        if (!this.escrowContract || !this.signer || transaction.escrowId.startsWith('offchain-')) {
            console.error(`[x402] ⚠️ DB-ONLY refund for tx=${transactionId} (escrowId=${transaction.escrowId}) — no on-chain refund executed`);
            await prisma.transaction.update({
                where: { id: transactionId },
                data: { status: 'REFUNDED' },
            });
            return { success: true, offChain: true, error: 'DB-only refund — no on-chain refund executed' };
        }

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
            offChain: true,
        };
    }

    // ============================================
    // Prepare Escrow Tx (client-side signing flow)
    // ============================================
    // Returns unsigned tx data for the buyer's MetaMask to sign.
    // Does NOT touch the chain — just encodes the calldata.

    async prepareEscrowTx(
        sellerAddress: string,
        buyerAddress: string,
        amountUSDC: number,
        leadId: string,
        transactionId: string
    ): Promise<{ success: boolean; data?: PreparedEscrowTx; error?: string }> {
        if (!ESCROW_CONTRACT_ADDRESS) {
            return { success: false, error: 'ESCROW_CONTRACT_ADDRESS not configured' };
        }
        if (!USDC_CONTRACT_ADDRESS) {
            return { success: false, error: 'USDC_CONTRACT_ADDRESS not configured' };
        }

        const amountWei = BigInt(Math.floor(amountUSDC * 1e6));

        // Encode legacy createEscrow calldata (backward compat)
        const escrowIface = new ethers.Interface(ESCROW_ABI);
        const createEscrowCalldata = escrowIface.encodeFunctionData('createEscrow', [
            leadId, sellerAddress, buyerAddress, amountWei,
        ]);

        // Look up convenience fee from the Transaction record
        let convenienceFeeWei = 0n;
        let convenienceFeeFields: Pick<PreparedEscrowTx, 'convenienceFeeTransferCalldata' | 'convenienceFeeAmountWei' | 'platformWalletAddress'> = {};
        try {
            const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
            const convFee = (transaction as any)?.convenienceFee ? Number((transaction as any).convenienceFee) : 0;
            if (convFee > 0) {
                convenienceFeeWei = BigInt(Math.floor(convFee * 1e6));
                if (PLATFORM_WALLET_ADDRESS) {
                    const erc20Iface = new ethers.Interface(ERC20_ABI);
                    const transferCalldata = erc20Iface.encodeFunctionData('transfer', [
                        PLATFORM_WALLET_ADDRESS, convenienceFeeWei,
                    ]);
                    convenienceFeeFields = {
                        convenienceFeeTransferCalldata: transferCalldata,
                        convenienceFeeAmountWei: convenienceFeeWei.toString(),
                        platformWalletAddress: PLATFORM_WALLET_ADDRESS,
                    };
                }
                console.log(`[x402] Convenience fee: $${convFee} (${convenienceFeeWei} wei)`);
            }
        } catch (err) {
            console.warn(`[x402] Could not look up convenience fee for tx=${transactionId}:`, err);
        }

        // Encode single-signature createAndFundEscrow calldata
        const createAndFundEscrowCalldata = escrowIface.encodeFunctionData('createAndFundEscrow', [
            leadId, sellerAddress, amountWei, convenienceFeeWei,
        ]);

        // Encode USDC approve calldata (approve escrow for amount + fee)
        const erc20Iface = new ethers.Interface(ERC20_ABI);
        const totalApproval = (amountWei + convenienceFeeWei) * 10n; // 10x buffer
        const approveCalldata = erc20Iface.encodeFunctionData('approve', [
            ESCROW_CONTRACT_ADDRESS, totalApproval,
        ]);

        console.log(`[x402] prepareEscrowTx: lead=${leadId}, buyer=${buyerAddress}, amount=$${amountUSDC} (${amountWei} wei), convFee=${convenienceFeeWei} wei`);

        return {
            success: true,
            data: {
                escrowContractAddress: ESCROW_CONTRACT_ADDRESS,
                usdcContractAddress: USDC_CONTRACT_ADDRESS,
                createEscrowCalldata,
                createAndFundEscrowCalldata,
                approveCalldata,
                amountWei: amountWei.toString(),
                amountUSDC,
                chainId: 84532, // Base Sepolia
                transactionId,
                leadId,
                ...convenienceFeeFields,
            },
        };
    }

    // ============================================
    // Confirm Escrow Tx (after buyer signs)
    // ============================================
    // Verifies the buyer's signed tx landed on-chain, extracts
    // the escrowId from the receipt, and updates the DB.

    async confirmEscrowTx(
        transactionId: string,
        escrowTxHash: string,
        fundTxHash?: string,
        convenienceFeeTxHash?: string
    ): Promise<PaymentResult> {
        console.log(`[x402] confirmEscrowTx START: txId=${transactionId}, escrowTxHash=${escrowTxHash}${convenienceFeeTxHash ? `, convFeeTx=${convenienceFeeTxHash}` : ''}`);

        try {
            // 1. Wait for createEscrow tx receipt
            const receipt = await this.provider.waitForTransaction(escrowTxHash, 1, 60_000);
            if (!receipt || receipt.status !== 1) {
                return { success: false, error: `Escrow tx failed or not found (hash=${escrowTxHash})` };
            }

            // 2. Extract escrowId from EscrowCreated event log
            const escrowIface = new ethers.Interface(ESCROW_ABI);
            let parsedEscrowId = '0';
            for (const log of receipt.logs) {
                try {
                    const parsed = escrowIface.parseLog({ topics: log.topics as string[], data: log.data });
                    if (parsed && parsed.name === 'EscrowCreated') {
                        parsedEscrowId = parsed.args[0].toString(); // first indexed arg = escrowId
                        break;
                    }
                } catch { /* not our event */ }
            }

            // Fallback: extract from first topic
            if (parsedEscrowId === '0' && receipt.logs.length > 0) {
                parsedEscrowId = receipt.logs[0].topics?.[1] || '0';
            }

            console.log(`[x402] confirmEscrowTx: escrowId=${parsedEscrowId}, block=${receipt.blockNumber}`);

            // 3. If fundTxHash provided, verify it too
            if (fundTxHash) {
                const fundReceipt = await this.provider.waitForTransaction(fundTxHash, 1, 60_000);
                if (!fundReceipt || fundReceipt.status !== 1) {
                    console.warn(`[x402] fundEscrow tx failed (hash=${fundTxHash}), escrow created but not funded`);
                }
            }

            // 3b. If convenience fee transfer was sent, verify it (best-effort)
            if (convenienceFeeTxHash) {
                try {
                    const feeReceipt = await this.provider.waitForTransaction(convenienceFeeTxHash, 1, 60_000);
                    if (feeReceipt && feeReceipt.status === 1) {
                        console.log(`[x402] Convenience fee transfer confirmed: ${convenienceFeeTxHash}`);
                    } else {
                        console.warn(`[x402] Convenience fee transfer failed (hash=${convenienceFeeTxHash}) — fee not collected`);
                    }
                } catch (feeErr) {
                    console.warn(`[x402] Convenience fee transfer verification failed:`, feeErr);
                }
            }

            // 4. Update DB — mark escrow as released since the buyer's wallet
            //    created and funded the escrow in a single client-side flow.
            await prisma.transaction.update({
                where: { id: transactionId },
                data: {
                    escrowId: parsedEscrowId,
                    txHash: escrowTxHash,
                    status: 'RELEASED',
                    escrowReleased: true,
                    chainId: 84532, // Base Sepolia
                },
            });

            console.log(`[x402] confirmEscrowTx COMPLETE — escrowId=${parsedEscrowId}`);
            return { success: true, escrowId: parsedEscrowId, txHash: escrowTxHash };
        } catch (error: any) {
            console.error(`[x402] confirmEscrowTx FAILED:`, error.message);
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // Public getters for contract addresses
    // ============================================

    get escrowAddress(): string { return ESCROW_CONTRACT_ADDRESS; }
    get usdcAddress(): string { return USDC_CONTRACT_ADDRESS; }

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
            'X-Payment-Network': 'base-sepolia',
        };
    }

}

export const x402Service = new X402Service();

