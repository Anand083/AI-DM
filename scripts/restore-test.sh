#!/usr/bin/env bash
# Proves that a backup can be restored: restores a dump into a new, temporary database and checks
# that the row count of every table matches the live database.
#
#   scripts/restore-test.sh <dump-file> <live-database-url>
#
# The live database is only read. The temporary database is created on the same server and
# dropped at the end. Run it right after a backup (the dump must be newer than the last write,
# or counts may differ on a busy database).
set -euo pipefail

DUMP="${1:?Usage: scripts/restore-test.sh <dump-file> <live-database-url>}"
LIVE="${2:?Usage: scripts/restore-test.sh <dump-file> <live-database-url>}"
SCRATCH="restore_test_$(date +%s)"
ADMIN="${LIVE%/*}/postgres"
TARGET="${LIVE%/*}/$SCRATCH"

cleanup() { psql "$ADMIN" -qc "drop database if exists \"$SCRATCH\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$ADMIN" -qc "create database \"$SCRATCH\""
"$(dirname "$0")/restore.sh" "$DUMP" "$TARGET"

counts() {
  psql "$1" -tAF'|' -c "
    select format('select %L, count(*) from %I.%I', table_name, table_schema, table_name)
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name" \
  | while IFS= read -r q; do psql "$1" -tAF'|' -c "$q"; done
}

counts "$LIVE" > "/tmp/$SCRATCH.live"
counts "$TARGET" > "/tmp/$SCRATCH.restored"
if diff "/tmp/$SCRATCH.live" "/tmp/$SCRATCH.restored" >/dev/null; then
  echo "RESTORE TEST PASSED: $(wc -l < "/tmp/$SCRATCH.live") tables, all row counts match"
  rm -f "/tmp/$SCRATCH.live" "/tmp/$SCRATCH.restored"
else
  echo "RESTORE TEST FAILED: row counts differ" >&2
  diff "/tmp/$SCRATCH.live" "/tmp/$SCRATCH.restored" >&2 || true
  exit 1
fi
