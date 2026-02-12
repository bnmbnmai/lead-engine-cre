/**
 * P8 — Seller Routing, Profile & Expiry Tests
 *
 * 15 tests across 4 describe blocks:
 *   - Routing (5): dashboard links, submit redirect, App.tsx route, ask routes
 *   - Expiry (3): default, curl example, API docs
 *   - Profile auto-create (4): submit auto-creates, ask still errors, profile data, admin
 *   - Edge cases (3): role switch, profile exists, ask profile gate
 */

function readFrontend(relativePath: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../../../frontend/src', relativePath), 'utf-8');
}

function readBackend(relativePath: string): string {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../../src', relativePath), 'utf-8');
}

// ============================================
// 1. Routing (5 tests)
// ============================================

describe('Seller Routing', () => {
    test('SellerDashboard lead links use /seller/leads/:id path', () => {
        const src = readFrontend('pages/SellerDashboard.tsx');
        // Should contain seller-prefixed lead links
        expect(src).toContain('/seller/leads/${lead.id}');
        // Should NOT contain the old broken /lead/ path
        expect(src).not.toContain("to={`/lead/${lead.id}`}");
    });

    test('SellerSubmit success redirects to /seller/leads/:id', () => {
        const src = readFrontend('pages/SellerSubmit.tsx');
        expect(src).toContain('/seller/leads/${lead.id}');
        expect(src).not.toContain("navigate(`/lead/${lead.id}`)");
    });

    test('App.tsx has /seller/leads/:leadId detail route', () => {
        const src = readFrontend('App.tsx');
        expect(src).toContain('/seller/leads/:leadId');
    });

    test('App.tsx has /seller/asks route', () => {
        const src = readFrontend('App.tsx');
        expect(src).toContain('path="/seller/asks"');
    });

    test('App.tsx has /seller/asks/new route', () => {
        const src = readFrontend('App.tsx');
        expect(src).toContain('path="/seller/asks/new"');
    });
});

// ============================================
// 2. Expiry Defaults (3 tests)
// ============================================

describe('Lead Expiry', () => {
    test('validation.ts defaults expiresInMinutes to 5', () => {
        const src = readBackend('utils/validation.ts');
        expect(src).toContain('.default(5)');
        expect(src).not.toContain('.default(60)');
    });

    test('curl example uses expiresInMinutes: 5', () => {
        const src = readFrontend('pages/SellerSubmit.tsx');
        expect(src).toContain('"expiresInMinutes": 5');
        expect(src).not.toContain('"expiresInMinutes": 60');
    });

    test('API docs table shows default: 5', () => {
        const src = readFrontend('pages/SellerSubmit.tsx');
        expect(src).toContain('(default: 5)');
        expect(src).not.toContain('(default: 60)');
    });
});

// ============================================
// 3. Profile Auto-Create (4 tests)
// ============================================

describe('Profile Auto-Create', () => {
    test('submit lead endpoint auto-creates profile instead of returning SELLER_PROFILE_MISSING', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        // Find the submit endpoint section
        const submitIdx = src.indexOf("'/leads/submit'");
        const submitSection = src.slice(submitIdx, submitIdx + 1500);

        // Should auto-create
        expect(submitSection).toContain('sellerProfile.create');
        // Should NOT have the old hard error for lead submit
        expect(submitSection).not.toContain("code: 'SELLER_PROFILE_MISSING'");
    });

    test('auto-created profile uses truncated wallet address as company name', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        const submitIdx = src.indexOf("'/leads/submit'");
        const submitSection = src.slice(submitIdx, submitIdx + 1500);
        expect(submitSection).toContain('walletAddress');
        expect(submitSection).toContain('.slice(0, 10)');
    });

    test('auto-created profile includes submitted vertical', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        const submitIdx = src.indexOf("'/leads/submit'");
        const submitSection = src.slice(submitIdx, submitIdx + 1500);
        expect(submitSection).toContain('verticals: [data.vertical]');
    });

    test('ask creation STILL requires explicit profile (hard gate)', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        // Find the POST asks endpoint (Create Ask), not GET asks (List)
        const postAsksIdx = src.indexOf("router.post('/asks'");
        expect(postAsksIdx).toBeGreaterThan(-1);
        const askSection = src.slice(postAsksIdx, postAsksIdx + 1000);
        expect(askSection).toContain("SELLER_PROFILE_MISSING");
    });
});

// ============================================
// 4. Edge Cases (3 tests)
// ============================================

describe('Edge Cases', () => {
    test('SellerDashboard tabs all use /seller/* paths', () => {
        const src = readFrontend('pages/SellerDashboard.tsx');
        // Extract DASHBOARD_TABS paths
        const pathMatches = src.match(/path:\s*'([^']+)'/g) || [];
        for (const match of pathMatches) {
            const path = match.replace(/path:\s*'/, '').replace(/'/, '');
            expect(path).toMatch(/^\/seller/);
        }
    });

    test('seller variable is mutable (let) in submit lead for auto-create', () => {
        const src = readBackend('routes/marketplace.routes.ts');
        // Find the submit section
        const submitIdx = src.indexOf("'/leads/submit'");
        const submitSection = src.slice(submitIdx, submitIdx + 500);
        expect(submitSection).toContain('let seller');
        expect(submitSection).not.toContain('const seller');
    });

    test('SellerSubmit has profile wizard with company name and verticals', () => {
        const src = readFrontend('pages/SellerSubmit.tsx');
        expect(src).toContain('wizardCompany');
        expect(src).toContain('wizardVerticals');
        expect(src).toContain('Create Seller Profile');
    });
});
