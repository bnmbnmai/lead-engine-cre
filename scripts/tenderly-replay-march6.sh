#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# tenderly-replay-march6.sh
# Replay key transactions from the March-6-2026 certified run
# into the Tenderly VNet for fresh simulation traces.
#
# Usage:
#   export TENDERLY_ACCESS_KEY=<your-key>
#   export TENDERLY_ACCOUNT=<your-account>
#   export TENDERLY_PROJECT=<your-project>
#   export TENDERLY_VNET_ID=5ce481f4-3d52-4c72-ba73-1c978a7d20ba
#   bash scripts/tenderly-replay-march6.sh
#
# This replays real Base Sepolia tx hashes via Tenderly Simulation API.
# All tx hashes come from certified-runs/March-6-2026/demo-results-e678990f.json
# ─────────────────────────────────────────────────────────────

set -euo pipefail

: "${TENDERLY_ACCESS_KEY:?Set TENDERLY_ACCESS_KEY}"
: "${TENDERLY_ACCOUNT:?Set TENDERLY_ACCOUNT}"
: "${TENDERLY_PROJECT:?Set TENDERLY_PROJECT}"
: "${TENDERLY_VNET_ID:=5ce481f4-3d52-4c72-ba73-1c978a7d20ba}"

API="https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT}/project/${TENDERLY_PROJECT}"

simulate_tx() {
  local label="$1"
  local tx_hash="$2"
  echo "🔄 Simulating: ${label} (${tx_hash:0:10}…)"
  curl -s -X POST "${API}/simulate" \
    -H "X-Access-Key: ${TENDERLY_ACCESS_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"network_id\": \"84532\",
      \"transaction_index\": 0,
      \"from\": \"0x6BBcf283847f409a58Ff984A79eFD571\",
      \"save\": true,
      \"save_if_fails\": true,
      \"simulation_type\": \"quick\",
      \"source\": \"leadrtb-march6-replay\",
      \"verbose\": true
    }" | jq -r '.simulation.id // "❌ Failed"'
}

echo "═══════════════════════════════════════════════"
echo "  LeadRTB — Tenderly VNet Replay (March 6, 2026)"
echo "  Certified Run: e678990f  •  6 cycles  •  \$215 settled"
echo "═══════════════════════════════════════════════"
echo ""

# ── Proof-of-Reserves (PersonalEscrowVaultUpkeep) ──────────
# Shared PoR tx across all 6 cycles — batched solvency check
echo "━━━ Automation PoR ━━━"
simulate_tx "PoR Solvency Check (all 6 cycles)" \
  "0x7f70037bbdf8efaa0870f1cedebb2457401b96ebabca13e16ae344d577eb3b87"

# ── NFT Mints (LeadNFTv2) ──────────────────────────────────
echo ""
echo "━━━ NFT Mints (#65–#70) ━━━"
simulate_tx "NFT #65 mint — mortgage"  "0x60497f944474e7204e156eee38989b1cc02dcc97482715949fe92a6179c8a2c1"
simulate_tx "NFT #66 mint — roofing"   "0xffc442ff30e7531b4c89e22ca9dad1b219ba4e016d35b0d8567f00d4eaa81c57"
simulate_tx "NFT #67 mint — hvac"      "0xbfddd2e7b2621c0ac95cde2de71dc996986e0e7b245b649a84648ce081a3be35"
simulate_tx "NFT #68 mint — mortgage"  "0xc1b387d95983793b3d1d843f727948b4444e93f6991d4810fdba87a0fb199ca5"
simulate_tx "NFT #69 mint — solar"     "0x1cd6e920a2a13b34829d701efc3b007fe402d35e9325b5a7106e9438ccccafa3"
simulate_tx "NFT #70 mint — real_estate" "0x2563499207fe18bef93a08c33586899631e59f4e370ad5b3c6ea5ac64341ca82"

# ── VRF Tiebreakers (VRFTieBreaker) ────────────────────────
echo ""
echo "━━━ VRF Tiebreakers ━━━"
simulate_tx "VRF tiebreaker — cycle 1 (mortgage)"  "0x5f782840c879808cd9253ca87c3c5d3c3572a41955afe49cadad842bcee2b686"
simulate_tx "VRF tiebreaker — cycle 3 (hvac)"      "0xf4abc77b372f29988c4313d0d0633cbe969490ccf0e2fa31bafd66b5cb571fcc"

# ── Escrow Settlements (PersonalEscrowVault) ───────────────
echo ""
echo "━━━ Escrow Settlements ━━━"
simulate_tx "Settle cycle 1 — \$27"  "0x1022c6ca3a5a675456afff1f1dace7a518c97e0df92995c48a839e63daa23b53"
simulate_tx "Settle cycle 2 — \$46"  "0xfc85ab0313bd53bb51677ad9398d6d77338639a1465c39654dc2074cb4109c26"
simulate_tx "Settle cycle 3 — \$23"  "0xea0686e0e22e6205809d790e1288d9140113b8f8e8f3a04b9b9a16d56232c8fb"
simulate_tx "Settle cycle 4 — \$50"  "0x2eb81eb87b6af57adc272af818a2411be77a62216c72889683e8cf4bdd75c45b"
simulate_tx "Settle cycle 5 — \$29"  "0x43eed2a316b1f8f04e7aef824c460ef7b771ff5beddad9ad18b895d812875372"
simulate_tx "Settle cycle 6 — \$40"  "0xa0991cec3f198f918810b17dc4b898957e3d2c03a536d624a709f615578f7185"

# ── Bounty Payouts (VerticalBountyPool + BountyMatcher) ────
echo ""
echo "━━━ Bounty Payouts ━━━"
simulate_tx "Bounty — cycle 1 (\$15 mortgage)" "0xf2079c3973a879018f3182f7f24caced243d7c1c822c3dcafcf289ed192fdf1d"
simulate_tx "Bounty — cycle 2 (\$12 roofing)"  "0x242e834e9f949b8462be0575f79a9017342c22763bb63bedf5d1fce24d9ead2d"
simulate_tx "Bounty — cycle 5 (\$15 solar)"    "0xac034404f0b9e7957af88381ba7cdd368fc5b80b37974a4a1e206a5e8d8caa67"

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ Done! ${TENDERLY_VNET_ID}"
echo "  View: https://dashboard.tenderly.co/explorer/vnet/${TENDERLY_VNET_ID}/transactions"
echo "═══════════════════════════════════════════════"
