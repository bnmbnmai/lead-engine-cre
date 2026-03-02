#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# tenderly-simulate.sh — Run 7 Chainlink contract simulations on Tenderly VNet
# ═══════════════════════════════════════════════════════════════════════════════
#
# Usage:
#   ./scripts/tenderly-simulate.sh                          # Use default VNet
#   ./scripts/tenderly-simulate.sh <VNET_RPC_URL>           # Custom VNet RPC
#
# Default VNet ID: 5ce481f4-3d52-4c72-ba73-1c978a7d20ba
# Explorer: https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions
#
# Simulations:
#   1. PersonalEscrowVault.lockForBid    — Automation + Data Feeds
#   2. CREVerifier.computeQualityScore   — Functions CRE (7-gate scoring)
#   3. LeadNFTv2.mintLead                — ACE PolicyProtected mint
#   4. VRFTieBreaker.requestResolution   — VRF v2.5 tiebreaker
#   5. PersonalEscrowVault.performUpkeep — Automation PoR + refund sweep
#   6. BountyMatcher.requestBountyMatch  — Functions bounty matching
#   7. ACECompliance.getUserCompliance   — ACE KYC/reputation check
#
# Output: certified-runs/March-2-2026/tenderly/simulations.json
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Ensure ethers is available (installed in contracts/ or backend/) ──────────
if ! node -e "require('ethers')" 2>/dev/null; then
  echo "📦 Installing ethers..."
  cd "$PROJECT_DIR/contracts" && npm install ethers 2>/dev/null || {
    cd "$PROJECT_DIR" && npm install ethers 2>/dev/null
  }
fi

# ── Run simulations ──────────────────────────────────────────────────────────
echo ""
echo "🚀 Starting Tenderly VNet simulations..."
echo ""

cd "$PROJECT_DIR"
node scripts/tenderly-simulate.js "$@"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ All simulations complete."
  echo ""
  echo "📂 Results: certified-runs/March-2-2026/tenderly/simulations.json"
  echo "🔗 Explorer: https://dashboard.tenderly.co/explorer/vnet/5ce481f4-3d52-4c72-ba73-1c978a7d20ba/transactions"
  echo ""
  echo "🔄 Re-run with: ./scripts/tenderly-simulate.sh"
else
  echo "❌ Some simulations failed (exit code: $EXIT_CODE)"
fi

exit $EXIT_CODE
