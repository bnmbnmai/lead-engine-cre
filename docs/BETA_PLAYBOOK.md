# Beta Testing Playbook — Lead Engine CRE

## Pilot: Boise, Idaho → National → Global

---

## Phase 1: Boise Pilot (Weeks 1-4)

### Why Boise?
- **Solar boom:** Idaho solar installations grew 40% YoY
- **Mortgage activity:** Median home price $420K, strong refinance market
- **Contained market:** ~750K metro pop, manageable lead volume
- **Regulatory:** No state-specific lead licensing requirements

### Target Participants

| Role | Count | Recruitment Channel |
|------|-------|---------------------|
| Solar sellers | 5 | Local solar installers (GoSolar Boise, Sunrun ID chapter) |
| Mortgage sellers | 3 | Local mortgage brokers via LinkedIn outreach |
| Buyers | 20 | National lead buyers with ID geo targeting |
| MCP integrators | 2 | Early-access API partners |

### Success KPIs (4-week targets)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Leads submitted | 200+ | Backend DB count |
| Bids placed | 500+ | Bid table count |
| Auto-bid activation | 60% of buyers | Preferences table |
| Settlement time | < 10s median | Escrow event timestamps |
| CRM webhook delivery | 95%+ success rate | Webhook health map |
| Seller reinvestment | 3+ sellers fund ads same day | Self-reported survey |
| Buyer CPA reduction | > 20% vs. manual baseline | A/B comparison |
| System uptime | 99.5%+ | Render + Sentry |
| NPS (Net Promoter Score) | > 40 | Post-pilot survey |

### Weekly Cadence

| Week | Focus | Deliverable |
|------|-------|-------------|
| 1 | Onboarding + first leads | 5 sellers submitting, 10 buyers with preferences set |
| 2 | Auto-bid activation | 60% auto-bid enabled, first CRM integrations |
| 3 | Volume ramp | 100+ leads, settlement flow validated |
| 4 | Feedback + metrics | NPS survey, KPI report, go/no-go for Phase 2 |

### Daily Monitoring

```
# Morning standup checks
1. Sentry: any new errors overnight? 
2. Webhook health: any circuits tripped?
3. Settlement: any stuck escrows?
4. Auto-bid: firing rate vs. submission rate
5. Load: P95 latency < 500ms?
```

---

## Phase 2: US National Expansion (Weeks 5-8)

### Geo Escalation

| Market | Verticals | Target Users |
|--------|-----------|-------------|
| Phoenix, AZ | Solar + roofing | 10 sellers, 30 buyers |
| Miami, FL | Mortgage + insurance | 8 sellers, 25 buyers |
| Austin, TX | B2B SaaS + auto | 5 sellers, 20 buyers |

### Entry Criteria
- Phase 1 KPIs met (≥ 80% of targets)
- No critical Sentry alerts unresolved
- Webhook circuit breaker: < 2 trips/week
- NPS > 30

### New Features for Phase 2
- [ ] Multi-vertical auto-bid (bid across solar + mortgage simultaneously)
- [ ] Bulk lead upload API (CSV → leads)
- [ ] Real-time analytics dashboard (live bid volume, settlement velocity)

---

## Phase 3: Global Pilot (Weeks 9-12)

### International Markets

| Market | Vertical | Compliance | Target |
|--------|----------|------------|--------|
| 🇩🇪 Germany | Solar | GDPR + MiCA | 5 sellers, 15 buyers |
| 🇬🇧 UK | Insurance | FCA compliant | 3 sellers, 10 buyers |
| 🇧🇷 Brazil | Real estate | LGPD | 3 sellers, 10 buyers |

### Entry Criteria
- Phase 2 KPIs met
- i18n translations reviewed (de, fr, pt)
- ACE cross-border compliance validated for target geos
- USDC settlement tested with international wallets

---

## Rollback Plan

| Trigger | Action | Timeline |
|---------|--------|----------|
| NPS < 10 after Week 2 | Pause onboarding, fix top complaints | 48h |
| Settlement failure rate > 5% | Disable x402, switch to manual escrow | 4h |
| Sentry error rate > 5% | Revert to last stable deploy | 1h |
| Webhook circuit breakers tripping daily | Disable CRM webhooks, revert to CSV export | 2h |
| Regulatory concern raised | Pause geo, consult legal | 24h |

---

## Post-Pilot Report Template

```markdown
# Beta Pilot Report — [Market] — Week [N]

## KPI Summary
| Metric | Target | Actual | Status |
|--------|--------|--------|--------|

## Top Issues
1. ...
2. ...

## User Feedback (Verbatim Quotes)
- Seller: "..."
- Buyer: "..."

## Recommendations for Next Phase
- [ ] ...
```
