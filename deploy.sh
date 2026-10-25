#!/usr/bin/env bash
# Wysyła kod na serwer przez rsync i przebudowuje kontenery.
set -euo pipefail

SERVER="${SERVER:-root@2.31.115.87}"
APP_DIR="${APP_DIR:-/opt/imbiro}"

cd "$(dirname "$0")"

# Pomija wszystko z .gitignore (m.in. .env, docs/SERVER.md, node_modules).
# Wykluczone pliki nie są też kasowane na serwerze przez --delete,
# więc /opt/imbiro/.env zostaje nietknięty.
# Uwaga: nie zamieniać na --filter=':- .gitignore' — openrsync (macOS)
# nie chroni wtedy plików przed --delete i skasowałby .env na serwerze.
rsync -az --delete \
  --exclude-from=.gitignore \
  --exclude .git \
  --exclude .claude \
  --exclude dist \
  ./ "$SERVER:$APP_DIR/"

ssh "$SERVER" "cd $APP_DIR && docker compose -f docker-compose.prod.yml up -d --build --remove-orphans && docker image prune -f"
