/**
 * Escrow Service — canonical entry-point
 *
 * The actual implementation lives in x402.service.ts (historical name).
 * New code should import from here:
 *   import { escrowService } from '../services/escrow.service';
 */

export { x402Service as escrowService } from './x402.service';
