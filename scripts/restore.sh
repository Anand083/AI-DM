#!/usr/bin/env bash
# Restores a database dump (made by docker/backup.sh) into a database.
#
#   scripts/restore.sh <dump-file> <database-url>
#
# The target database must exist and be EMPTY. To be safe the script refuses to run when it
# finds tables, unless you pass --replace (it then drops and recreates the "public" schema).
#
# Examples:
#   scripts/restore.sh backups/db-20260101T020000Z.dump postgresql://app:pw@localhost:5432/app_restore
# On the server, from inside the stack:
#   docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
#     sh -c 'createdb -U app app_restore && pg_restore -U app -d app_restore --no-owner' < db.dump
set -euo pipefail

REPLACE=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--replace" ]; then REPLACE=1; else ARGS+=("$a"); fi
done
DUMP="${ARGS[0]:?Usage: scripts/restore.sh <dump-file> <database-url> [--replace]}"
URL="${ARGS[1]:?Usage: scripts/restore.sh <dump-file> <database-url> [--replace]}"
[ -f "$DUMP" ] || { echo "No such file: $DUMP" >&2; exit 1; }

tables="$(psql "$URL" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "$tables" != "0" ]; then
  if [ "$REPLACE" = "1" ]; then
    echo "Target has $tables tables. Dropping the public schema (--replace)."
    psql "$URL" -v ON_ERROR_STOP=1 -c "drop schema public cascade; create schema public;"
  else
    echo "Target database is not empty ($tables tables). Use an empty database, or pass --replace." >&2
    exit 1
  fi
fi

pg_restore --no-owner --exit-on-error --dbname="$URL" "$DUMP"
echo "Restored $DUMP"
