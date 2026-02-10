/**
 * Cypress E2E: Copy & Content Assertions
 *
 * Verifies that updated marketing copy, market stats, and
 * onboarding tooltips render correctly across key pages.
 */

describe("Homepage Copy — Landing Hero", () => {
    beforeEach(() => {
        cy.visit("/", { timeout: 15000 });
    });

    it("displays $200B+ market size in hero subtext", () => {
        cy.contains("$200B+").should("be.visible");
    });

    it("shows 20+ countries stat", () => {
        cy.contains("20+").should("exist");
    });

    it("shows 10 verticals stat", () => {
        cy.contains("10").should("exist");
    });

    it("features section mentions 20+ Global Markets", () => {
        cy.contains("20+ Global Markets").should("be.visible");
    });

    it("features mention Auto-Bid + ZK Privacy", () => {
        cy.contains("Auto-Bid + ZK Privacy").should("be.visible");
    });

    it("How It Works step shows Instant Settlement", () => {
        cy.contains("Instant Settlement").should("be.visible");
    });

    it("How It Works mentions x402 USDC escrow", () => {
        cy.contains("x402 USDC escrow").should("be.visible");
    });

    it("bottom CTA mentions 20+ markets", () => {
        cy.contains("20+ markets").should("be.visible");
    });

    it("bottom CTA mentions auto-bid while you sleep", () => {
        cy.contains("Auto-bid on leads while you sleep").should("be.visible");
    });
});

describe("Buyer Preferences — Copy & Tooltips", () => {
    beforeEach(() => {
        cy.stubAuth("buyer");
        cy.visit("/buyer/preferences", { timeout: 15000 });
    });

    it("displays updated subtitle with auto-bid value prop", () => {
        cy.contains("auto-bid fires instantly").should("be.visible");
    });

    it("shows onboarding tooltip on first visit", () => {
        // Clear any previous dismissal
        cy.window().then((win) => {
            win.localStorage.removeItem("le_prefs_tip_dismissed");
        });
        cy.reload();
        cy.get('[data-testid="onboarding-tooltip"]').should("be.visible");
        cy.contains("Getting started with auto-bid").should("be.visible");
    });

    it("onboarding tooltip mentions daily budgets", () => {
        cy.window().then((win) => {
            win.localStorage.removeItem("le_prefs_tip_dismissed");
        });
        cy.reload();
        cy.contains("daily budgets").should("be.visible");
    });

    it("onboarding tooltip mentions quality gates", () => {
        cy.window().then((win) => {
            win.localStorage.removeItem("le_prefs_tip_dismissed");
        });
        cy.reload();
        cy.contains("quality gates").should("be.visible");
    });

    it("tooltip can be dismissed and stays dismissed", () => {
        cy.window().then((win) => {
            win.localStorage.removeItem("le_prefs_tip_dismissed");
        });
        cy.reload();
        cy.get('[data-testid="onboarding-tooltip"]').should("be.visible");

        // Dismiss it
        cy.get('[data-testid="onboarding-tooltip"]').find("button").click();
        cy.get('[data-testid="onboarding-tooltip"]').should("not.exist");

        // Reload — should stay dismissed
        cy.reload();
        cy.get('[data-testid="onboarding-tooltip"]').should("not.exist");
    });

    it("preferences card description mentions auto-bid, quality gate, budget cap", () => {
        cy.contains("Enable auto-bid to place bids automatically").should("be.visible");
        cy.contains("budget cap").should("be.visible");
        cy.contains("quality gate").should("be.visible");
    });
});

describe("Buyer Dashboard — Updated Copy", () => {
    beforeEach(() => {
        cy.stubAuth("buyer");
        cy.visit("/buyer", { timeout: 15000 });
    });

    it("subtitle mentions auto-bid activity and CRM pipeline", () => {
        cy.contains("auto-bid activity").should("be.visible");
        cy.contains("CRM pipeline").should("be.visible");
    });
});

describe("Seller Dashboard — x402 Copy", () => {
    beforeEach(() => {
        cy.stubAuth("seller");
        cy.visit("/seller", { timeout: 15000 });
    });

    it("subtitle mentions instant USDC settlements via x402", () => {
        cy.contains("instant USDC settlements via x402").should("be.visible");
    });
});

describe("Authenticated Marketplace — Updated Stats", () => {
    beforeEach(() => {
        cy.stubAuth("buyer");
        cy.visit("/", { timeout: 15000 });
    });

    it("marketplace stats show 20+ countries", () => {
        cy.contains("20+").should("exist");
    });
});
