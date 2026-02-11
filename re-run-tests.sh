#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# re-run-tests.sh  —  Run all Lead Engine CRE test suites
# Usage:  chmod +x re-run-tests.sh && ./re-run-tests.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
SKIP=0

header() { echo -e "\n\033[1;36m═══ $1 ═══\033[0m\n"; }
pass()   { echo -e "\033[1;32m✔ $1\033[0m"; }
fail()   { echo -e "\033[1;31m✘ $1\033[0m"; }
skip()   { echo -e "\033[1;33m⊘ $1 (skipped)\033[0m"; }

# ─── 1. Backend Jest Tests ──────────────────────────────────
header "Backend Jest Tests (unit + e2e + compliance + security)"
cd "$ROOT_DIR/backend"
if npx jest --verbose --forceExit --testTimeout=15000 2>&1 | tee "$ROOT_DIR/test-results/jest-results.txt"; then
    JEST_COUNT=$(grep -oP 'Tests:\s+\K\d+(?= passed)' "$ROOT_DIR/test-results/jest-results.txt" || echo "0")
    pass "Backend Jest: ${JEST_COUNT} tests passed"
    PASS=$((PASS + JEST_COUNT))
else
    # Even on failure, count passing tests
    JEST_PASS=$(grep -oP 'Tests:\s+\K\d+(?= passed)' "$ROOT_DIR/test-results/jest-results.txt" || echo "0")
    JEST_FAIL=$(grep -oP '\d+(?= failed)' "$ROOT_DIR/test-results/jest-results.txt" || echo "0")
    fail "Backend Jest: ${JEST_PASS} passed, ${JEST_FAIL} failed"
    PASS=$((PASS + JEST_PASS))
    FAIL=$((FAIL + JEST_FAIL))
fi

# ─── 2. Hardhat Contract Tests ──────────────────────────────
header "Hardhat Contract Tests (Solidity)"
cd "$ROOT_DIR/contracts"
if npx hardhat test 2>&1 | tee "$ROOT_DIR/test-results/hardhat-results.txt"; then
    HH_COUNT=$(grep -oP '\d+(?= passing)' "$ROOT_DIR/test-results/hardhat-results.txt" || echo "0")
    pass "Hardhat: ${HH_COUNT} tests passed"
    PASS=$((PASS + HH_COUNT))
else
    HH_PASS=$(grep -oP '\d+(?= passing)' "$ROOT_DIR/test-results/hardhat-results.txt" || echo "0")
    HH_FAIL=$(grep -oP '\d+(?= failing)' "$ROOT_DIR/test-results/hardhat-results.txt" || echo "0")
    fail "Hardhat: ${HH_PASS} passed, ${HH_FAIL} failed"
    PASS=$((PASS + HH_PASS))
    FAIL=$((FAIL + HH_FAIL))
fi

# ─── 3. Cypress E2E Tests ───────────────────────────────────
header "Cypress E2E Tests"
cd "$ROOT_DIR/frontend"

# Ensure dev server is running (start in background if not)
DEV_PID=""
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "Starting dev server..."
    npm run dev &
    DEV_PID=$!
    sleep 8  # wait for Vite to be ready
fi

if npx cypress run --headless --browser electron 2>&1 | tee "$ROOT_DIR/test-results/cypress-results.txt"; then
    CY_PASS=$(grep -oP '(\d+)\s+of\s+\d+\s+passed' "$ROOT_DIR/test-results/cypress-results.txt" | grep -oP '^\d+' || echo "0")
    # Fallback: count from summary line
    if [ "$CY_PASS" = "0" ]; then
        CY_PASS=$(grep -oP '^\s+\K\d+(?=\s+\d+\s+-)' "$ROOT_DIR/test-results/cypress-results.txt" | head -1 || echo "0")
    fi
    pass "Cypress E2E: ${CY_PASS} tests passed"
    PASS=$((PASS + CY_PASS))
else
    CY_PASS=$(grep -oP '(\d+)(?= passed)' "$ROOT_DIR/test-results/cypress-results.txt" || echo "0")
    CY_FAIL=$(grep -oP '(\d+)(?= failed)' "$ROOT_DIR/test-results/cypress-results.txt" || echo "0")
    fail "Cypress E2E: ${CY_PASS} passed, ${CY_FAIL} failed"
    PASS=$((PASS + CY_PASS))
    FAIL=$((FAIL + CY_FAIL))
fi

# Kill dev server if we started it
[ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null

# ─── 4. Artillery Load Tests ────────────────────────────────
header "Artillery Load Tests"
cd "$ROOT_DIR"

# Artillery requires a running backend at localhost:3001
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    for config in tests/load/artillery-rtb.yaml tests/load/artillery-edge-cases.yaml tests/load/artillery-stress-10k.yaml; do
        name=$(basename "$config" .yaml)
        echo "Running $name..."
        if npx artillery run "$config" 2>&1 | tee "$ROOT_DIR/test-results/artillery-${name}.txt"; then
            pass "Artillery: $name completed"
        else
            fail "Artillery: $name failed (check logs)"
        fi
    done
    SKIP=$((SKIP + 0))
else
    skip "Artillery load tests — backend not running at localhost:3001"
    echo "  To run: start backend (npm run dev:backend) then re-run this script"
    SKIP=$((SKIP + 3))
fi

# ─── Summary ────────────────────────────────────────────────
header "Test Summary"
echo -e "\033[1;32m  Passed:  ${PASS}\033[0m"
[ "$FAIL" -gt 0 ] && echo -e "\033[1;31m  Failed:  ${FAIL}\033[0m"
[ "$SKIP" -gt 0 ] && echo -e "\033[1;33m  Skipped: ${SKIP} (infra-dependent)\033[0m"
TOTAL=$((PASS + FAIL))
if [ "$TOTAL" -gt 0 ]; then
    PCT=$(( (PASS * 100) / TOTAL ))
    echo -e "\n  Pass rate: \033[1;36m${PCT}%\033[0m (${PASS}/${TOTAL})"
fi

if [ "$FAIL" -eq 0 ]; then
    echo -e "\n\033[1;32m🎉 All test suites passed!\033[0m"
    exit 0
else
    echo -e "\n\033[1;31m⚠  Some tests failed — see logs in test-results/\033[0m"
    exit 1
fi
