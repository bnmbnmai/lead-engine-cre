import { ethers } from 'ethers';
import crypto from 'crypto';

// ============================================
// ZK Proof Service (Hackathon Simulation)
// ============================================
// Uses keccak256 commitments to simulate ZK proofs.
// In production, replace with a real ZK circuit (e.g., Circom/Groth16).

interface ZKProof {
    proof: string;         // Simulated proof (hash)
    publicInputs: string[];// Public inputs for on-chain verification
    commitment: string;    // Commitment hash
}

interface GeoParameterProof extends ZKProof {
    geoMatch: boolean;
    parameterMatch: boolean;
}

class ZKService {
    // ============================================
    // Fraud Detection Proof
    // ============================================

    /**
     * Generate a fraud detection proof for a lead.
     * Proves the lead data is consistent without revealing PII.
     * 
     * Example: Roofing lead in FL — proves location is in FL
     * without revealing exact address.
     */
    generateFraudProof(leadData: {
        vertical: string;
        geoState: string;
        geoZip?: string;
        dataHash: string;
        tcpaConsentAt?: Date;
        source: string;
    }): ZKProof {
        // Public inputs: what we're proving about (no PII)
        const verticalHash = ethers.keccak256(ethers.toUtf8Bytes(leadData.vertical));
        const geoHash = ethers.keccak256(ethers.toUtf8Bytes(leadData.geoState));

        // Private witness: the actual data (not revealed)
        const witness = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
            vertical: leadData.vertical,
            geo: leadData.geoState,
            zip: leadData.geoZip,
            dataHash: leadData.dataHash,
            tcpa: leadData.tcpaConsentAt?.toISOString(),
            source: leadData.source,
            nonce: crypto.randomBytes(16).toString('hex'),
        })));

        // Simulated proof: hash(witness || public_inputs)
        const proof = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32', 'bytes32', 'bytes32'],
            [witness, verticalHash, geoHash]
        ));

        // Commitment: binds the prover to this specific proof
        const commitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32', 'bytes32'],
            [proof, witness]
        ));

        return {
            proof,
            publicInputs: [verticalHash, geoHash, leadData.dataHash],
            commitment,
        };
    }

    // ============================================
    // Geo-Parameter Match Proof
    // ============================================

    /**
     * Generate a ZK proof that a lead matches buyer parameters
     * without revealing the lead's actual data.
     *
     * Example: Prove a roofing lead is in buyer's target states
     * (FL, TX, CA) without revealing the exact city/address.
     */
    generateGeoParameterMatchProof(
        leadData: {
            vertical: string;
            geoState: string;
            geoZip?: string;
            parameters: Record<string, any>;
        },
        buyerCriteria: {
            vertical: string;
            targetStates: string[];
            minParameters?: Record<string, any>;
        }
    ): GeoParameterProof {
        // Check matches privately
        const verticalMatch = leadData.vertical === buyerCriteria.vertical;
        const geoMatch = buyerCriteria.targetStates.length === 0 ||
            buyerCriteria.targetStates.includes(leadData.geoState);

        let parameterMatch = true;
        if (buyerCriteria.minParameters) {
            for (const [key, minVal] of Object.entries(buyerCriteria.minParameters)) {
                if (leadData.parameters[key] === undefined) {
                    parameterMatch = false;
                    break;
                }
                if (typeof minVal === 'number' && leadData.parameters[key] < minVal) {
                    parameterMatch = false;
                    break;
                }
                if (typeof minVal === 'string' && leadData.parameters[key] !== minVal) {
                    parameterMatch = false;
                    break;
                }
            }
        }

        const overallMatch = verticalMatch && geoMatch && parameterMatch;

        // Public inputs: match results (boolean flags, no PII)
        const matchFlags = ethers.AbiCoder.defaultAbiCoder().encode(
            ['bool', 'bool', 'bool'],
            [verticalMatch, geoMatch, parameterMatch]
        );
        const matchFlagsHash = ethers.keccak256(matchFlags);

        // Private witness
        const witness = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
            lead: leadData,
            buyer: buyerCriteria,
            result: overallMatch,
            nonce: crypto.randomBytes(16).toString('hex'),
        })));

        const proof = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32', 'bytes32'],
            [witness, matchFlagsHash]
        ));

        const commitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ['bytes32', 'bytes32'],
            [proof, witness]
        ));

        return {
            proof,
            publicInputs: [matchFlagsHash],
            commitment,
            geoMatch,
            parameterMatch,
        };
    }

    // ============================================
    // Verify Proof Locally
    // ============================================

    /**
     * Verify a ZK proof locally before submitting on-chain.
     * In a real system this would verify the circuit proof.
     */
    verifyProofLocally(proof: ZKProof): { valid: boolean; reason?: string } {
        if (!proof.proof || proof.proof === ethers.ZeroHash) {
            return { valid: false, reason: 'Empty proof' };
        }

        if (!proof.publicInputs || proof.publicInputs.length === 0) {
            return { valid: false, reason: 'No public inputs' };
        }

        if (!proof.commitment || proof.commitment === ethers.ZeroHash) {
            return { valid: false, reason: 'Invalid commitment' };
        }

        // In production: verify the Groth16/PLONK proof against the verifier key
        // For hackathon: the proof structure itself is the verification
        return { valid: true };
    }

    // ============================================
    // Bid Commitment (for commit-reveal)
    // ============================================

    /**
     * Generate a commitment for commit-reveal bidding.
     * commitment = keccak256(abi.encodePacked(amount, salt))
     */
    generateBidCommitment(amount: number, salt?: string): { commitment: string; salt: string } {
        const bidSalt = salt || ethers.hexlify(crypto.randomBytes(32));

        const commitment = ethers.solidityPackedKeccak256(
            ['uint96', 'bytes32'],
            [Math.floor(amount * 1e6), bidSalt] // amount in USDC decimals (6)
        );

        return { commitment, salt: bidSalt };
    }
}

export const zkService = new ZKService();
