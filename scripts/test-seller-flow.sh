#!/bin/bash
# =============================================
# Lead Engine CRE — End-to-End Seller Flow Test
# =============================================
# Tests the full seller pipeline via API:
# 1. Health check
# 2. Auth (get nonce → login)
# 3. Validate lead submission schema
# 4. Full E2E demo pipeline (lead→verify→bid→settle)
# 5. Compliance check
# 6. ZK verification
# 7. Swagger UI accessible
# 8. Swagger spec exists on disk
#
# Usage:
#   chmod +x scripts/test-seller-flow.sh
#   ./scripts/test-seller-flow.sh [API_URL]
# =============================================

set -e

API_URL="${1:-http://localhost:3001}"
PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() {
    TOTAL=$((TOTAL + 1))
    echo ""
    echo -e "${BLUE}━━━ Step $TOTAL: $1 ━━━${NC}"
}

log_pass() {
    PASS=$((PASS + 1))
    echo -e "  ${GREEN}✓ PASS${NC} $1"
}

log_fail() {
    FAIL=$((FAIL + 1))
    echo -e "  ${RED}✗ FAIL${NC} $1"
}

check_status() {
    local response="$1"
    local expected_code="$2"
    local actual_code
    actual_code=$(echo "$response" | tail -1)

    if [ "$actual_code" = "$expected_code" ]; then
        log_pass "HTTP $actual_code"
        return 0
    else
        log_fail "Expected HTTP $expected_code, got HTTP $actual_code"
        echo "  Response: $(echo "$response" | head -1)"
        return 1
    fi
}

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Lead Engine CRE — Seller Flow E2E Test  ║"
echo "╠══════════════════════════════════════════╣"
echo "║  API: $API_URL"
echo "╚══════════════════════════════════════════╝"

# ─── Step 1: Health Check ───────────────
log_step "Health Check"

HEALTH=$(curl -s -w "\n%{http_code}" "$API_URL/health")
if check_status "$HEALTH" "200"; then
    HEALTH_BODY=$(echo "$HEALTH" | head -1)
    DB_STATUS=$(echo "$HEALTH_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('database', 'unknown'))" 2>/dev/null || echo "unknown")
    echo "  Database: $DB_STATUS"
fi

# ─── Step 2: Get Auth Nonce ─────────────
log_step "Get Auth Nonce"

WALLET="0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"
NONCE_RESP=$(curl -s -w "\n%{http_code}" "$API_URL/api/v1/auth/nonce/$WALLET")
check_status "$NONCE_RESP" "200"

echo "  (Full wallet auth requires signing — using demo endpoints for remaining tests)"

# ─── Step 3: Test Lead Submit Validation ─
log_step "Test Lead Submit — Validation (Bad Request)"

BAD_LEAD=$(curl -s -w "\n%{http_code}" \
    -X POST "$API_URL/api/v1/leads/submit" \
    -H "Content-Type: application/json" \
    -d '{"vertical": "invalid_vertical"}')

BAD_CODE=$(echo "$BAD_LEAD" | tail -1)
if [ "$BAD_CODE" = "400" ] || [ "$BAD_CODE" = "401" ]; then
    log_pass "Validation rejected bad input (HTTP $BAD_CODE)"
else
    log_fail "Expected 400 or 401, got $BAD_CODE"
fi

# ─── Step 4: Test Demo E2E Bid Pipeline ─
log_step "E2E Demo Pipeline (Lead → Verify → Bid → Settle)"

E2E_RESP=$(curl -s -w "\n%{http_code}" \
    -X POST "$API_URL/api/v1/demo/e2e-bid" \
    -H "Content-Type: application/json" \
    -d '{
        "vertical": "roofing",
        "geoState": "FL",
        "geoZip": "33101",
        "reservePrice": 35.00,
        "bidAmount": 50.00,
        "buyerAddress": "0xdemobuyer1234567890abcdef1234567890abcdef"
    }')

