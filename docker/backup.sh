#!/bin/sh
# Nightly database backup. Keeps the newest 3 files. (Step 26 adds the copy to S3.)
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP:-3}"
HOUR="${BACKUP_HOUR_UTC:-2}"

backup_once() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  file="$BACKUP_DIR/db-$stamp.dump"
  echo "backup: writing $file"
  pg_dump --format=custom --compress=6 --no-owner --file="$file.partial"
  mv "$file.partial" "$file"
  # Remove the oldest files, keep the newest $KEEP.
  ls -1t "$BACKUP_DIR"/db-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    echo "backup: removing $old"
    rm -f "$old"
  done
  echo "backup: done ($(du -h "$file" | cut -f1))"
}

mkdir -p "$BACKUP_DIR"
if [ "${1:-}" = "once" ]; then
  backup_once
  exit 0
fi

echo "backup: running every day at $HOUR:00 UTC"
while true; do
  now="$(date -u +%s)"
  today="$(date -u +%Y-%m-%d)"
  next="$(date -u -d "$today $HOUR:00:00" +%s 2>/dev/null || date -u -D '%Y-%m-%d %H:%M:%S' -d "$today $HOUR:00:00" +%s)"
  if [ "$next" -le "$now" ]; then next=$((next + 86400)); fi
  sleep "$((next - now))"
  backup_once || echo "backup: FAILED"
done
