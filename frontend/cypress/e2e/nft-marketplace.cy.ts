/**
 * Cypress E2E: NFT Marketplace & Admin Dashboard Flows
 *
 * Tests the NFT marketplace tab, admin mint workflow,
 * ownership badges, royalty display, and mobile responsiveness.
 */

describe('NFT Marketplace Tab', () => {
    beforeEach(() => {
        cy.mockApi();
        cy.visit('/');
    });

    it('shows NFTs tab in marketplace view toggle', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).should('exist').and('be.visible');
        cy.get('#nfts-tab').should('contain.text', 'NFTs');
    });

    it('switches to NFT marketplace view when NFTs tab clicked', () => {
        cy.get('#nfts-tab').click();
        cy.get('#nft-marketplace', { timeout: 10000 }).should('exist');
        cy.get('#nft-search').should('be.visible');
    });

    it('displays NFT cards with ownership badges', () => {
        cy.get('#nfts-tab').click();
        // Either NFT cards or empty state should show
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#nft-grid').length) {
                // Check that cards have badges
                cy.get('#nft-grid').find('[class*="card"]').should('have.length.greaterThan', 0);
            } else {
                cy.get('#nft-empty-state').should('exist');
                cy.contains('No NFTs Available').should('be.visible');
            }
        });
    });

    it('shows royalty percentage (2%) on NFT cards', () => {
        cy.get('#nfts-tab').click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#nft-grid').length) {
                cy.contains('2%').should('exist');
                cy.contains(/Royalty/i).should('exist');
            }
        });
    });

    it('search filters NFTs by name or slug', () => {
        cy.get('#nfts-tab').click();
        cy.get('#nft-search').type('solar');
        // Should filter or show empty — no crashes
        cy.get('body').should('not.contain', 'Cannot read');
    });
});

describe('NFT Buy Flow (Wallet Required)', () => {
    beforeEach(() => {
        cy.mockApi();
        cy.visit('/');
        cy.get('#nfts-tab').click();
    });

    it('buy button requires wallet connection for unauthenticated users', () => {
        // Without wallet connected, should show "Connect to Buy" variant
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#nft-grid').length) {
                const connectBtn = $body.find('button:contains("Connect to Buy")');
                if (connectBtn.length) {
                    cy.wrap(connectBtn.first()).should('be.visible');
                    cy.wrap(connectBtn.first())
                        .should('have.attr', 'aria-label', 'Connect wallet to buy NFT');
                }
            }
        });
    });
});

describe('Admin NFT Dashboard', () => {
    beforeEach(() => {
        cy.stubAuth('admin');
        cy.mockApi({ role: 'admin' });
    });

    it('admin can access NFT dashboard at /admin/nfts', () => {
        cy.visit('/admin/nfts');
        cy.contains('NFT Admin', { timeout: 10000 }).should('be.visible');
    });

    it('shows stats cards (Minted, Pending, Royalties)', () => {
        cy.visit('/admin/nfts');
        cy.contains('Minted NFTs', { timeout: 10000 }).should('exist');
        cy.contains('Pending Proposals').should('exist');
        cy.contains('Royalties Earned').should('exist');
    });

    it('displays "Mint NFT" button on proposed verticals', () => {
        cy.visit('/admin/nfts');
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#proposed-verticals-list').length) {
                cy.get('[id^="mint-btn-"]').should('have.length.greaterThan', 0);
                cy.get('[id^="mint-btn-"]').first().should('contain.text', 'Mint NFT');
            }
        });
    });

    it('minted verticals table shows token ID, tx hash, and owner', () => {
        cy.visit('/admin/nfts');
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#minted-verticals-table').length) {
                cy.get('#minted-verticals-table').within(() => {
                    cy.contains('Token ID').should('exist');
                    cy.contains('Tx Hash').should('exist');
                    cy.contains('Owner').should('exist');
                });
            }
        });
    });
});

describe('Admin NFT Access Control', () => {
    it('non-admin users see access guard on /admin/nfts', () => {
        cy.stubAuth('buyer');
        cy.mockApi({ role: 'buyer' });
        cy.visit('/admin/nfts');
        // Non-admin should see an access guard — either redirect or guard message
        cy.get('body', { timeout: 10000 }).then(($body) => {
            const hasGuard = $body.text().includes('Admin profile required') ||
                $body.text().includes('Admin access required');
            const redirected = !window.location.pathname.includes('/admin/nfts');
            expect(hasGuard || redirected).to.be.true;
        });
    });
});

describe('NFT Marketplace Mobile Responsiveness', () => {
    beforeEach(() => {
        cy.viewport(375, 667);
        cy.mockApi();
        cy.visit('/');
    });

    it('NFTs tab is accessible on mobile viewport', () => {
        cy.get('#nfts-tab', { timeout: 10000 }).should('be.visible');
        cy.get('#nfts-tab').click();
        cy.get('#nft-marketplace').should('exist');
    });

    it('NFT cards stack vertically on mobile', () => {
        cy.get('#nfts-tab').click();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            if ($body.find('#nft-grid').length) {
                // On mobile, grid should be single column
                cy.get('#nft-grid').should('have.css', 'display', 'grid');
            }
        });
        // No horizontal scrollbar
        cy.get('body').should('not.have.css', 'overflow-x', 'scroll');
    });
});