E2E_CODE=$(echo "$E2E_RESP" | tail -1)
if [ "$E2E_CODE" = "200" ]; then
    log_pass "Full pipeline completed (HTTP 200)"

    E2E_BODY=$(echo "$E2E_RESP" | head -1)

    STEPS_COUNT=$(echo "$E2E_BODY" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('steps', [])))" 2>/dev/null || echo "0")
    echo "  Pipeline steps completed: $STEPS_COUNT"

    LEAD_ID=$(echo "$E2E_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('summary', {}).get('leadId', 'unknown'))" 2>/dev/null || echo "unknown")
    echo "  Lead ID: $LEAD_ID"

    SETTLED=$(echo "$E2E_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('summary', {}).get('settled', False))" 2>/dev/null || echo "unknown")
    if [ "$SETTLED" = "True" ]; then
        log_pass "Settlement completed"
    else
        echo "  Settlement: $SETTLED (may not be configured)"
    fi
else
    log_fail "Pipeline failed (HTTP $E2E_CODE)"
    echo "  Response: $(echo "$E2E_RESP" | head -1 | head -c 200)"
fi

# ─── Step 5: Test Compliance Check ──────
log_step "Compliance Check"

COMP_RESP=$(curl -s -w "\n%{http_code}" \
    -X POST "$API_URL/api/v1/demo/compliance-check" \
    -H "Content-Type: application/json" \
    -d '{
        "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
        "vertical": "roofing",
        "geoState": "FL"
    }')

COMP_CODE=$(echo "$COMP_RESP" | tail -1)
if [ "$COMP_CODE" = "200" ]; then
    log_pass "Compliance check passed (HTTP 200)"
else
    log_fail "Compliance check failed (HTTP $COMP_CODE)"
fi

# ─── Step 6: Test ZK Verification ───────
log_step "ZK Verification"

ZK_RESP=$(curl -s -w "\n%{http_code}" \
    -X POST "$API_URL/api/v1/demo/zk-verify" \
    -H "Content-Type: application/json" \
    -d '{
        "vertical": "mortgage",
        "geoState": "CA",
        "geoZip": "90001"
    }')

ZK_CODE=$(echo "$ZK_RESP" | tail -1)
if [ "$ZK_CODE" = "200" ]; then
    log_pass "ZK verification passed (HTTP 200)"
else
    log_fail "ZK verification failed (HTTP $ZK_CODE)"
fi

# ─── Step 7: Swagger UI Accessible ──────
log_step "Swagger UI Endpoint (/api/swagger)"

SWAGGER_RESP=$(curl -s -w "\n%{http_code}" "$API_URL/api/swagger")
SWAGGER_CODE=$(echo "$SWAGGER_RESP" | tail -1)
SWAGGER_BODY=$(echo "$SWAGGER_RESP" | head -1)

if [ "$SWAGGER_CODE" = "200" ] || [ "$SWAGGER_CODE" = "301" ] || [ "$SWAGGER_CODE" = "304" ]; then
    # Check if it's HTML (Swagger UI) or YAML (fallback)
    if echo "$SWAGGER_BODY" | grep -qi "swagger\|html\|openapi"; then
        log_pass "Swagger UI accessible (HTTP $SWAGGER_CODE)"
    else
        log_pass "Swagger endpoint responding (HTTP $SWAGGER_CODE)"
    fi
else
    log_fail "Swagger UI not accessible (HTTP $SWAGGER_CODE)"
fi

# ─── Step 8: Swagger Spec on Disk ───────
log_step "Swagger Spec File Exists"

if [ -f "$(dirname "$0")/../backend/swagger.yaml" ]; then
    log_pass "swagger.yaml found"
    LINES=$(wc -l < "$(dirname "$0")/../backend/swagger.yaml")
    echo "  Lines: $LINES"
else
    log_fail "swagger.yaml not found"
fi

# ─── Summary ────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║             TEST SUMMARY                  ║"
echo "╠══════════════════════════════════════════╣"
echo -e "║  Total: $TOTAL  |  ${GREEN}Pass: $PASS${NC}  |  ${RED}Fail: $FAIL${NC}"
echo "╚══════════════════════════════════════════╝"
echo ""

if [ $FAIL -gt 0 ]; then
    exit 1
fi
exit 0
