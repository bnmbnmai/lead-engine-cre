/**
 * Fail-closed auth matrix (Phase D3).
 * Static checks that critical routes enforce authentication middleware.
 */

import fs from 'fs';
import path from 'path';

const ROUTES_DIR = path.join(__dirname, '../../src/routes');

const MUST_AUTH = [
    'mcp.routes.ts',
    'strategy.routes.ts',
    'agent.routes.ts',
    'bidding.routes.ts',
];

describe('Auth fail-closed matrix (D3)', () => {
    for (const file of MUST_AUTH) {
        it(`${file} applies authMiddleware`, () => {
            const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
            expect(src).toMatch(/authMiddleware/);
            expect(src).not.toMatch(/router\.use\(authMiddleware\)\s*;\s*\/\/\s*disabled/i);
        });
    }

    it('auto-bid match-results uses validateCreApiKey', () => {
        const src = fs.readFileSync(path.join(ROUTES_DIR, 'auto-bid.routes.ts'), 'utf8');
        expect(src).toContain('validateCreApiKey');
        expect(src).toContain('match-results');
    });

    it('ingest routes use requireSharedSecret', () => {
        const src = fs.readFileSync(path.join(ROUTES_DIR, 'ingest.routes.ts'), 'utf8');
        expect(src).toContain('requireSharedSecret');
    });
});
