import { defineConfig } from 'cypress';

export default defineConfig({
    e2e: {
        baseUrl: 'http://localhost:5173',
        viewportWidth: 1440,
        viewportHeight: 900,
        defaultCommandTimeout: 10000,
        video: true,
        screenshotOnRunFailure: true,
        specPattern: 'cypress/e2e/**/*.cy.ts',
        supportFile: 'cypress/support/e2e.ts',
    },
});
