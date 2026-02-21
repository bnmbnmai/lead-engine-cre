/**
 * P2-14 — DevLogPanel Ring Buffer Tests
 *
 * Verifies that the DevLogPanel log array is correctly capped at MAX_DEV_LOG_ENTRIES (200)
 * using a ring-buffer (addCapped) pattern, and that all setEntries call sites use it.
 *
 * Coverage:
 *  1. MAX_DEV_LOG_ENTRIES is exported from DevLogPanel.tsx with value 200
 *  2. addCapped() helper is defined in DevLogPanel.tsx
 *  3. addCapped() returns the entry appended when below cap
 *  4. addCapped() slices to last N entries when cap is exceeded
 *  5. After 250 pushes, array length never exceeds 200
 *  6. Oldest entries are dropped (newest are retained)
 *  7. All setEntries call sites use addCapped() — no unbounded [...prev, entry] pattern
 *  8. reconnect notice uses addCapped()
 *  9. disconnect handler uses addCapped()
 * 10. reconnect_failed handler uses addCapped()
 * 11. demo:log handler uses addCapped()
 * 12. ace:dev-log handler uses addCapped()
 * 13. demo:complete handler uses addCapped()
 */

import * as fs from 'fs';
import * as path from 'path';

const FRONTEND_ROOT = path.join(__dirname, '../../../frontend');
const DEVLOG_SRC = path.join(FRONTEND_ROOT, 'src', 'components', 'demo', 'DevLogPanel.tsx');

let src: string;

beforeAll(() => {
    src = fs.readFileSync(DEVLOG_SRC, 'utf8');
});

// ──────────────────────────────────────────────────────────────
// Constant export
// ──────────────────────────────────────────────────────────────

describe('P2-14 — MAX_DEV_LOG_ENTRIES constant', () => {

    it('exports MAX_DEV_LOG_ENTRIES', () => {
        expect(src).toContain('export const MAX_DEV_LOG_ENTRIES');
    });

    it('MAX_DEV_LOG_ENTRIES is 200', () => {
        const match = src.match(/export const MAX_DEV_LOG_ENTRIES\s*=\s*(\d+)/);
        expect(match).not.toBeNull();
        expect(Number(match![1])).toBe(200);
    });

    it('does NOT export the old private MAX_ENTRIES name', () => {
        // The old `const MAX_ENTRIES = 200;` must be gone
        expect(src).not.toMatch(/\bconst MAX_ENTRIES\s*=/);
    });
});

// ──────────────────────────────────────────────────────────────
// addCapped() helper definition
// ──────────────────────────────────────────────────────────────

describe('P2-14 — addCapped() helper', () => {

    it('defines addCapped() function', () => {
        expect(src).toContain('function addCapped(');
    });

    it('addCapped returns a new array with the entry appended', () => {
        expect(src).toContain('const next = [...prev, entry]');
    });

    it('addCapped slices to the last MAX_DEV_LOG_ENTRIES when limit exceeded', () => {
        // The slice must use the exported constant (not a magic number)
        expect(src).toContain('next.slice(-MAX_DEV_LOG_ENTRIES)');
    });

    it('addCapped returns next unchanged when under the limit', () => {
        // The ternary must check .length > MAX_DEV_LOG_ENTRIES
        expect(src).toContain('next.length > MAX_DEV_LOG_ENTRIES');
    });
});

// ──────────────────────────────────────────────────────────────
// In-process ring buffer simulation
// (No DOM/React required — pure-function logic extracted from the pattern)
// ──────────────────────────────────────────────────────────────

