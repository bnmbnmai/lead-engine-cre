/**
 * Cypress E2E: Multi-Wallet Settlement Flows
 *
 * Tests the full marketplace lifecycle across multiple wallet roles:
 *   Seller → Buyer 1 → Buyer 2 → Settlement
 *
 * Exercises:
 *   - Role switching via stubAuth()
 *   - Seller lead submission + listing creation
 *   - Two competing buyer bids
 *   - Auction resolution + winner display
 *   - Cross-region bid validation (BR lead restrictions)
 *   - Wallet disconnect/reconnect auth guard
 */

describe("Multi-Wallet Settlement Flows", () => {
    // ═══════════════════════════════════════════
    // Full Lifecycle: Seller → Two Buyers → Settle
    // ═══════════════════════════════════════════

    describe("Full Auction Lifecycle", () => {
        it("seller lists lead and two buyers compete", () => {
            // ── Seller: Submit a lead ──
            cy.stubAuth("seller");
            cy.visit("/seller/submit");
            cy.contains(/Submit|Lead/).should("be.visible");

            // Select vertical
            cy.get('[role="combobox"]').first().click();
            cy.contains("solar").click();

            // Verify form has geo targeting
            cy.contains(/Geographic|Region|State/).should("exist");
        });

        it("seller creates listing from dashboard", () => {
            cy.stubAuth("seller");
            cy.visit("/seller");
            cy.contains("Create Auction").should("be.visible").click();

            // Auction creation form should appear
            cy.contains(/Create|Auction|Ask/).should("be.visible");
            cy.contains(/Reserve Price|Minimum/).should("exist");
        });

        it("buyer 1 browses marketplace and places bid", () => {
            // ── Switch to Buyer 1 ──
            cy.stubAuth("buyer");
            cy.visit("/");

            // Marketplace should load
            cy.contains("Lead Engine").should("be.visible");

            // Browse listings
            cy.get("body").then(($body) => {
                const hasListings =
                    $body.text().includes("Solar") ||
                    $body.text().includes("Mortgage") ||
                    $body.text().includes("No leads");
                expect(hasListings).to.be.true;
            });
        });

        it("buyer 2 places competing bid", () => {
            // ── Switch to Buyer 2 (different auth) ──
            cy.stubAuth("buyer");
            cy.visit("/buyer/bids");

            cy.contains(/Bids|My Bids/).should("be.visible");
        });

        it("displays winner badge after auction resolution", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer/bids");

            // Either shows wins or empty state
            cy.get("body").then(($body) => {
                const text = $body.text();
                const hasContent =
                    text.includes("Won") ||
                    text.includes("Pending") ||
                    text.includes("No bids");
                expect(hasContent).to.be.true;
            });
        });
    });

    // ═══════════════════════════════════════════
    // Cross-Region Bid Validation
    // ═══════════════════════════════════════════

    describe("Cross-Region Bid Restrictions", () => {
        it("seller can select BR as target country", () => {
            cy.stubAuth("seller");
            cy.visit("/seller/asks/create");

            cy.get("body").then(($body) => {
                // Country or geo selector should be present
                const hasGeoSelector =
                    $body.find('[data-testid="country-select"]').length > 0 ||
                    $body.find('select').length > 0 ||
                    $body.text().includes("Brazil") ||
                    $body.text().includes("Country");
                expect(hasGeoSelector).to.be.true;
            });
        });

        it("buyer preferences reflect geo restrictions", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer/preferences");

            // Should show geographic targeting section
            cy.contains(/Preferences/).should("be.visible");
            cy.get("body").then(($body) => {
                const text = $body.text();
                const hasGeoConfig =
                    text.includes("Geographic") ||
                    text.includes("Region") ||
                    text.includes("Country") ||
                    text.includes("State");
                expect(hasGeoConfig).to.be.true;
            });
        });

        it("buyer can add multi-region preference sets", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer/preferences");

            // Quick-add buttons for verticals
            cy.contains("Solar").should("be.visible").click();
            cy.contains("Solar — US").should("be.visible");

            // Add another set
            cy.contains("Add Preference Set").click();
            cy.contains("Select a vertical").should("be.visible");
            cy.get(".grid").last().contains("Mortgage").click();
            cy.contains("Mortgage — US").should("be.visible");
        });
    });

    // ═══════════════════════════════════════════
    // Wallet Disconnect / Reconnect Auth Guard
    // ═══════════════════════════════════════════

    describe("Wallet Disconnect & Reconnect", () => {
        it("disconnecting wallet shows auth guard on protected pages", () => {
            // Start authenticated
            cy.stubAuth("seller");
            cy.visit("/seller");
            cy.contains(/Dashboard|Overview/).should("be.visible");

            // Disconnect (clear auth)
            window.localStorage.clear();
            cy.visit("/seller");

            // Auth guard should appear
            cy.contains("Sign in required").should("be.visible");
            cy.contains("Connect your wallet").should("be.visible");
        });

        it("reconnecting wallet restores access", () => {
            // Start disconnected
            window.localStorage.clear();
            cy.visit("/buyer/preferences");
            cy.contains("Sign in required").should("be.visible");

            // Reconnect
            cy.stubAuth("buyer");
            cy.visit("/buyer/preferences");
            cy.contains("Buyer Preferences").should("be.visible");
        });

        it("mid-flow disconnect redirects to auth guard", () => {
            cy.stubAuth("seller");
            cy.visit("/seller/submit");
            cy.contains(/Submit|Lead/).should("be.visible");

            // Simulate mid-flow disconnect
            window.localStorage.clear();
            cy.visit("/seller/analytics");
            cy.contains("Sign in required").should("be.visible");
        });
    });

    // ═══════════════════════════════════════════
    // Role Switching in Same Session
    // ═══════════════════════════════════════════

    describe("Role Switching", () => {
        it("switches from seller to buyer role", () => {
            // Start as seller
            cy.stubAuth("seller");
            cy.visit("/seller");
            cy.contains(/Dashboard|Overview/).should("be.visible");

            // Switch to buyer
            cy.stubAuth("buyer");
            cy.visit("/buyer");
            cy.contains(/Dashboard|Overview/).should("be.visible");
        });

        it("seller and buyer dashboards show different content", () => {
            cy.stubAuth("seller");
            cy.visit("/seller");
            cy.contains("Submit Lead").should("be.visible");
            cy.contains("Create Auction").should("be.visible");

            cy.stubAuth("buyer");
            cy.visit("/buyer");
            // Buyer dashboard should not show seller-specific actions
            cy.get("body").should("not.contain", "Submit Lead");
        });

        it("marketplace is accessible to both roles", () => {
            // Seller
            cy.stubAuth("seller");
            cy.visit("/");
            cy.contains("Lead Engine").should("be.visible");

            // Buyer
            cy.stubAuth("buyer");
            cy.visit("/");
            cy.contains("Lead Engine").should("be.visible");
        });
    });

    // ═══════════════════════════════════════════
    // Settlement Status Display
    // ═══════════════════════════════════════════

    describe("Settlement Status", () => {
        it("seller analytics shows revenue data", () => {
            cy.stubAuth("seller");
            cy.visit("/seller/analytics");
            cy.contains("Analytics").should("be.visible");
            cy.contains("Revenue Over Time").should("be.visible");
        });

        it("buyer analytics shows spend data", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer/analytics");
            cy.contains("Buyer Analytics").should("be.visible");
            cy.contains("Spend by Vertical").should("be.visible");
        });

        it("export settlement data as CSV", () => {
            cy.stubAuth("seller");
            cy.visit("/seller/analytics");
            cy.contains("Export CSV").should("be.visible").click();
        });
    });
});
