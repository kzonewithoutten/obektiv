#!/usr/bin/env bash
# Сделать свой номер администратором: obektiv-admin 89001234567
cd "$(dirname "$0")/.." || exit 1
export DATA_DIR="${DATA_DIR:-/var/lib/obektiv}"
if [ "$(id -u)" = 0 ] && id nodejs >/dev/null 2>&1; then
  if command -v sudo >/dev/null; then exec sudo -u nodejs DATA_DIR="$DATA_DIR" node deploy/make-admin.js "$@"
  else exec runuser -u nodejs -- env DATA_DIR="$DATA_DIR" node deploy/make-admin.js "$@"; fi
fi
exec node deploy/make-admin.js "$@"
