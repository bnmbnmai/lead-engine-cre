/**
 * Escrow Service — canonical entry-point
 *
 * The actual implementation lives in escrow-impl.service.ts.
 * (Previously named x402.service.ts — renamed in P2-11 for clarity.)
 *
 * New code should import from here:
 *   import { escrowService } from '../services/escrow.service';
 */

export { x402Service as escrowService } from './escrow-impl.service';
