#!/usr/bin/env bash
# SuperBrains backup — daily SQLite snapshot + compose config.
# Keeps 14 days. Install: cron '17 3 * * * /opt/superbrains/scripts/backup.sh'
set -eu
DEST=/opt/backups/superbrains
KEEP=14
mkdir -p "$DEST"

# SQLite online backup from inside the api container
TS=$(date +%Y%m%d-%H%M)
docker exec -i deploy-api-1 python - <<'PY'
import sqlite3
src = sqlite3.connect("/data/app/app.db")
dst = sqlite3.connect("/data/app/app.db.bak")
src.backup(dst)
dst.close(); src.close()
PY
docker cp "deploy-api-1:/data/app/app.db.bak" "$DEST/app-$TS.db"

# compose + Caddy certs metadata (small)
tar -czf "$DEST/config-$TS.tar.gz" -C /opt/superbrains deploy/docker-compose.yml deploy/Caddyfile deploy/.env 2>/dev/null || true

# prune
ls -1t "$DEST"/app-*.db 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
ls -1t "$DEST"/config-*.tar.gz 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
echo "$(date -Is) backup ok -> $DEST/app-$TS.db"
