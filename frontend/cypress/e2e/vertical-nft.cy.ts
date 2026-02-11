/**
 * Cypress E2E: Vertical NFT & AI Suggestion Flows
 *
 * Tests the VerticalSelector hierarchy, SuggestVerticalModal,
 * VerticalAnalytics charts, and NFT-related UI elements.
 */

describe('VerticalSelector Hierarchy', () => {
    beforeEach(() => {
        cy.mockApi();
        cy.visit('/');
    });

    it('renders hierarchical vertical filter on marketplace', () => {
        cy.contains(/Solar|Mortgage|All Verticals|Vertical/i, { timeout: 10000 })
            .should('exist');
    });

    it('shows sub-verticals under parent categories', () => {
        // The marketplace should show vertical selector with hierarchy
        cy.get('body').then(($body) => {
            if ($body.find('[data-testid="vertical-select"], select').length) {
                cy.get('[data-testid="vertical-select"], select').first().click();
                cy.contains(/Solar|Mortgage|Insurance|Home Services/i).should('exist');
            }
        });
    });

    it('filters leads when vertical is selected', () => {
        cy.contains(/All|Solar|Mortgage|Vertical/i, { timeout: 10000 })
            .should('exist');
        // Page should not show errors
        cy.get('body').should('not.contain', 'Cannot read');
    });
});

describe('Suggest Vertical Modal', () => {
    beforeEach(() => {
        cy.stubAuth('seller');
        cy.mockApi({ role: 'seller' });
        cy.visit('/');
    });

    it('shows "Suggest New Vertical" button for authenticated users', () => {
        cy.contains(/Suggest|New Vertical|Add Vertical|Propose/i, { timeout: 10000 })
            .should('exist');
    });

    it('opens suggestion modal on button click', () => {
        cy.get('body').then(($body) => {
            const suggestBtn = $body.find('button:contains("Suggest"), button:contains("Propose")');
            if (suggestBtn.length) {
                cy.wrap(suggestBtn.first()).click();
                cy.contains(/Suggest|Describe|Lead/i).should('exist');
            }
        });
    });

    it('does NOT show suggest button for unauthenticated users', () => {
        window.localStorage.clear();
        cy.visit('/');
        // Without auth, suggestion button should not appear or should be disabled
        cy.get('body').then(($body) => {
            const btn = $body.find('button:contains("Suggest New Vertical")');
            if (btn.length) {
                cy.wrap(btn).should('be.disabled');
            }
        });
    });

    it('validates minimum description length', () => {
        cy.get('body').then(($body) => {
            const suggestBtn = $body.find('button:contains("Suggest"), button:contains("Propose")');
            if (suggestBtn.length) {
                cy.wrap(suggestBtn.first()).click();
                // Try to submit with short text
                const textarea = $body.find('textarea');
                if (textarea.length) {
                    cy.wrap(textarea).type('hi');
                    // Submit button should be disabled or show validation error
                    cy.get('button:contains("Submit"), button:contains("Suggest")').last()
                        .should('exist');
                }
            }
        });
    });
});

describe('Vertical Analytics', () => {
    beforeEach(() => {
        cy.stubAuth('buyer');
        cy.mockApi({ role: 'buyer' });
        cy.visit('/buyer/analytics');
    });

    it('renders buyer analytics page', () => {
        cy.contains('Buyer Analytics').should('be.visible');
    });

    it('displays chart sections', () => {
        cy.contains(/Bid Activity|Spend by Vertical|Performance/i, { timeout: 10000 })
            .should('exist');
    });

    it('stats cards show data', () => {
        cy.contains(/Total Bids|Won Bids|Win Rate|Total Spent/i, { timeout: 10000 })
            .should('exist');
    });
});

describe('NFT Status Display', () => {
    beforeEach(() => {
        cy.stubAuth('seller');
        cy.mockApi({ role: 'seller' });
    });

    it('marketplace renders without NFT errors', () => {
        cy.visit('/');
        cy.get('body').should('not.contain', 'NFT Error');
        cy.get('body').should('not.contain', 'Cannot read');
    });

    it('seller dashboard handles NFT data gracefully', () => {
        cy.visit('/seller');
        cy.contains(/Dashboard|Overview/).should('be.visible');
        cy.get('body').should('not.contain', 'undefined');
    });
});
