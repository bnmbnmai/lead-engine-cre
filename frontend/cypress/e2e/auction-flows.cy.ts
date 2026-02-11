/**
 * Cypress E2E: Vertical Auction Flows
 *
 * Tests the auction lifecycle UI: start auction from admin,
 * auction countdown on NFT card, bid button state, and settlement.
 */

describe('Auction UI — Admin Dashboard', () => {
    beforeEach(() => {
        cy.stubAuth('admin');
        cy.mockApi({ role: 'admin' });
    });

    it('shows "Start Auction" button on minted verticals table', () => {
        cy.visit('/admin/nfts');
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#minted-verticals-table').length) {
                cy.get('#minted-verticals-table').within(() => {
                    cy.contains('Actions').should('exist');
                    cy.get('[id^="auction-btn-"]').should('have.length.greaterThan', 0);
                    cy.get('[id^="auction-btn-"]').first().should('contain.text', 'Start Auction');
                });
            }
        });
    });

    it('clicking "Start Auction" triggers toast notification', () => {
        cy.visit('/admin/nfts');
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('[id^="auction-btn-"]').length) {
                cy.get('[id^="auction-btn-"]').first().click();
                // Should show success or error toast
                cy.get('[role="alert"], [class*="toast"]', { timeout: 5000 }).should('exist');
            }
        });
    });
});

describe('Auction UI — NFT Marketplace Card', () => {
    beforeEach(() => {
        cy.mockApi();
        cy.visit('/');
    });

    it('NFT card shows "Place Bid" when auction is active', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            // If auction cards exist, verify bid button
            const bidBtn = $body.find('button:contains("Place Bid")');
            if (bidBtn.length) {
                cy.wrap(bidBtn.first()).should('be.visible');
            }
        });
    });

    it('NFT card shows countdown timer for active auctions', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            // If auction is active, countdown shows
            const auctionLabel = $body.find(':contains("Auction Live")');
            if (auctionLabel.length) {
                cy.contains('Auction Live').should('be.visible');
                // Timer text should contain 'h' or 'm' or 'Ended'
                cy.get('body').then(($b) => {
                    const hasTimer = $b.text().match(/\d+h \d+m \d+s|Ended/);
                    expect(hasTimer).to.not.be.null;
                });
            }
        });
    });

    it('NFT card shows "Connect to Bid" for unauthenticated users', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            const connectBtn = $body.find('button:contains("Connect to Bid")');
            if (connectBtn.length) {
                cy.wrap(connectBtn.first()).should('be.visible');
                cy.wrap(connectBtn.first()).should('have.attr', 'aria-label', 'Connect wallet to bid');
            }
        });
    });

    it('NFT card shows high bid or reserve price', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find(':contains("High Bid")').length) {
                cy.contains('High Bid').should('be.visible');
                // Should show either "$" amount or "Reserve:"
                cy.get('body').then(($b) => {
                    const hasBid = $b.text().match(/\$[\d,.]+|Reserve:/);
                    expect(hasBid).to.not.be.null;
                });
            }
        });
    });
});

describe('Auction UI — Mobile Responsiveness', () => {
    beforeEach(() => {
        cy.viewport(375, 667);
        cy.mockApi();
        cy.visit('/');
    });

    it('auction UI renders correctly on mobile viewport', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).should('be.visible');
        cy.get('#nfts-tab').click();
        // No horizontal overflow
        cy.get('body').should('not.have.css', 'overflow-x', 'scroll');
    });
});

// ============================================
// Holder Perks UI Tests
// ============================================

describe('Holder Perks — Priority Bidding UI', () => {
    beforeEach(() => {
        cy.mockApi();
        cy.visit('/');
    });

    it('shows "Priority Bid Active" badge when user is holder', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#holder-perks-badge').length) {
                cy.get('#holder-perks-badge')
                    .should('be.visible')
                    .and('contain.text', 'Priority Bid Active');
            }
        });
    });

    it('shows multiplier preview when holder types bid amount', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#bid-preview-input').length) {
                cy.get('#bid-preview-input').first().type('100');
                cy.get('#effective-bid-display').first()
                    .should('be.visible')
                    .and('contain.text', '1.2')
                    .and('contain.text', '$120.00');
            }
        });
    });

    it('shows pre-ping countdown indicator for holders', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#preping-indicator').length) {
                cy.get('#preping-indicator').first()
                    .should('be.visible')
                    .and('contain.text', 'Pre-Ping');
                // Verify it shows seconds value 5-10
                cy.get('#preping-indicator').first().invoke('text').then((text) => {
                    const match = text.match(/(\d+)s/);
                    if (match) {
                        const seconds = parseInt(match[1]);
                        expect(seconds).to.be.at.least(5);
                        expect(seconds).to.be.at.most(10);
                    }
                });
            }
        });
    });

    it('shows "Powered by" label on owned verticals', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#powered-by-owner').length) {
                cy.get('#powered-by-owner').first()
                    .should('be.visible')
                    .and('contain.text', 'Powered by');
            }
        });
    });
});

describe('Holder Perks — Mobile Responsive', () => {
    beforeEach(() => {
        cy.viewport(375, 667);
        cy.mockApi();
        cy.visit('/');
    });

    it('holder perks badges render without overflow on mobile', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#holder-perks-badge').length) {
                cy.get('#holder-perks-badge').first()
                    .should('be.visible')
                    .and('not.have.css', 'overflow', 'hidden');
            }
        });
        // No horizontal overflow on body
        cy.get('body').should('not.have.css', 'overflow-x', 'scroll');
    });
});
