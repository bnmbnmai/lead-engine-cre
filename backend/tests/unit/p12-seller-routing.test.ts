/**
 * p12-seller-routing.test.ts
 *
 * 16 tests verifying seller routing, profile UX, expiry alignment, and role guards:
 *  - Routing (5)
 *  - Profile (3)
 *  - Expiry (3)
 *  - Lead Data (2)
 *  - Role Guards (3)
 */

import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '../../..');
const frontendSrc = path.join(projectRoot, 'frontend/src');
const backendSrc = path.join(projectRoot, 'backend/src');

function readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

// ============================================
// 1. Routing (5 tests)
// ============================================

describe('Routing', () => {
    test('1. AskCard accepts basePath prop with default /marketplace/ask', () => {
        const src = readFile(path.join(frontendSrc, 'components/marketplace/AskCard.tsx'));
        expect(src).toContain('basePath?: string');
        expect(src).toContain("basePath = '/marketplace/ask'");
    });

    test('2. AskCard uses basePath in Link destination', () => {
        const src = readFile(path.join(frontendSrc, 'components/marketplace/AskCard.tsx'));
        expect(src).toContain('`${basePath}/${ask.id}`');
        expect(src).not.toContain("'/marketplace/ask/${ask.id}'");
    });

    test('3. SellerDashboard links asks to AskDetailPage', () => {
        const src = readFile(path.join(frontendSrc, 'pages/SellerDashboard.tsx'));
        // Inline ask cards link to /marketplace/ask/:id (the shared AskDetailPage)
        expect(src).toContain('/marketplace/ask/${ask.id}');
    });

    test('4. App.tsx contains /seller/asks/:askId route', () => {
        const src = readFile(path.join(frontendSrc, 'App.tsx'));
        expect(src).toContain('/seller/asks/:askId');
    });

    test('5. All SellerDashboard links use /seller/* paths (except ask detail)', () => {
        const src = readFile(path.join(frontendSrc, 'pages/SellerDashboard.tsx'));
        // Dashboard link destinations
        expect(src).toContain('to="/seller/submit"');
        expect(src).toContain('to="/seller/asks/new"');
        expect(src).toContain('to="/seller/leads"');
        // Analytics uses href prop in Quick Actions array, not direct `to=`
        expect(src).toContain("'/seller/analytics'");
        // Links should be /seller/* or /marketplace/ask/* (shared ask detail page)
        const linkMatches = src.match(/to="([^"]+)"/g) || [];
        const nonSellerLinks = linkMatches.filter(l => {
            const dest = l.match(/to="([^"]+)"/)?.[1] || '';
            return dest.startsWith('/') && !dest.startsWith('/seller') && !dest.startsWith('/marketplace/ask') && dest !== '/';
        });
        expect(nonSellerLinks).toEqual([]);
    });
});

// ============================================
// 2. Profile (3 tests)
// ============================================

describe('Profile', () => {
    test('6. SellerDashboard shows profile creation CTA', () => {
        const src = readFile(path.join(frontendSrc, 'pages/SellerDashboard.tsx'));
        expect(src).toContain('Create Profile');
        expect(src).toContain('hasProfile');
        expect(src).toContain('Complete your seller profile');
    });

    test('7. SellerSubmit uses useVerticals instead of hard-coded list', () => {
        const src = readFile(path.join(frontendSrc, 'pages/SellerSubmit.tsx'));
        expect(src).toContain("import { useVerticals } from '@/hooks/useVerticals'");
        expect(src).toContain('useVerticals()');
        // Should NOT have old hard-coded array
        expect(src).not.toMatch(/const VERTICALS\s*=\s*\[/);
    });

    test('8. Profile wizard contains company name and vertical fields', () => {
        const src = readFile(path.join(frontendSrc, 'pages/SellerSubmit.tsx'));
        expect(src).toContain('Company Name');
        expect(src).toContain('Lead Verticals');
        expect(src).toContain('wizardCompany');
        expect(src).toContain('wizardVerticals');
    });
});

// ============================================
// 3. Expiry (3 tests)
// ============================================

describe('Expiry', () => {
    test('9. LeadSubmitForm schema defaults expiresInMinutes via LEAD_EXPIRY_DEFAULT', () => {
        const src = readFile(path.join(frontendSrc, 'components/forms/LeadSubmitForm.tsx'));
        expect(src).toContain('LEAD_EXPIRY_DEFAULT');
        expect(src).toMatch(/expiresInMinutes.*\.default\(LEAD_EXPIRY_DEFAULT\)/);
    });

    test('10. LeadSubmitForm dropdown includes 5-minute option', () => {
        const src = readFile(path.join(frontendSrc, 'components/forms/LeadSubmitForm.tsx'));
        expect(src).toContain('value="5"');
        expect(src).toContain('5 minutes');
    });

    test('11. Backend schema default matches frontend (5 min)', () => {
        const src = readFile(path.join(backendSrc, 'utils/validation.ts'));
        expect(src).toMatch(/expiresInMinutes.*default\(5\)/);
    });
});

// ============================================
// 4. Lead Data (2 tests)
// ============================================

describe('Lead Data', () => {
    test('12. LeadSubmitForm has parameter fields with key-value inputs', () => {
        const src = readFile(path.join(frontendSrc, 'components/forms/LeadSubmitForm.tsx'));
        expect(src).toContain('parameters');
        expect(src).toContain('placeholder');
    });

    test('13. Vertical-specific data exists for known verticals', () => {
        const src = readFile(path.join(frontendSrc, 'components/forms/LeadSubmitForm.tsx'));
        expect(src).toContain('solar');
        expect(src).toContain('roofing');
        expect(src).toContain('mortgage');
    });
});

// ============================================
// 5. Role Guards (3 tests)
// ============================================

describe('Role Guards', () => {
    test('14. ProtectedRoute has requiredRole prop', () => {
        const src = readFile(path.join(frontendSrc, 'components/auth/ProtectedRoute.tsx'));
        expect(src).toContain("role?: 'BUYER' | 'SELLER' | 'ADMIN'");
        expect(src).toContain('RoleGate');
    });

    test('15. Seller routes use role="SELLER"', () => {
        const src = readFile(path.join(frontendSrc, 'App.tsx'));
        // All seller routes should have role="SELLER"
        const sellerRouteLines = src.split('\n').filter(l => l.includes('/seller') && l.includes('Route'));
        expect(sellerRouteLines.length).toBeGreaterThanOrEqual(7);
        sellerRouteLines.forEach(line => {
            expect(line).toContain('role="SELLER"');
        });
    });

    test('16. Buyer routes use role="BUYER"', () => {
        const src = readFile(path.join(frontendSrc, 'App.tsx'));
        // All buyer routes should have role="BUYER"
        const buyerRouteLines = src.split('\n').filter(l => l.includes('/buyer') && l.includes('Route'));
        expect(buyerRouteLines.length).toBeGreaterThanOrEqual(4);
        buyerRouteLines.forEach(line => {
            expect(line).toContain('role="BUYER"');
        });
    });
});
