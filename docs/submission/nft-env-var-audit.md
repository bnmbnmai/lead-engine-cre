# NFT Environment Variable Audit

## Root Cause
`DemoResults.tsx` line 30 read `VITE_LEAD_NFT_ADDRESS` — a variable that **does not exist** anywhere in the project.

The project standard (used in `wagmi.ts:12` and `frontend/.env.example:20`) is `VITE_LEAD_NFT_ADDRESS_SEPOLIA`.

Because the wrong env var was always `undefined`, the fallback `'0x0000000000000000000000000000000000000000'` was used, producing Basescan token links pointing to the zero address.

## Data Flow
```
demo-orchestrator.ts → settleOneCycle() → mintLeadNFT() → returns { tokenId, txHash }
    → cycleResult.nftTokenId / cycleResult.mintTxHash
        → API: GET /demo-panel/full-e2e/results/:runId
            → frontend DemoResults.tsx renders NFT column
                → LEAD_NFT_ADDR + cycle.nftTokenId → basescan.org/token/{addr}?a={tokenId}
```

## Fix
```diff
-const LEAD_NFT_ADDR = import.meta.env.VITE_LEAD_NFT_ADDRESS || '0x0000...';
+const LEAD_NFT_ADDR = import.meta.env.VITE_LEAD_NFT_ADDRESS_SEPOLIA || '';
```

## Vercel Environment Variable to Add
- **Key:** `VITE_LEAD_NFT_ADDRESS_SEPOLIA`
- **Value:** `0x73ebD9218aDe497C9ceED04E5CcBd06a00Ba7155`
