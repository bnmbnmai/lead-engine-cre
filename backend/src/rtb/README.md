# RTB — Real-Time Bidding Engine

This directory contains the core Real-Time Bidding (RTB) engine and WebSocket server
for lead-level sealed-bid auctions.

## Files

| File | Purpose |
|---|---|
| `engine.ts` | `RTBEngine` class — lead intake, auction creation, buyer matching (CRE + ACE gates), auto-bid evaluation, holder-perk staggered pings, and escrow settlement dispatch |
| `socket.ts` | WebSocket server (`socket.io`) — real-time bid events, marketplace updates, agent bid broadcasts, and demo log streaming |

## Usage

```ts
import { rtbEngine } from './rtb/engine';

// Process a new lead through the auction pipeline
await rtbEngine.processLeadIntake(leadId);
```

The engine is initialized at server startup (`server.ts`) with a reference to the
Socket.IO instance for real-time event broadcasting.
