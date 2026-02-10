# Video Outline — Lead Engine CRE Demo

**Platform:** Loom (free, unlisted, shareable link)
**Length:** 3:00–3:50
**Resolution:** 1080p, browser full-screen
**Audio:** Built-in mic voiceover (no background music)

---

## Pre-Recording Checklist

- [ ] Backend running (`npm run dev` in backend/)
- [ ] Frontend running (`npm run dev` in frontend/)
- [ ] MCP server running (`npm run dev` in mcp-server/)
- [ ] Mock data seeded (`npm run db:seed`)
- [ ] MetaMask on Sepolia with test ETH
- [ ] Terminal open with curl commands pre-typed
- [ ] Browser at `localhost:5173` (or Vercel URL)
- [ ] Loom recording started (screen + mic)

---

## Shot List

| Time | Scene | Screen | Key Visual |
|------|-------|--------|-----------|
| 0:00 | Title | Landing page hero | Stats bar: 2,847 leads, $127 avg, 15 countries |
| 0:25 | Seller Submit | Submit Lead form | Mortgage, NY, $450K, CRE score 7,850 |
| 0:55 | DECO + Streams | Terminal / API response | `isStub: true`, bid floor $85-$220 |
| 1:25 | ACE + Auto-Rules | Compliance + Preferences | Cross-border block, auto-bid rule set |
| 1:55 | MCP Agent | Terminal + MCP calls | 3 tool calls, structured log output |
| 2:20 | Encrypted Bid | Buyer Dashboard | Commitment hash → reveal → NFT mint |
| 2:45 | CRM + Testnet | Export button + sim output | CSV download, 500+ tx report |
| 3:10 | Global Scale | Marketplace filters + tests | 10 verticals, 29 tests, 1,500 users |
| 3:35 | Close | Architecture diagram | Repo link, thank you |

---

## Terminal Commands (pre-type before recording)

```bash
# Scene 3: Data Streams bid floor
curl http://localhost:3001/api/v1/bids/bid-floor?vertical=mortgage&country=US

# Scene 5: MCP agent - search
curl -X POST http://localhost:3002/rpc -H "Content-Type: application/json" \
  -d '{"method":"search_leads","params":{"vertical":"solar","state":"CA","limit":3}}'

# Scene 5: MCP agent - bid floor
curl -X POST http://localhost:3002/rpc -H "Content-Type: application/json" \
  -d '{"method":"get_bid_floor","params":{"vertical":"solar"}}'

# Scene 5: MCP agent - place bid
curl -X POST http://localhost:3002/rpc -H "Content-Type: application/json" \
  -d '{"method":"place_bid","params":{"leadId":"lead_demo_001","amount":55}}'
```

---

## Backup Segments

Pre-record these individually before the full take:

1. **Wallet connection** — MetaMask connect on landing page (15s)
2. **MCP agent calls** — all 3 curl commands with output (30s)
3. **CRM export** — "Push to CRM" click + CSV download (10s)
4. **Contract interaction** — Sepolia tx confirmation (15s)

If anything fails during the live take, splice in the backup segment.

---

## Post-Recording

- [ ] Trim dead air and loading screens in Loom editor
- [ ] Add title card at 0:00 if Loom supports it
- [ ] Set to unlisted
- [ ] Copy shareable link → paste into `PITCH_DECK.md` Slide 12
- [ ] Test that link works in incognito
