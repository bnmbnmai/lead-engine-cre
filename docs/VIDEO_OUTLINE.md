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
| 1:50 | EU Solar Auto-Bid | Seller submit → auto-bid | DE solar, score 8500, 2 bids auto-fire |
| 2:05 | MCP Agent | Terminal + MCP calls | 8 tools, set_auto_bid_rules, configure_crm_webhook |
| 2:25 | Encrypted Bid | Buyer Dashboard | Commitment hash → reveal → NFT mint |
| 2:45 | CRM Webhooks | Webhook config + delivery | HubSpot properties, Zapier flat payload |
| 3:10 | Global Scale | Marketplace filters + tests | 10 verticals, 151 tests, 1,500 users |
| 3:35 | Close | Architecture diagram | Repo link, thank you |

---

## Terminal Commands (pre-type before recording)

```bash
# Scene 3: Data Streams bid floor
curl http://localhost:3001/api/v1/bids/bid-floor?vertical=mortgage&country=US

# Scene 4B: Auto-bid evaluate
curl -X POST http://localhost:3001/api/v1/bids/auto-bid/evaluate \
  -H "Content-Type: application/json" -H "Authorization: Bearer <TOKEN>" \
  -d '{"leadId":"lead_demo_eu_solar"}'

# Scene 5: MCP agent - search
curl -X POST http://localhost:3002/rpc -H "Content-Type: application/json" \
  -d '{"method":"search_leads","params":{"vertical":"solar","state":"CA","limit":3}}'

# Scene 5: MCP agent - set auto-bid rules
curl -X POST http://localhost:3002/rpc -H "Content-Type: application/json" \
  -d '{"method":"set_auto_bid_rules","params":{"vertical":"solar","autoBidAmount":120,"minQualityScore":8000,"geoInclude":["CA","FL"]}}'

# Scene 5: MCP agent - configure CRM webhook
curl -X POST http://localhost:3002/rpc -H "Content-Type: application/json" \
  -d '{"method":"configure_crm_webhook","params":{"url":"https://hooks.zapier.com/hooks/catch/12345/demo/","format":"zapier"}}'

# Scene 5: MCP agent - ping lead
curl -X POST http://localhost:3002/rpc -H "Content-Type: application/json" \
  -d '{"method":"ping_lead","params":{"leadId":"lead_demo_001","action":"evaluate"}}'
```

---

## Backup Segments

Pre-record these individually before the full take:

1. **Wallet connection** — MetaMask connect on landing page (15s)
2. **Auto-bid evaluation** — EU solar lead → 2 auto-bids fire (15s)
3. **MCP agent calls** — all 4 new tool calls with output (30s)
4. **CRM webhook delivery** — HubSpot + Zapier 200 OK (10s)
5. **Contract interaction** — Sepolia tx confirmation (15s)

If anything fails during the live take, splice in the backup segment.

---

## Post-Recording

- [ ] Trim dead air and loading screens in Loom editor
- [ ] Add title card at 0:00 if Loom supports it
- [ ] Set to unlisted
- [ ] Copy shareable link → paste into `PITCH_DECK.md` Slide 12
- [ ] Test that link works in incognito
