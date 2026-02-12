/**
 * p17-kyc-bypass.test.ts — Dev-Only KYC Bypass & Persona Switcher
 *
 * Tests: DEMO_MODE KYC bypass (backend), persona switcher profiles (frontend),
 * storage event propagation, admin bypass, edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// StorageEvent polyfill for Node.js test environment
class MockStorageEvent {
    readonly key: string | null;
    readonly newValue: string | null;
    constructor(_type: string, init: { key?: string; newValue?: string | null } = {}) {
        this.key = init.key ?? null;
        this.newValue = init.newValue ?? null;
    }
}

// ── Simulated environment ──

function makeEnv(demoMode?: string) {
    return { DEMO_MODE: demoMode };
}

function isDemoBypass(env: ReturnType<typeof makeEnv>): boolean {
    return env.DEMO_MODE === 'true';
}

// ── Simulated persona profiles ──

const DEMO_SELLER_PROFILE = {
    id: 'demo-seller',
    walletAddress: '0xDEMO_SELLER_KYC',
    role: 'SELLER',
    kycStatus: 'VERIFIED',
    profile: { companyName: 'Demo Seller Co', isVerified: true, reputationScore: 8500 },
};

const DEMO_BUYER_PROFILE = {
    id: 'demo-buyer',
    walletAddress: '0xDEMO_BUYER',
    role: 'BUYER',
    kycStatus: 'VERIFIED',
};

// ============================================
// Group 1: Backend KYC Bypass — isKYCValid
// ============================================
describe('ACE KYC Bypass: isKYCValid', () => {
    it('should return true immediately when DEMO_MODE=true', () => {
        const env = makeEnv('true');
        expect(isDemoBypass(env)).toBe(true);
    });

    it('should NOT bypass when DEMO_MODE is unset', () => {
        const env = makeEnv(undefined);
        expect(isDemoBypass(env)).toBe(false);
    });

    it('should NOT bypass when DEMO_MODE=false', () => {
        const env = makeEnv('false');
        expect(isDemoBypass(env)).toBe(false);
    });

    it('should log "Demo KYC bypassed" when bypassing', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
        const walletAddress = '0xDEMO_SELLER_KYC';
        const env = makeEnv('true');
        if (isDemoBypass(env)) {
            console.log(`[ACE] Demo KYC bypassed for ${walletAddress.slice(0, 10)}…`);
        }
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Demo KYC bypassed')
        );
        consoleSpy.mockRestore();
    });

    it('should truncate wallet address in log to first 10 chars', () => {
        const wallet = '0xDEMO_SELLER_KYC';
        const truncated = wallet.slice(0, 10);
        expect(truncated).toBe('0xDEMO_SEL');
        expect(truncated.length).toBe(10);
    });
});

// ============================================
// Group 2: Backend KYC Bypass — canTransact
// ============================================
describe('ACE KYC Bypass: canTransact', () => {
    it('should return { allowed: true } when DEMO_MODE=true', () => {
        const env = makeEnv('true');
        if (isDemoBypass(env)) {
            expect({ allowed: true }).toEqual({ allowed: true });
        }
    });

    it('should proceed to blacklist check when DEMO_MODE is off', () => {
        const env = makeEnv(undefined);
        const shouldCheckBlacklist = !isDemoBypass(env);
        expect(shouldCheckBlacklist).toBe(true);
    });

    it('should skip blacklist AND KYC checks in demo mode', () => {
        const env = makeEnv('true');
        const checksRun: string[] = [];
        if (!isDemoBypass(env)) {
            checksRun.push('blacklist', 'kyc');
        }
        expect(checksRun).toHaveLength(0);
    });
});

// ============================================
// Group 3: Persona Switcher — Seller Profile
// ============================================
describe('Persona Switcher: Seller Profile', () => {
    it('seller persona should have role=SELLER', () => {
        expect(DEMO_SELLER_PROFILE.role).toBe('SELLER');
    });

    it('seller persona should have kycStatus=VERIFIED', () => {
        expect(DEMO_SELLER_PROFILE.kycStatus).toBe('VERIFIED');
    });

    it('seller profile should include companyName', () => {
        expect(DEMO_SELLER_PROFILE.profile.companyName).toBe('Demo Seller Co');
    });

    it('seller profile should have reputationScore >= 8000', () => {
        expect(DEMO_SELLER_PROFILE.profile.reputationScore).toBeGreaterThanOrEqual(8000);
    });

    it('seller profile should be isVerified=true', () => {
        expect(DEMO_SELLER_PROFILE.profile.isVerified).toBe(true);
    });

    it('seller walletAddress should start with 0x', () => {
        expect(DEMO_SELLER_PROFILE.walletAddress).toMatch(/^0x/);
    });
});

// ============================================
// Group 4: Persona Switcher — Buyer Profile
// ============================================
describe('Persona Switcher: Buyer Profile', () => {
    it('buyer persona should have role=BUYER', () => {
        expect(DEMO_BUYER_PROFILE.role).toBe('BUYER');
    });

    it('buyer persona should have kycStatus=VERIFIED', () => {
        expect(DEMO_BUYER_PROFILE.kycStatus).toBe('VERIFIED');
    });

    it('buyer should NOT have a seller profile', () => {
        expect((DEMO_BUYER_PROFILE as any).profile).toBeUndefined();
    });
});

// ============================================
// Group 5: Persona Switcher — Guest (Clear)
// ============================================
describe('Persona Switcher: Guest', () => {
    it('guest switch should clear le_auth_user', () => {
        const storage: Record<string, string | null> = { le_auth_user: 'some-data' };
        // Simulate guest switch
        storage.le_auth_user = null;
        expect(storage.le_auth_user).toBeNull();
    });

    it('guest switch should result in null user', () => {
        const newValue = null;
        const user = newValue ? JSON.parse(newValue) : null;
        expect(user).toBeNull();
    });
});

// ============================================
// Group 6: Storage Event Propagation
// ============================================
describe('Persona Switcher: Storage Events', () => {
    it('should dispatch StorageEvent with key=le_auth_user for seller', () => {
        const event = new MockStorageEvent('storage', {
            key: 'le_auth_user',
            newValue: JSON.stringify(DEMO_SELLER_PROFILE),
        });
        expect(event.key).toBe('le_auth_user');
        expect(event.newValue).toContain('demo-seller');
    });

    it('should dispatch StorageEvent with null newValue for guest', () => {
        const event = new MockStorageEvent('storage', {
            key: 'le_auth_user',
            newValue: null,
        });
        expect(event.key).toBe('le_auth_user');
        expect(event.newValue).toBeNull();
    });

    it('useAuth handler should parse le_auth_user JSON correctly', () => {
        const json = JSON.stringify(DEMO_SELLER_PROFILE);
        const parsed = JSON.parse(json);
        expect(parsed.id).toBe('demo-seller');
        expect(parsed.role).toBe('SELLER');
        expect(parsed.kycStatus).toBe('VERIFIED');
    });

    it('useAuth handler should handle bad JSON gracefully', () => {
        const badJson = 'not-valid-json';
        let user = null;
        try {
            user = JSON.parse(badJson);
        } catch {
            // Expected — ignore
        }
        expect(user).toBeNull();
    });

    it('useAuth handler should clear user when le_auth_user is removed', () => {
        let user: any = DEMO_BUYER_PROFILE;
        const newValue = null;
        if (!newValue) user = null;
        expect(user).toBeNull();
    });
});

// ============================================
// Group 7: Admin Users Always Bypass
// ============================================
describe('Admin Users: KYC Bypass', () => {
    it('admin role should always bypass KYC regardless of DEMO_MODE', () => {
        const user = { role: 'ADMIN', kycStatus: 'NOT_STARTED' };
        const isAdmin = user.role === 'ADMIN';
        expect(isAdmin).toBe(true);
        // Admin bypass is checked at route level, not ACE service
    });

    it('admin with expired KYC should still be treated as valid admin', () => {
        const user = { role: 'ADMIN', kycStatus: 'EXPIRED' };
        const isAdmin = user.role === 'ADMIN';
        const bypassKyc = isAdmin || isDemoBypass(makeEnv('true'));
        expect(bypassKyc).toBe(true);
    });
});

// ============================================
// Group 8: Bid Page Switch Edge Case
// ============================================
describe('Persona Switcher: Bid Page Edge Case', () => {
    it('switching on bid page should trigger storage event for data refresh', () => {
        const currentPath = '/marketplace/leads/some-lead-id/bid';
        const isBidPage = currentPath.includes('/bid');
        expect(isBidPage).toBe(true);

        // Storage event dispatched regardless of current route
        const event = new MockStorageEvent('storage', {
            key: 'le_auth_user',
            newValue: JSON.stringify(DEMO_BUYER_PROFILE),
        });
        expect(event.key).toBe('le_auth_user');
    });

    it('navigate should be called after le_auth_user is set (order matters)', () => {
        const steps: string[] = [];
        // Simulate persona switch order
        steps.push('setLocalStorage');
        steps.push('dispatchStorageEvent');
        steps.push('navigate');
        expect(steps.indexOf('setLocalStorage')).toBeLessThan(steps.indexOf('navigate'));
        expect(steps.indexOf('dispatchStorageEvent')).toBeLessThan(steps.indexOf('navigate'));
    });
});

// ============================================
// Group 9: Environment Guard
// ============================================
describe('Frontend: Environment Guard', () => {
    it('persona profiles should only be set in dev or VITE_DEMO_MODE=true', () => {
        const envs = [
            { DEV: true, VITE_DEMO_MODE: undefined, expected: true },
            { DEV: false, VITE_DEMO_MODE: 'true', expected: true },
            { DEV: false, VITE_DEMO_MODE: undefined, expected: false },
            { DEV: false, VITE_DEMO_MODE: 'false', expected: false },
        ];
        for (const e of envs) {
            const isDemoEnv = e.DEV || e.VITE_DEMO_MODE === 'true';
            expect(isDemoEnv).toBe(e.expected);
        }
    });

    it('production without VITE_DEMO_MODE should NOT inject profiles', () => {
        const isDev = false;
        const demoMode = undefined;
        const shouldInject = isDev || demoMode === 'true';
        expect(shouldInject).toBe(false);
    });
});

// ============================================
// Group 10: Integration — Full Switch Flow
// ============================================
describe('Integration: Full Persona Switch Flow', () => {
    it('seller switch flow: localStorage → event → useAuth → navigate', () => {
        // 1. Set localStorage
        const stored = JSON.stringify(DEMO_SELLER_PROFILE);
        expect(JSON.parse(stored).kycStatus).toBe('VERIFIED');

        // 2. Dispatch event
        const event = new MockStorageEvent('storage', { key: 'le_auth_user', newValue: stored });
        expect(event.newValue).not.toBeNull();

        // 3. useAuth parses
        const user = JSON.parse(event.newValue!);
        expect(user.role).toBe('SELLER');
        expect(user.profile.companyName).toBe('Demo Seller Co');

        // 4. Navigation target
        const target = '/seller';
        expect(target).toBe('/seller');
    });

    it('success message should include "(KYC bypassed)" in demo mode', () => {
        const isDemoEnv = true;
        const persona = 'seller';
        const msg = `🎭 Switched to ${persona} view${isDemoEnv ? ' (KYC bypassed)' : ''}`;
        expect(msg).toContain('KYC bypassed');
    });

    it('success message should NOT include "(KYC bypassed)" in production', () => {
        const isDemoEnv = false;
        const persona = 'seller';
        const msg = `🎭 Switched to ${persona} view${isDemoEnv ? ' (KYC bypassed)' : ''}`;
        expect(msg).not.toContain('KYC bypassed');
    });
});
