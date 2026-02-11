# Cypress Mocking Guide

> **For non-coders** — Copy-paste setup to run E2E tests with full mocks (no live backend needed).

## Quick Start

```bash
cd frontend
npm install           # one-time setup
npx cypress run       # run all 114+ tests headless
npx cypress open      # interactive test runner
```

## What's Mocked

| System         | Mock                                  | File                            |
|----------------|---------------------------------------|-------------------------------|
| API endpoints  | 25+ `cy.intercept()` handlers         | `cypress/support/setupMocks.ts` |
| Wallet auth    | `cy.stubAuth('buyer')`                | `cypress/support/e2e.ts`        |
| Ethereum provider | `cy.mockWallet('buyer1')`          | `cypress/support/e2e.ts`        |
| Seeded data    | Leads, bids, asks, analytics, wallets | `cypress/support/mockData.ts`   |
| Chainlink oracle | Latency/timeout simulation         | `setupMocks.ts` options         |
| x402 payments  | Payment failure simulation            | `setupMocks.ts` options         |

## Using Mock Options

```typescript
// Normal mocks
cy.mockApi();

// Simulate Chainlink 6s+ latency
cy.mockApi({ slowChainlink: true });

// Simulate Chainlink 504 timeout
cy.mockApi({ failChainlink: true });

// Simulate x402 payment failure
cy.mockApi({ failPayment: true });

// Simulate Redis cache miss (3s delay)
cy.mockApi({ latency: 3000 });

// Inject ethers.js wallet mock
cy.mockWallet('buyer1');

// Wrong network (mainnet instead of Sepolia)
cy.mockWallet('buyer1', { wrongNetwork: true });

// Signature rejection
cy.mockWallet('buyer1', { rejectSign: true });
```

## Available Wallets

| ID      | Address                                      | Chain   | ETH   | USDC  |
|---------|----------------------------------------------|---------|-------|-------|
| seller  | `0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08` | Sepolia | 2.5   | 5000  |
| buyer1  | `0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199` | Sepolia | 1.8   | 3200  |
| buyer2  | `0xdD2FD4581271e230360230F9337D5c0430Bf44C0` | Sepolia | 0.9   | 1500  |

## Adding a New Mock

```typescript
// In setupMocks.ts, add inside cy.mockApi():
cy.intercept('GET', `${API}/your-endpoint*`, {
    statusCode: 200,
    body: { data: 'your mock data' },
    delay,
}).as('yourEndpoint');
```

## Validation Checklist

- [ ] `npx cypress run` — all specs pass, 0 failures
- [ ] No "Cannot read properties" errors in console
- [ ] Chainlink edge cases show loading states (not blank screens)
- [ ] Wallet mock tests verify `window.ethereum` injection
- [ ] Payment failure tests don't crash the UI
