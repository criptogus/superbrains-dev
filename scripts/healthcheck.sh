#!/usr/bin/env bash
# SuperBrains healthcheck — run via cron every 5 min.
# Checks site, API health, and a real forecast. Logs failures; exits non-zero on failure.
set -u
LOG=/var/log/superbrains-health.log
BASE="${SITE_URL:-https://superbrains.dev}"
fail=0

check() {
  local name="$1" url="$2" expect="${3:-200}"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" || echo "000")
  if [ "$code" != "$expect" ]; then
    echo "$(date -Is) FAIL $name $url -> $code" >> "$LOG"
    fail=1
  fi
}

check site      "$BASE/"
check api       "$BASE/api/health"

# real forecast smoke (POST)
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 -X POST "$BASE/api/forecast" \
  -H 'content-type: application/json' \
  -d '{"values":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],"horizon":5}' || echo "000")
if [ "$code" != "200" ]; then
  echo "$(date -Is) FAIL forecast POST $BASE/api/forecast -> $code" >> "$LOG"
  fail=1
fi

# trim log to last 500 lines
[ -f "$LOG" ] && tail -500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit $fail
