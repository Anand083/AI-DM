#!/usr/bin/env bash
# Checks that a running copy of the app works.
#
#   scripts/smoke-test.sh https://app.example.com
#
# Always checks (needs only curl): health, home page, login page, security headers, API sign-up.
# Also, when MAILPIT_URL is set and pnpm is available (a laptop or the CI runner, not the server),
# it signs up in a real browser, confirms the email and creates an agency.
#
#   MAILPIT_URL=http://127.0.0.1:8025 MAILPIT_AUTH=user:password scripts/smoke-test.sh http://localhost
set -euo pipefail

BASE="${1:?Usage: scripts/smoke-test.sh BASE_URL}"
BASE="${BASE%/}"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok:   $*"; }

# Waits up to 90 seconds for the app to answer, so this works right after a start or deploy.
wait_for_health() {
  local tries=45
  until curl -fsS --max-time 5 "$BASE/api/health" >/dev/null 2>&1; do
    tries=$((tries - 1))
    [ "$tries" -gt 0 ] || return 1
    sleep 2
  done
}

wait_for_health || fail "$BASE/api/health did not answer in time"
body="$(curl -fsS --max-time 10 "$BASE/api/health")"
echo "$body" | grep -q '"ok":true' || fail "health check says not ok: $body"
pass "health: $body"

curl -fsS --max-time 10 "$BASE/" -o /dev/null || fail "home page did not load"
pass "home page loads"

login="$(curl -fsS --max-time 10 "$BASE/login")"
echo "$login" | grep -qi "sign in" || fail "login page does not look right"
pass "login page loads"

headers="$(curl -sS -I --max-time 10 "$BASE/login")"
echo "$headers" | grep -qi "^x-frame-options: DENY" || fail "security headers are missing"
echo "$headers" | grep -qi "^content-security-policy:" || fail "content security policy is missing"
pass "security headers are set"

# The admin area and the dev tools must not be open to strangers.
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/admin")"
[ "$code" = "404" ] || fail "/admin answered $code for a visitor (expected 404)"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$BASE/api/dev/billing/advance")"
[ "$code" = "404" ] || fail "the dev billing endpoint answered $code (expected 404 in production)"
pass "admin and dev endpoints are closed"

# Sign up through the API. The account stays unconfirmed, so nothing else can happen with it.
email="smoke-$(date +%s)-$RANDOM@example.test"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$BASE/api/auth/sign-up/email" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d "{\"name\":\"Smoke Test\",\"email\":\"$email\",\"password\":\"smoke-test-password-123\",\"timezone\":\"UTC\"}")"
[ "$code" = "200" ] || fail "sign up answered $code (expected 200)"
pass "sign up works"

if [ -n "${MAILPIT_URL:-}" ] && command -v pnpm >/dev/null 2>&1; then
  echo "running the browser check (sign up, confirm email, create agency)..."
  SMOKE_BASE_URL="$BASE" pnpm exec playwright test -c playwright.smoke.config.ts || fail "browser check failed"
  pass "sign up, email confirmation and agency creation work in a browser"
else
  echo "skip: browser check (needs MAILPIT_URL and pnpm)"
fi

echo "SMOKE TEST PASSED for $BASE"
