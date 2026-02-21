/**
 * P2-12 — Deprecated Enum Values Removal Tests
 *
 * Verifies that:
 *  1. schema.prisma no longer contains deprecated LeadStatus values
 *     (PENDING_PING, IN_PING_POST, REVEAL_PHASE).
 *  2. schema.prisma no longer contains deprecated AuctionPhase values
 *     (PING_POST, REVEAL).
 *  3. All canonical LeadStatus values are still present in schema.prisma.
 *  4. All canonical AuctionPhase values are still present in schema.prisma.
 *  5. The demo reset handler's nonSoldStatuses list contains only canonical values.
 *  6. The migration SQL file contains the correct UPDATE statements.
 *
 * Tests read source files as text — no DB connection or Prisma client required.
 */

import * as fs from 'fs';
import * as path from 'path';

const BACKEND_ROOT = path.join(__dirname, '../..');
const SCHEMA_PATH = path.join(BACKEND_ROOT, 'prisma', 'schema.prisma');
const DEMO_ROUTES = path.join(BACKEND_ROOT, 'src', 'routes', 'demo-panel.routes.ts');
const MIGRATION_SQL = path.join(
    BACKEND_ROOT,
    'prisma', 'migrations',
    '20260221025300_remove_deprecated_enum_values',
    'migration.sql'
);

let schema: string;
let demoSrc: string;
let migration: string;

beforeAll(() => {
    schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    demoSrc = fs.readFileSync(DEMO_ROUTES, 'utf8');
    migration = fs.readFileSync(MIGRATION_SQL, 'utf8');
});

// ─── Helper: extract enum block by name ─────────────────
function extractEnum(src: string, enumName: string): string {
    const re = new RegExp(`enum ${enumName} \\{([^}]*)\\}`, 's');
    const m = src.match(re);
    if (!m) throw new Error(`enum ${enumName} not found in schema`);
    return m[1];
}

// ─── LeadStatus ─────────────────────────────────────────

describe('P2-12 — LeadStatus enum (schema.prisma)', () => {
    let block: string;
    beforeAll(() => { block = extractEnum(schema, 'LeadStatus'); });

    it('does NOT contain PENDING_PING', () => {
        expect(block).not.toContain('PENDING_PING');
    });

    it('does NOT contain IN_PING_POST', () => {
        expect(block).not.toContain('IN_PING_POST');
    });

    it('does NOT contain REVEAL_PHASE', () => {
        expect(block).not.toContain('REVEAL_PHASE');
    });

    it('still contains PENDING_AUCTION', () => {
        expect(block).toContain('PENDING_AUCTION');
    });

    it('still contains IN_AUCTION', () => {
        expect(block).toContain('IN_AUCTION');
    });

    it('still contains SOLD, UNSOLD, EXPIRED, CANCELLED, DISPUTED', () => {
        for (const v of ['SOLD', 'UNSOLD', 'EXPIRED', 'CANCELLED', 'DISPUTED']) {
            expect(block).toContain(v);
        }
    });
});

// ─── AuctionPhase ───────────────────────────────────────

describe('P2-12 — AuctionPhase enum (schema.prisma)', () => {
    let block: string;
    beforeAll(() => { block = extractEnum(schema, 'AuctionPhase'); });

    it('does NOT contain PING_POST', () => {
        expect(block).not.toContain('PING_POST');
    });

    it('does NOT contain bare REVEAL (as an enum value)', () => {
        // "REVEAL" must not appear as a standalone value (a comment like
        // "revealEndsAt" is fine; we check for the enum value pattern)
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        const valueLines = lines.filter(l => !l.startsWith('//'));
        expect(valueLines).not.toContain('REVEAL');
    });

    it('still contains BIDDING, RESOLVED, CANCELLED', () => {
        for (const v of ['BIDDING', 'RESOLVED', 'CANCELLED']) {
            expect(block).toContain(v);
        }
    });
});

// ─── demo-panel.routes.ts ────────────────────────────────

describe('P2-12 — demo-panel.routes.ts nonSoldStatuses', () => {
    it('finds the nonSoldStatuses assignment', () => {
        expect(demoSrc).toContain('nonSoldStatuses');
    });

    it('does not include PENDING_PING', () => {
        const line = demoSrc.split('\n').find(l => l.includes('nonSoldStatuses'));
        expect(line).toBeDefined();
        expect(line).not.toContain('PENDING_PING');
    });

    it('does not include IN_PING_POST', () => {
        const line = demoSrc.split('\n').find(l => l.includes('nonSoldStatuses'));
        expect(line).not.toContain('IN_PING_POST');
    });

    it('does not include REVEAL_PHASE', () => {
        const line = demoSrc.split('\n').find(l => l.includes('nonSoldStatuses'));
        expect(line).not.toContain('REVEAL_PHASE');
    });
});

// ─── Migration SQL sanity check ──────────────────────────

describe('P2-12 — Migration SQL correctness', () => {
    it('migrates PENDING_PING → PENDING_AUCTION', () => {
        expect(migration).toContain("'PENDING_PING'");
        expect(migration).toContain("'PENDING_AUCTION'");
    });

    it('migrates IN_PING_POST → PENDING_AUCTION', () => {
        expect(migration).toContain("'IN_PING_POST'");
    });

    it('migrates REVEAL_PHASE → IN_AUCTION', () => {
        expect(migration).toContain("'REVEAL_PHASE'");
        expect(migration).toContain("'IN_AUCTION'");
    });

    it('migrates PING_POST → BIDDING', () => {
        expect(migration).toContain("'PING_POST'");
        expect(migration).toContain("'BIDDING'");
    });

    it('migrates REVEAL → RESOLVED', () => {
        expect(migration).toContain("'REVEAL'");
        expect(migration).toContain("'RESOLVED'");
    });

    it('recreates LeadStatus without deprecated values (DROP + CREATE)', () => {
        expect(migration).toContain('DROP TYPE "LeadStatus_old"');
        expect(migration).toContain('CREATE TYPE "LeadStatus"');
    });

    it('recreates AuctionPhase without deprecated values (DROP + CREATE)', () => {
        expect(migration).toContain('DROP TYPE "AuctionPhase_old"');
        expect(migration).toContain('CREATE TYPE "AuctionPhase"');
    });
});