describe('P2-14 — ring buffer semantics (simulated)', () => {

    const MAX = 200;

    // Replicate addCapped() exactly as written in the source
    function addCapped(prev: any[], entry: any): any[] {
        const next = [...prev, entry];
        return next.length > MAX ? next.slice(-MAX) : next;
    }

    it('array length stays at 0 → 200 for the first 200 pushes', () => {
        let arr: any[] = [];
        for (let i = 0; i < MAX; i++) {
            arr = addCapped(arr, { n: i });
        }
        expect(arr).toHaveLength(MAX);
    });

    it('array length never exceeds 200 after 250 pushes', () => {
        let arr: any[] = [];
        for (let i = 0; i < 250; i++) {
            arr = addCapped(arr, { n: i });
        }
        expect(arr.length).toBeLessThanOrEqual(MAX);
        expect(arr).toHaveLength(MAX);
    });

    it('oldest entries are dropped — newest 200 are retained', () => {
        let arr: any[] = [];
        for (let i = 0; i < 250; i++) {
            arr = addCapped(arr, { n: i });
        }
        // Entry 0–49 should be gone (oldest 50 dropped)
        expect(arr[0]).toEqual({ n: 50 });
        // Entry 249 should be the last
        expect(arr[arr.length - 1]).toEqual({ n: 249 });
    });

    it('exactly 1 push to full array drops exactly 1 oldest entry', () => {
        let arr: any[] = [];
        for (let i = 0; i < MAX; i++) {
            arr = addCapped(arr, { n: i });
        }
        // Push one more
        arr = addCapped(arr, { n: MAX });
        expect(arr).toHaveLength(MAX);
        expect(arr[0]).toEqual({ n: 1 }); // entry 0 was dropped
        expect(arr[MAX - 1]).toEqual({ n: MAX });
    });

    it('single push to empty array returns array of length 1', () => {
        const result = addCapped([], { msg: 'hello' });
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ msg: 'hello' });
    });

    it('preserves all field values on entries that survive', () => {
        let arr: any[] = [];
        for (let i = 0; i < 210; i++) {
            arr = addCapped(arr, { n: i, label: `entry-${i}` });
        }
        // Entry 10 should survive (210 - 200 = 10 dropped)
        expect(arr[0]).toEqual({ n: 10, label: 'entry-10' });
    });
});

// ──────────────────────────────────────────────────────────────
// All setEntries call sites use addCapped()
// ──────────────────────────────────────────────────────────────

describe('P2-14 — all setEntries call sites use addCapped()', () => {

    it('no unbounded [...prev, entry] spread in setEntries callbacks', () => {
        // Find all setEntries( occurrences and check none use [...prev, ...] directly
        // The only valid pattern is addCapped(prev, ...) or returning prev unchanged (empty guard)
        const setEntriesCalls = src.split('setEntries(').slice(1); // skip the import/declaration line
        for (const call of setEntriesCalls) {
            // The callback body, up to the closing paren (crude but sufficient for source scan)
            const body = call.slice(0, 300);
            // It must NOT contain [...prev, { directly (that's the unbounded pattern)
            // Exception: the empty-guard `return prev` is fine
            const hasUnboundedSpread = /\[\.\.\.\s*prev\s*,\s*\{/.test(body);
            expect(hasUnboundedSpread).toBe(false);
        }
    });

    it('ace:dev-log handler uses addCapped(prev, data)', () => {
        // The handler is defined as: const handler = (data) => { setEntries(prev => addCapped(prev, data)); }
        const aceSection = extractBetween(src, 'ace:dev-log events from Chainlink services', "socketClient.on('ace:dev-log'");
        expect(aceSection).toContain('addCapped(prev, data)');
    });

    it('demo:log handler uses addCapped(prev, entry)', () => {
        // Handler body defined before socketClient.on('demo:log', ...)
        const demoLogSection = extractBetween(src, 'const demoHandler', "socketClient.on('demo:log'");
        expect(demoLogSection).toContain('addCapped(prev, entry)');
    });

    it('demo:complete handler uses addCapped(prev, completionEntry)', () => {
        // Handler body defined before socketClient.on('demo:complete', ...)
        const completeSection = extractBetween(src, 'const completeHandler', "socketClient.on('demo:complete'");
        expect(completeSection).toContain('addCapped(prev, completionEntry)');
    });

    it('disconnect handler uses addCapped', () => {
        const disconnectSection = extractBetween(src, 'const onDisconnect', 'const onConnectError');
        expect(disconnectSection).toContain('addCapped(prev,');
    });

    it('reconnect_failed handler uses addCapped', () => {
        const reconnectFailedSection = extractBetween(src, 'const onReconnectFailed', 'sock.on(');
        expect(reconnectFailedSection).toContain('addCapped(prev,');
    });

    it('reconnect notice (onConnect) uses addCapped', () => {
        const onConnectSection = extractBetween(src, 'const onConnect', 'const onDisconnect');
        // The reconnect notice only applies if prev.length > 0, but must still be capped
        expect(onConnectSection).toContain('addCapped(prev,');
    });
});

// ──────────────────────────────────────────────────────────────
// Helper
// ──────────────────────────────────────────────────────────────

function extractBetween(src: string, startMarker: string, endMarker: string): string {
    const startIdx = src.indexOf(startMarker);
    if (startIdx === -1) return '';
    const endIdx = src.indexOf(endMarker, startIdx + startMarker.length);
    if (endIdx === -1) return src.slice(startIdx);
    return src.slice(startIdx, endIdx);
}
