#!/usr/bin/env bash
# Копия базы и всех фото в /var/backups/obektiv. Хранит последние 14 копий.
set -euo pipefail
DATA=/var/lib/obektiv
OUT=/var/backups/obektiv
mkdir -p "$OUT"
TMP=$(mktemp -d)
# Безопасная копия базы, даже пока сайт работает
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('$DATA/obektiv.db').exec(\"VACUUM INTO '$TMP/obektiv.db'\")" 2>/dev/null
tar czf "$OUT/obektiv-$(date +%F).tar.gz" -C "$TMP" obektiv.db -C "$DATA" uploads
rm -rf "$TMP"
ls -1t "$OUT"/obektiv-*.tar.gz | tail -n +15 | xargs -r rm -f
echo "Копия: $OUT/obektiv-$(date +%F).tar.gz"
