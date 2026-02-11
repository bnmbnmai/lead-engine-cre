// Cypress support file — global hooks and commands
import './setupMocks';

Cypress.on('uncaught:exception', () => false); // Don't fail on app errors during E2E

declare global {
    namespace Cypress {
        interface Chainable {
            /** Stub wallet auth so the app thinks we're authenticated */
            stubAuth(role?: 'buyer' | 'seller'): Chainable<void>;
        }
    }
}

Cypress.Commands.add('stubAuth', (role: 'buyer' | 'seller' = 'buyer') => {
    const mockUser = {
        id: 'test-user-001',
        walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
        role,
    };
    window.localStorage.setItem('le_auth_user', JSON.stringify(mockUser));
    window.localStorage.setItem('le_auth_token', 'test-jwt-token-e2e');
});

export { };
