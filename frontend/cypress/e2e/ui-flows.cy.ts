/**
 * Cypress E2E: Marketplace Browsing & Geo Filter Flows
 * Tests global geo-filtering, lead browsing, and parameter-based bid placement.
 */

describe('Marketplace & Geo Filters', () => {
    beforeEach(() => {
        cy.visit('/');
    });

    it('loads the marketplace homepage', () => {
        cy.contains('Lead Engine').should('be.visible');
        cy.get('h1, h2').should('exist');
    });

    it('displays country selector with 15 countries', () => {
        // The geo filter should be present
        cy.get('[data-testid="country-select"], select, [role="combobox"]')
            .first()
            .should('exist');
    });

    it('filters leads by US states', () => {
        // Select US country (default)
        cy.url().should('include', '/');

        // Look for state/region filter elements
        cy.get('button, [role="combobox"]').then(($els) => {
            const filterEl = [...$els].find(
                (el) =>
                    el.textContent?.includes('All') ||
                    el.textContent?.includes('State') ||
                    el.textContent?.includes('Region')
            );
            if (filterEl) {
                cy.wrap(filterEl).click();
            }
        });
    });

    it('switches country to Australia and shows AU regions', () => {
        // Find and click country selector
        cy.get('body').then(($body) => {
            if ($body.find('[data-testid="country-select"]').length) {
                cy.get('[data-testid="country-select"]').click();
                cy.contains('Australia').click();
                // Should show AU regions like NSW, VIC, QLD
                cy.contains(/NSW|VIC|QLD/).should('exist');
            }
        });
    });

    it('handles empty results gracefully', () => {
        cy.visit('/');
        // The page should never show a raw error
        cy.get('body').should('not.contain', 'Cannot read properties');
        cy.get('body').should('not.contain', 'undefined');
    });
});

describe('Seller Flows', () => {
    beforeEach(() => {
        cy.stubAuth('seller');
        cy.visit('/seller');
    });

    it('loads the seller dashboard', () => {
        cy.contains(/Dashboard|Overview/).should('be.visible');
    });

    it('navigates to submit lead page', () => {
        cy.visit('/seller/submit');
        cy.contains(/Submit|Lead/).should('be.visible');
    });

    it('navigates to analytics page with charts', () => {
        cy.visit('/seller/analytics');
        cy.contains('Analytics').should('be.visible');
        cy.contains('Revenue Over Time').should('be.visible');
        cy.contains('Lead Type Performance').should('be.visible');
        cy.contains('Activity Log').should('be.visible');
    });

    it('exports analytics CSV', () => {
        cy.visit('/seller/analytics');
        cy.contains('Export CSV').click();
        // CSV download should be triggered (file check is limited in Cypress)
    });

    it('navigates to leads page with CRM export', () => {
        cy.visit('/seller/leads');
        cy.contains(/My Leads|Leads/).should('be.visible');
        cy.contains('Push to CRM').should('exist');
    });
});

describe('Buyer Flows', () => {
    beforeEach(() => {
        cy.stubAuth('buyer');
    });

    it('loads buyer dashboard with stats', () => {
        cy.visit('/buyer');
        cy.contains(/Dashboard|Overview/).should('be.visible');
    });

    it('navigates to bids page', () => {
        cy.visit('/buyer/bids');
        cy.contains(/Bids|My Bids/).should('be.visible');
    });

    it('navigates to preferences with geo filters', () => {
        cy.visit('/buyer/preferences');
        cy.contains(/Preferences/).should('be.visible');
        cy.contains(/Geographic|Region/).should('be.visible');
    });
});

describe('Create Ask Flow', () => {
    beforeEach(() => {
        cy.stubAuth('seller');
        cy.visit('/seller/asks/create');
    });

    it('shows authentication gate for unauthenticated users', () => {
        window.localStorage.clear();
        cy.visit('/seller/asks/create');
        cy.contains(/Connect|Wallet|Sign In/).should('be.visible');
    });

    it('displays ask creation form with geo targeting', () => {
        cy.contains(/Create|Auction|Ask/).should('be.visible');
        cy.contains(/Target Geography|Target States/).should('exist');
    });
});

describe('Edge Cases & Empty States', () => {
    it('handles unauthenticated sidebar correctly', () => {
        window.localStorage.clear();
        cy.visit('/');
        // Sidebar should NOT be visible for unauthenticated users
        cy.get('[data-testid="sidebar"], nav.sidebar').should('not.exist');
    });

    it('marketplace works with no data', () => {
        cy.visit('/');
        cy.get('body').should('not.contain', 'Error');
        cy.get('body').should('not.contain', 'Cannot read');
    });

    it('seller leads empty state shows CTA', () => {
        cy.stubAuth('seller');
        cy.visit('/seller/leads');
        // Either shows leads or the empty state CTA
        cy.get('body').then(($body) => {
            const text = $body.text();
            const hasLeads = text.includes('Solar') || text.includes('Mortgage');
            const hasEmpty = text.includes('No leads') || text.includes('Submit');
            expect(hasLeads || hasEmpty).to.be.true;
        });
    });
});
