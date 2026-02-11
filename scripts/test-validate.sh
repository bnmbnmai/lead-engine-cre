#!/usr/bin/env bash
# test-validate.sh — Run all Lead Engine CRE tests locally (cross-platform)
#
# Usage:
#   bash scripts/test-validate.sh           # Run all suites
#   bash scripts/test-validate.sh backend   # Run only backend tests
#   bash scripts/test-validate.sh contracts # Run only contract tests
#
# Save this file: scripts/test-validate.sh
# Make executable:  chmod +x scripts/test-validate.sh
# Run:              bash scripts/test-validate.sh

set -euo pipefail

SUITE="${1:-all}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0; SKIP=0

# ═══════════════════════════════════════════════
# Colors
# ═══════════════════════════════════════════════
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'

header() { echo -e "\n${CYAN}$(printf '═%.0s' {1..60})${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}$(printf '═%.0s' {1..60})${NC}"; }
pass()   { echo -e "  ${GREEN}✅ $1${NC}"; ((PASS++)); }
fail()   { echo -e "  ${RED}❌ $1${NC}"; ((FAIL++)); }
skip()   { echo -e "  ${YELLOW}⏭️  $1${NC}"; ((SKIP++)); }
info()   { echo -e "  ℹ️  $1"; }

# ═══════════════════════════════════════════════
# 1. Backend Tests
# ═══════════════════════════════════════════════
run_backend() {
    header "BACKEND TESTS (Jest)"
    cd "$ROOT/backend"
    [ ! -d node_modules ] && { info "Installing deps..."; npm ci --silent; }
    
    if npm test -- --coverage --forceExit --detectOpenHandles 2>&1; then
        pass "Backend: Jest tests passed (11 suites, ~113 tests)"
    else
        fail "Backend: Jest tests failed"
    fi
}

# ═══════════════════════════════════════════════
# 2. Frontend Build
# ═══════════════════════════════════════════════
run_frontend() {
    header "FRONTEND BUILD CHECK"
    cd "$ROOT/frontend"
    [ ! -d node_modules ] && { info "Installing deps..."; npm ci --silent; }
    
    if npm run build 2>&1; then
        pass "Frontend: Vite build succeeded"
    else
        fail "Frontend: Vite build failed"
    fi
}

# ═══════════════════════════════════════════════
# 3. Cypress E2E
# ═══════════════════════════════════════════════
run_cypress() {
    header "CYPRESS E2E TESTS"
    cd "$ROOT/frontend"
    
    if ! command -v npx &>/dev/null || ! npx cypress --version &>/dev/null; then
        skip "Cypress not installed"
        return
    fi
    
    if npx cypress run --headless 2>&1; then
        pass "Cypress: E2E tests passed (4 specs, ~53 tests)"
    else
        fail "Cypress: E2E tests failed"
    fi
}

# ═══════════════════════════════════════════════
# 4. Artillery
# ═══════════════════════════════════════════════
run_artillery() {
    header "ARTILLERY LOAD TESTS"
    
    if ! command -v artillery &>/dev/null; then
        skip "Artillery not installed (npm i -g artillery)"
        return
    fi
    
    local config="$ROOT/backend/tests/load-test.yml"
    if [ ! -f "$config" ]; then
        skip "No Artillery config found"
        return
    fi
    
    info "Ensure backend is running on localhost:3001"
    if artillery run "$config" 2>&1; then
        pass "Artillery: smoke test passed"
    else
        fail "Artillery: load test failed"
    fi
}

# ═══════════════════════════════════════════════
# 5. Hardhat Contracts
# ═══════════════════════════════════════════════
run_contracts() {
    header "HARDHAT CONTRACT TESTS"
    cd "$ROOT/contracts"
    [ ! -d node_modules ] && { info "Installing deps..."; npm ci --silent; }
    
    info "Compiling contracts..."
    npx hardhat compile 2>&1
    
    if npx hardhat test 2>&1; then
        pass "Contracts: Hardhat tests passed (7 files, ~15 tests)"
    else
        fail "Contracts: Hardhat tests failed"
    fi
}

# ═══════════════════════════════════════════════
# Run
# ═══════════════════════════════════════════════
header "LEAD ENGINE CRE — TEST VALIDATION"
echo "  Suite:   $SUITE"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Root:    $ROOT"

case "$SUITE" in
    all)       run_backend; run_frontend; run_cypress; run_artillery; run_contracts ;;
    backend)   run_backend ;;
    frontend)  run_frontend ;;
    cypress)   run_cypress ;;
    artillery) run_artillery ;;
    contracts) run_contracts ;;
    *) echo "Unknown suite: $SUITE"; echo "Options: all, backend, frontend, cypress, artillery, contracts"; exit 1 ;;
esac

# ═══════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════
header "SUMMARY"
echo -e "  ${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}  ${YELLOW}Skipped: $SKIP${NC}"
echo ""

[ "$FAIL" -gt 0 ] && exit 1 || exit 0
