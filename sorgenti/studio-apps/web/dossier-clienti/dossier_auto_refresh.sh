#!/bin/sh
set -eu

APP_DIR=/var/www/html/studio-apps/dossier-clienti
ARCHIVE_DIR='/var/www/html/data/admin/files/studio-example/archivio studio-example'
STATE_DIR=/var/www/html/data/admin/files/Studio/DossierClienti/private
STAMP_FILE="$STATE_DIR/auto-refresh.signature"
LOCK_DIR=/tmp/dossier-clienti-auto-refresh.lock

mkdir "$LOCK_DIR" 2>/dev/null || exit 0
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

signature=$(find "$ARCHIVE_DIR" -type f \( -iname '*.pdf' -o -iname '*.xlsx' -o -iname '*.xls' -o -iname '*.xml' \) -print0 \
  | xargs -0 stat -c '%n|%s|%Y' 2>/dev/null \
  | sort \
  | sha256sum \
  | cut -d' ' -f1)
previous=$(cat "$STAMP_FILE" 2>/dev/null || true)

[ "$signature" = "$previous" ] && exit 0
cd "$APP_DIR"
python3 build_client_dossiers.py
printf '%s\n' "$signature" > "$STAMP_FILE"
