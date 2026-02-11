// Cypress support file — global hooks and commands
import './setupMocks';
import { mockWallets } from './mockData';

Cypress.on('uncaught:exception', () => false); // Don't fail on app errors during E2E

// ── Wallet address mapping for stubAuth ─────────────────────
const walletAddresses: Record<string, string> = {
    seller: mockWallets.seller.address,
    buyer: mockWallets.buyer1.address,
    buyer1: mockWallets.buyer1.address,
    buyer2: mockWallets.buyer2.address,
};

declare global {
    namespace Cypress {
        interface Chainable {
            /** Stub wallet auth so the app thinks we're authenticated */
            stubAuth(role?: 'buyer' | 'seller' | 'buyer1' | 'buyer2'): Chainable<void>;
            /**
             * Mock an ethers.js-compatible Ethereum provider on window.ethereum.
             * Supports multi-wallet switching and RPC call interception.
             *
             * @param wallet - 'seller' | 'buyer1' | 'buyer2' (default: 'buyer1')
             * @param options - { wrongNetwork?: boolean, rejectSign?: boolean }
             */
            mockWallet(
                wallet?: 'seller' | 'buyer1' | 'buyer2',
                options?: { wrongNetwork?: boolean; rejectSign?: boolean },
            ): Chainable<void>;
        }
    }
}

Cypress.Commands.add('stubAuth', (role: 'buyer' | 'seller' | 'buyer1' | 'buyer2' = 'buyer') => {
    const normalizedRole = role.startsWith('buyer') ? 'buyer' : 'seller';
    const mockUser = {
        id: `test-user-${role}`,
        walletAddress: walletAddresses[role] || walletAddresses.buyer,
        role: normalizedRole,
    };
    window.localStorage.setItem('le_auth_user', JSON.stringify(mockUser));
    window.localStorage.setItem('le_auth_token', 'test-jwt-token-e2e');
});

Cypress.Commands.add(
    'mockWallet',
    (
        wallet: 'seller' | 'buyer1' | 'buyer2' = 'buyer1',
        options: { wrongNetwork?: boolean; rejectSign?: boolean } = {},
    ) => {
        const walletState = mockWallets[wallet];
        const chainId = options.wrongNetwork ? 1 : walletState.chainId; // 1 = mainnet (wrong)

        cy.on('window:before:load', (win: Cypress.AUTWindow) => {
            // Inject a minimal EIP-1193 provider mock
            const provider = {
                isMetaMask: true,
                selectedAddress: walletState.address,
                chainId: `0x${chainId.toString(16)}`,
                networkVersion: chainId.toString(),

                request: ({ method, params }: { method: string; params?: unknown[] }) => {
                    switch (method) {
                        case 'eth_requestAccounts':
                        case 'eth_accounts':
                            return Promise.resolve([walletState.address]);

                        case 'eth_chainId':
                            return Promise.resolve(`0x${chainId.toString(16)}`);

                        case 'net_version':
                            return Promise.resolve(chainId.toString());

                        case 'eth_getBalance':
                            return Promise.resolve(walletState.balance);

                        case 'personal_sign':
                        case 'eth_sign':
                        case 'eth_signTypedData_v4':
                            if (options.rejectSign) {
                                return Promise.reject(
                                    new Error('MetaMask: User denied message signature.'),
                                );
                            }
                            // Return a deterministic mock signature
                            return Promise.resolve(
                                '0x' + 'ab'.repeat(32) + '1c',
                            );

                        case 'eth_sendTransaction':
                            if (options.rejectSign) {
                                return Promise.reject(
                                    new Error('MetaMask: User denied transaction signature.'),
                                );
                            }
                            return Promise.resolve(
                                '0xmocktxhash' + Date.now().toString(16),
                            );

                        case 'eth_call':
                            // Generic mock for contract reads — return 0-padded 32 bytes
                            return Promise.resolve('0x' + '0'.repeat(64));

                        case 'eth_estimateGas':
                            return Promise.resolve('0x5208'); // 21000

                        case 'eth_gasPrice':
                            return Promise.resolve('0x5d21dba00'); // 25 gwei

                        case 'eth_blockNumber':
                            return Promise.resolve('0x11A8F9B'); // ~18.5M

                        case 'wallet_switchEthereumChain':
                            if (options.wrongNetwork) {
                                return Promise.reject(
                                    new Error('Unrecognized chain ID. Try adding the chain.'),
                                );
                            }
                            return Promise.resolve(null);

                        default:
                            return Promise.resolve(null);
                    }
                },

                on: (_event: string, _cb: (...args: unknown[]) => void) => provider,
                removeListener: () => provider,
                removeAllListeners: () => provider,
            };

            (win as unknown as { ethereum: typeof provider }).ethereum = provider;
        });
    },
);

export { };
