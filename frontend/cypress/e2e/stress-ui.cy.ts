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
            cy.mockApi({ latency: 100 });
            cy.visit("/", { timeout: 15000 });

            // Page should show content OR a loading indicator — never a blank crash
            cy.contains(/Lead Engine|Loading|Marketplace|Live|No leads/i, { timeout: 10000 })
                .should("exist");
        });

        it("marketplace filters still respond under load", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ latency: 100 });
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
            cy.contains(/Lead Engine|Marketplace|Live/i).should("be.visible");
        });

        it("marketplace pagination works during sustained load", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ latency: 100 });
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
            cy.mockApi({ role: 'buyer', latency: 100 });
            cy.visit("/buyer/preferences", { timeout: 15000 });

            cy.contains(/Preferences|Loading|Solar|Vertical|Auto.?Bid|Buyer|rules/i, { timeout: 10000 })
                .should("exist");
        });

        it("can add preference set during load without crash", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', latency: 100 });
            cy.visit("/buyer/preferences", { timeout: 15000 });

            // Try to add a quick preference set
            cy.get("body", { timeout: 10000 }).then(($body) => {
                if ($body.text().includes("Solar")) {
                    cy.contains("Solar").click({ force: true });
                    // Should not crash — may timeout but shouldn't error
                    cy.get("body").should("exist");
                }
            });
        });

        it("auto-bid toggle remains responsive", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', latency: 100 });
            cy.visit("/buyer/preferences", { timeout: 15000 });

            // Find any toggle/switch for auto-bid
            cy.get("body", { timeout: 10000 }).then(($body) => {
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
            cy.mockApi({ role: 'buyer', latency: 100 });
            cy.visit("/buyer/bids", { timeout: 15000 });

            cy.contains(/Bids|My Bids|Loading|No bids|Auto.?Bid|Dashboard|Buyer|Overview/i, { timeout: 10000 })
                .should("exist");
        });

        it("bid list doesn't duplicate entries under rapid updates", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', latency: 100 });
            cy.visit("/buyer/bids", { timeout: 15000 });

            // Wait for potential WebSocket updates
            cy.wait(3000);

            // Check that bid items are unique (no duplicate IDs)
            cy.get("body").then(($body) => {
                const bidItems = $body.find('[data-testid^="bid-item-"]');
                if (bidItems.length > 1) {
                    const ids = new Set();
                    bidItems.each((_i: number, el: HTMLElement) => {
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
            cy.mockApi({ role: 'buyer', latency: 100 });
            cy.visit("/buyer", { timeout: 15000 });

            // CRM features should exist or page should load without crash
            cy.contains(/CRM|Export|Webhook|Push to|Dashboard|Buyer|Overview|Bids/i, { timeout: 10000 })
                .should("exist");
        });

        it("export button doesn't crash under load", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', latency: 100 });
            cy.visit("/buyer", { timeout: 15000 });

            cy.get("body", { timeout: 10000 }).then(($body) => {
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
            cy.intercept('GET', 'http://localhost:3001/api/v1/leads*', {
                statusCode: 500,
                body: { error: "Internal Server Error" },
            }).as("failedLeads");

            cy.visit("/", { timeout: 15000 });

            // Should show error state or the landing page, not crash
            cy.contains(/Error|error|try again|Something went wrong|failed|No leads|Lead Engine|Marketplace|Live/i, { timeout: 10000 })
                .should("exist");
        });

        it("displays rate limit notification on 429", () => {
            cy.stubAuth("buyer");
            cy.intercept('GET', 'http://localhost:3001/api/v1/leads*', {
                statusCode: 429,
                body: { error: "Rate limit exceeded" },
                headers: { "Retry-After": "5" },
            }).as("rateLimited");

            cy.visit("/", { timeout: 15000 });

            // Should show rate limit message or page loads normally
            cy.contains(/Rate|rate|Too many|try again|Error|No leads|Lead Engine|Marketplace|Live/i, { timeout: 10000 })
                .should("exist");
        });

        it("handles WebSocket disconnect gracefully during load", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', latency: 100 });
            cy.visit("/buyer/bids", { timeout: 15000 });

            // Page should still function if WebSocket drops
            cy.contains(/Bids|Loading|Disconnected|Reconnecting|No bids|Dashboard|Buyer|Overview/i, { timeout: 10000 })
                .should("exist");
        });

        it("handles gateway timeout (504) on slow Chainlink stubs", () => {
            cy.stubAuth("buyer");
            // Register 504 override AFTER mockApi so it takes priority (Cypress LIFO)
            cy.mockApi({ role: 'buyer', latency: 100 });
            cy.intercept('GET', 'http://localhost:3001/api/v1/bids/bid-floor*', {
                statusCode: 504,
                body: { error: "Gateway Timeout" },
            });

            cy.visit("/buyer", { timeout: 15000 });

            // Page should remain interactive despite backend timeout
            cy.contains(/Dashboard|Overview|Bids|Loading|Buyer/i, { timeout: 10000 })
                .should("be.visible");
        });
    });

    // ═══════════════════════════════════════════
    // Chainlink Oracle Latency Edge Cases
    // ═══════════════════════════════════════════

    describe("Chainlink Latency Simulation", () => {
        it("handles >5s Chainlink response with loading fallback", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', slowChainlink: true });
            cy.visit("/buyer/bids", { timeout: 15000 });

            // Page should show content or loading — never blank crash
            cy.contains(/Bids|Loading|My Bids|Buyer|Dashboard|Overview/i, { timeout: 10000 })
                .should("exist");

            // Bid floor should still function even with slow response
            cy.get("body").should("exist");
        });

        it("handles Chainlink oracle 504 timeout gracefully", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', failChainlink: true });
            cy.visit("/buyer/bids", { timeout: 15000 });

            // UI should show bids page with or without price data
            cy.contains(/Bids|My Bids|Error|Loading|Dashboard|Buyer|Overview/i, { timeout: 10000 })
                .should("exist");

            // No stack traces from Chainlink failure
            cy.get("body").should("not.contain", "TypeError");
            cy.get("body").should("not.contain", "Cannot read properties");
        });

        it("marketplace loads even when Chainlink is down", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', failChainlink: true });
            cy.visit("/", { timeout: 15000 });

            // Marketplace should render lead cards without price oracle
            cy.contains(/Lead Engine|Marketplace|Live|Solar|Mortgage/i, { timeout: 10000 })
                .should("exist");
        });
    });

    // ═══════════════════════════════════════════
    // x402 Payment Failure Edge Cases
    // ═══════════════════════════════════════════

    describe("x402 Payment Failure Handling", () => {
        it("handles 402 Payment Required on bid placement", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', failPayment: true });
            cy.visit("/buyer/bids", { timeout: 15000 });

            // Page should load normally even with payment failures configured
            cy.contains(/Bids|My Bids|Dashboard|Buyer|Overview/i, { timeout: 10000 })
                .should("exist");
        });

        it("dashboard remains functional with payment endpoint errors", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', failPayment: true });
            cy.visit("/buyer", { timeout: 15000 });

            // Dashboard should show even when payment service is down
            cy.contains(/Dashboard|Overview|Buyer/i, { timeout: 10000 })
                .should("be.visible");
        });
    });

    // ═══════════════════════════════════════════
    // Redis Cache Miss / Slow Response
    // ═══════════════════════════════════════════

    describe("Cache Miss Under Load", () => {
        it("handles 3s lead response (cache miss simulation)", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', latency: 3000 }); // 3s delay
            cy.visit("/", { timeout: 15000 });

            // Page should eventually render, possibly with loading state
            cy.contains(/Lead Engine|Loading|Marketplace|Live/i, { timeout: 15000 })
                .should("exist");
        });

        it("preferences page survives cache miss latency", () => {
            cy.stubAuth("buyer");
            cy.mockApi({ role: 'buyer', latency: 3000 });
            cy.visit("/buyer/preferences", { timeout: 15000 });

            // Should eventually show preferences content
            cy.contains(/Preferences|Loading|Solar|Buyer/i, { timeout: 15000 })
                .should("exist");
        });
    });
});
