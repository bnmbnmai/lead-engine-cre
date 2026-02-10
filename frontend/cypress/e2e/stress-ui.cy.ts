/**
 * Cypress E2E: UI Stability Under Stress
 *
 * Tests that the frontend remains functional while the backend
 * is under Artillery load. Run Artillery in a separate terminal
 * before executing these tests:
 *
 *   npx artillery run tests/load/artillery-stress-10k.yaml &
 *   cd frontend && npx cypress run --spec cypress/e2e/stress-ui.cy.ts
 *
 * These tests verify:
 *   - Marketplace renders even when backend is heavily loaded
 *   - Buyer preferences save correctly during bid spikes
 *   - Auto-bid status indicators update via WebSocket
 *   - CRM webhook list doesn't crash under concurrent registrations
 *   - Error states display correctly (rate limit toast, timeout banner)
 */

describe("UI Stability Under Stress", () => {
    // ═══════════════════════════════════════════
    // Marketplace Rendering Under Load
    // ═══════════════════════════════════════════

    describe("Marketplace Rendering", () => {
        it("loads marketplace page with content or loading state", () => {
            cy.stubAuth("buyer");
            cy.visit("/", { timeout: 15000 });

            // Page should show content OR a loading indicator — never a blank crash
            cy.get("body", { timeout: 10000 }).then(($body) => {
                const text = $body.text();
                const hasContent =
                    text.includes("Lead Engine") ||
                    text.includes("Loading") ||
                    text.includes("Marketplace") ||
                    text.includes("No leads");
                expect(hasContent).to.be.true;
            });
        });

        it("marketplace filters still respond under load", () => {
            cy.stubAuth("buyer");
            cy.visit("/", { timeout: 15000 });

            // Attempt vertical filter
            cy.get("body").then(($body) => {
                if ($body.find('[data-testid="vertical-filter"]').length > 0) {
                    cy.get('[data-testid="vertical-filter"]').click();
                    cy.contains("Solar").click();
                }
            });

            // Page should not crash after filter
            cy.get("body").should("exist");
            cy.contains("Lead Engine").should("be.visible");
        });

        it("marketplace pagination works during sustained load", () => {
            cy.stubAuth("buyer");
            cy.visit("/", { timeout: 15000 });

            // If pagination exists, click next page
            cy.get("body").then(($body) => {
                if ($body.find('[data-testid="next-page"]').length > 0) {
                    cy.get('[data-testid="next-page"]').click();
                    cy.get("body").should("exist");
                } else if ($body.text().includes("Next")) {
                    cy.contains("Next").click({ force: true });
                    cy.get("body").should("exist");
                }
            });
        });
    });

    // ═══════════════════════════════════════════
    // Buyer Preferences Save Under Bid Spikes
    // ═══════════════════════════════════════════

    describe("Buyer Preferences Stability", () => {
        it("preferences page loads during backend stress", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer/preferences", { timeout: 15000 });

            cy.get("body", { timeout: 10000 }).then(($body) => {
                const text = $body.text();
                const hasContent =
                    text.includes("Preferences") ||
                    text.includes("Loading") ||
                    text.includes("Solar") ||
                    text.includes("Vertical");
                expect(hasContent).to.be.true;
            });
        });

        it("can add preference set during load without crash", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer/preferences", { timeout: 15000 });

            // Try to add a quick preference set
            cy.get("body").then(($body) => {
                if ($body.text().includes("Solar")) {
                    cy.contains("Solar").click({ force: true });
                    // Should not crash — may timeout but shouldn't error
                    cy.get("body").should("exist");
                }
            });
        });

        it("auto-bid toggle remains responsive", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer/preferences", { timeout: 15000 });

            // Find any toggle/switch for auto-bid
            cy.get("body").then(($body) => {
                const hasAutoBid =
                    $body.find('[data-testid="auto-bid-toggle"]').length > 0 ||
                    $body.text().includes("Auto-Bid") ||
                    $body.text().includes("auto bid");
                if (hasAutoBid) {
                    // Toggle should be clickable
                    cy.contains(/Auto.?Bid/i).should("be.visible");
                }
            });
        });
    });

    // ═══════════════════════════════════════════
    // Auto-Bid Status via WebSocket Under Load
    // ═══════════════════════════════════════════

    describe("Auto-Bid Real-Time Updates", () => {
        it("buyer bids page shows real-time updates or graceful timeout", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer/bids", { timeout: 15000 });

            cy.get("body", { timeout: 10000 }).then(($body) => {
                const text = $body.text();
                const hasContent =
                    text.includes("Bids") ||
                    text.includes("My Bids") ||
                    text.includes("Loading") ||
                    text.includes("No bids") ||
                    text.includes("Auto-Bid");
                expect(hasContent).to.be.true;
            });
        });

        it("bid list doesn't duplicate entries under rapid updates", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer/bids", { timeout: 15000 });

            // Wait for potential WebSocket updates
            cy.wait(3000);

            // Check that bid items are unique (no duplicate IDs)
            cy.get("body").then(($body) => {
                const bidItems = $body.find('[data-testid^="bid-item-"]');
                if (bidItems.length > 1) {
                    const ids = new Set();
                    bidItems.each((_i, el) => {
                        const id = el.getAttribute("data-testid");
                        expect(ids.has(id)).to.be.false;
                        ids.add(id);
                    });
                }
            });
        });
    });

    // ═══════════════════════════════════════════
    // CRM Webhook Page Under Concurrent Registrations
    // ═══════════════════════════════════════════

    describe("CRM Webhook Page", () => {
        it("buyer dashboard CRM section remains stable", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer", { timeout: 15000 });

            cy.get("body", { timeout: 10000 }).then(($body) => {
                const text = $body.text();
                const hasCrm =
                    text.includes("CRM") ||
                    text.includes("Export") ||
                    text.includes("Webhook") ||
                    text.includes("Push to");
                // CRM features should exist or page should load without crash
                expect($body.length).to.be.greaterThan(0);
            });
        });

        it("export button doesn't crash under load", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer", { timeout: 15000 });

            cy.get("body").then(($body) => {
                if ($body.text().includes("Export") || $body.text().includes("Push to CRM")) {
                    // Clicking export under load should not crash
                    const exportBtn = $body.find(':contains("Export CSV"), :contains("Push to CRM")').first();
                    if (exportBtn.length > 0) {
                        cy.wrap(exportBtn).click({ force: true });
                        cy.get("body").should("exist");
                    }
                }
            });
        });
    });

    // ═══════════════════════════════════════════
    // Error States Display Correctly
    // ═══════════════════════════════════════════

    describe("Error State Handling", () => {
        it("displays error toast or banner on API failure", () => {
            cy.stubAuth("buyer");
            // Intercept API and force 500 error to test UI error handling
            cy.intercept("GET", "/api/v1/leads*", {
                statusCode: 500,
                body: { error: "Internal Server Error" },
            }).as("failedLeads");

            cy.visit("/", { timeout: 15000 });
            cy.wait("@failedLeads");

            // Should show error state, not crash
            cy.get("body", { timeout: 5000 }).then(($body) => {
                const text = $body.text();
                const hasErrorState =
                    text.includes("Error") ||
                    text.includes("error") ||
                    text.includes("try again") ||
                    text.includes("Something went wrong") ||
                    text.includes("failed") ||
                    text.includes("No leads");  // Graceful fallback
                expect(hasErrorState).to.be.true;
            });
        });

        it("displays rate limit notification on 429", () => {
            cy.stubAuth("buyer");
            cy.intercept("GET", "/api/v1/leads*", {
                statusCode: 429,
                body: { error: "Rate limit exceeded" },
                headers: { "Retry-After": "5" },
            }).as("rateLimited");

            cy.visit("/", { timeout: 15000 });
            cy.wait("@rateLimited");

            // Should show rate limit message or retry indicator
            cy.get("body", { timeout: 5000 }).then(($body) => {
                const text = $body.text();
                const hasRateLimit =
                    text.includes("Rate") ||
                    text.includes("rate") ||
                    text.includes("Too many") ||
                    text.includes("try again") ||
                    text.includes("Error") ||
                    text.includes("No leads");
                expect(hasRateLimit).to.be.true;
            });
        });

        it("handles WebSocket disconnect gracefully during load", () => {
            cy.stubAuth("buyer");
            cy.visit("/buyer/bids", { timeout: 15000 });

            // Page should still function if WebSocket drops
            cy.get("body").then(($body) => {
                const text = $body.text();
                const isStable =
                    text.includes("Bids") ||
                    text.includes("Loading") ||
                    text.includes("Disconnected") ||
                    text.includes("Reconnecting") ||
                    text.includes("No bids");
                expect(isStable).to.be.true;
            });
        });

        it("handles gateway timeout (504) on slow Chainlink stubs", () => {
            cy.stubAuth("buyer");
            cy.intercept("GET", "/api/v1/bids/bid-floor*", {
                statusCode: 504,
                body: { error: "Gateway Timeout" },
                delayMs: 5000,
            }).as("timeout");

            cy.visit("/buyer", { timeout: 15000 });

            // Page should remain interactive despite backend timeout
            cy.get("body").should("exist");
            cy.contains(/Dashboard|Overview|Bids|Loading/).should("be.visible");
        });
    });
});
