#!/usr/bin/env bash
# Runs ON THE SERVER. Deploys one version of the app and rolls back if the smoke test fails.
#
#   scripts/deploy.sh <git-sha>
#
# Expects, in the app folder (the folder this script lives in, one level up):
#   .env                     the production settings (see .env.prod.example)
#   docker-compose.prod.yml  the stack
#   scripts/smoke-test.sh    the check
# Settings that change how it runs (used by tests):
#   SKIP_PULL=1              do not pull images (they are already on this machine)
#   SMOKE_URL=...            where to run the smoke test (default: APP_URL from .env)
#   DEPLOY_FORCE_SMOKE_FAIL=1  make the smoke test fail, to prove the rollback works
#
# Database changes are NOT rolled back. Every migration must keep the previous version working
# (add things first, remove them in a later release). See docs/OPERATIONS.md.
set -euo pipefail

NEW="${1:?Usage: scripts/deploy.sh <git-sha>}"
cd "$(dirname "$0")/.."

ENV_FILE=".env"
STATE_FILE=".deployed-sha"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
case "$NEW" in *[!A-Za-z0-9._-]*) echo "Bad version name: $NEW" >&2; exit 1 ;; esac

read_env() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true; }
set_tag() {
  if grep -qE '^IMAGE_TAG=' "$ENV_FILE"; then
    sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$1|" "$ENV_FILE"
  else
    echo "IMAGE_TAG=$1" >> "$ENV_FILE"
  fi
}
log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

PREVIOUS=""
[ -f "$STATE_FILE" ] && PREVIOUS="$(cat "$STATE_FILE")"
URL="${SMOKE_URL:-$(read_env APP_URL)}"
[ -n "$URL" ] || { echo "No APP_URL in $ENV_FILE and no SMOKE_URL" >&2; exit 1; }

start_version() {
  set_tag "$1"
  [ "${SKIP_PULL:-0}" = "1" ] || "${COMPOSE[@]}" pull web worker
  # migrate runs first (web and worker wait for it), then everything is (re)started.
  "${COMPOSE[@]}" up -d --remove-orphans --no-build
}

smoke() {
  if [ "${DEPLOY_FORCE_SMOKE_FAIL:-0}" = "1" ]; then
    echo "FAIL: forced smoke test failure" >&2
    return 1
  fi
  scripts/smoke-test.sh "$URL"
}

log "Deploying $NEW (previous: ${PREVIOUS:-none}) to $URL"
if start_version "$NEW" && smoke; then
  echo "$NEW" > "$STATE_FILE"
  docker image prune -f >/dev/null 2>&1 || true
  log "Deployed $NEW"
  exit 0
fi

log "Version $NEW failed."
if [ -z "$PREVIOUS" ]; then
  log "There is no previous version to go back to. Leaving it as it is."
  exit 1
fi
log "Rolling back to $PREVIOUS"
start_version "$PREVIOUS"
if DEPLOY_FORCE_SMOKE_FAIL=0 smoke; then
  log "Rolled back to $PREVIOUS and it is healthy."
else
  log "Rolled back to $PREVIOUS but the smoke test still fails. Look at the server now."
fi
exit 1
