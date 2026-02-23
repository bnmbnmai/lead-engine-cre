#!/usr/bin/env bash
# Lead Engine CRE — Smoke Test Script
# Run against a live backend before judge review.
# Usage: BASE_URL=https://your-app.onrender.com bash scripts/smoke-test.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
PASS=0
FAIL=0

pass() { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL + 1)); }

echo "🔍 Lead Engine CRE — Smoke Test"
echo "   Target: $BASE_URL"
echo "   $(date)"
echo "─────────────────────────────────────"

# 1. Health check
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null || echo "000")
[ "$STATUS" = "200" ] && pass "GET /api/health → 200" || fail "GET /api/health → $STATUS"

# 2. Demo status
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/demo/status" 2>/dev/null || echo "000")
[ "$STATUS" = "200" ] && pass "GET /api/demo/status → 200" || fail "GET /api/demo/status → $STATUS"

# 3. Marketplace leads
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/marketplace/leads" 2>/dev/null || echo "000")
[ "$STATUS" = "200" ] && pass "GET /api/marketplace/leads → 200" || fail "GET /api/marketplace/leads → $STATUS"

# 4. Start demo (1 cycle)
echo ""
echo "🚀 Starting 1-cycle demo run..."
DEMO_RESP=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"cycles":1}' \
  "$BASE_URL/api/demo/start" 2>/dev/null || echo "error")

HTTP_CODE=$(echo "$DEMO_RESP" | tail -n1)
BODY=$(echo "$DEMO_RESP" | head -n-1)
RUN_ID=$(echo "$BODY" | grep -o '"runId":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ "$HTTP_CODE" = "200" ] && [ -n "$RUN_ID" ]; then
  pass "POST /api/demo/start → 200, runId=$RUN_ID"
else
  fail "POST /api/demo/start → $HTTP_CODE (body: ${BODY:0:120})"
  RUN_ID=""
fi

# 5. Wait and check results
if [ -n "$RUN_ID" ]; then
  echo "   Waiting 90s for cycle to complete..."
  sleep 90
  
  RESULTS=$(curl -s "$BASE_URL/api/demo/results/latest" 2>/dev/null || echo "{}")
  SETTLED=$(echo "$RESULTS" | grep -o '"totalSettled":[0-9.]*' | cut -d':' -f2 || echo "0")
  
  if [ "${SETTLED:-0}" != "0" ] && [ "${SETTLED:-0}" != "null" ]; then
    pass "GET /api/demo/results/latest → totalSettled=$SETTLED"
  else
    fail "GET /api/demo/results/latest → totalSettled=$SETTLED (may need more time)"
  fi
fi

# Summary
echo "─────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "✅ All checks passed — ready for demo!" || echo "⚠️  $FAIL check(s) failed"
exit "$FAIL"
