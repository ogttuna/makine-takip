#!/bin/sh
set -eu

backup_interval="${BACKUP_INTERVAL:-86400}"
retention_days="${BACKUP_RETENTION_DAYS:-60}"
retention_marker="${BACKUP_RETENTION_MARKER:-/backup/.retention-start}"

mkdir -p /backup

first_managed_run=0
if [ ! -e "$retention_marker" ]; then
  touch "$retention_marker"
  first_managed_run=1
fi

while true; do
  if [ "$first_managed_run" = "1" ]; then
    first_managed_run=0
    echo "retention marker initialized; waiting until next interval before first managed backup"
    sleep "$backup_interval"
    continue
  fi

  today="$(date +%F)"
  temp_db="/backup/.${today}.db.tmp"
  temp_archive="/backup/.${today}.db.gz.tmp"
  output_archive="/backup/${today}.db.gz"

  if [ -e "$output_archive" ]; then
    echo "SQLite backup already exists for $today; skipping"
  else
    rm -f "$temp_db" "$temp_archive"
    if sqlite3 -readonly /data/freezedry.db ".backup '$temp_db'"; then
      if gzip -c "$temp_db" > "$temp_archive"; then
        mv "$temp_archive" "$output_archive"
        find /backup -maxdepth 1 -type f -name '*.db.gz' \
          -newer "$retention_marker" -mtime "+$retention_days" -delete
        echo "SQLite backup created: $output_archive"
      fi
    else
      echo "SQLite backup failed" >&2
    fi
    rm -f "$temp_db" "$temp_archive"
  fi

  sleep "$backup_interval"
done
