#!/bin/bash
# Provision a Hetzner Cloud server for SuperBrains.
# Usage: HCLOUD_TOKEN=... ./provision-hetzner.sh [server-name] [location]
#   location: nbg1 (Nuremberg) | fsn1 (Falkenstein) | hel1 (Helsinki) |
#             ash (Ashburn) | hil (Hillsboro) | sin (Singapore)
set -euo pipefail

NAME="${1:-superbrains-prod}"
LOC="${2:-nbg1}"
IMAGE="ubuntu-24.04"
TYPE="cpx22"          # 2 vCPU / 4 GB / ~€3.79 — bump to cx32 for more headroom
SSH_KEY_FILE="${SSH_KEY_FILE:-$HOME/.ssh/superbrains_hetzner.pub}"
TOKEN="${HCLOUD_TOKEN:?set HCLOUD_TOKEN}"
export HCLOUD_TOKEN="$TOKEN"

echo "==> context check"
hcloud context create superbrains --token-from-env 2>/dev/null || true
hcloud context use superbrains >/dev/null

echo "==> ssh key"
KEY_NAME="superbrains-deploy"
if ! hcloud ssh-key describe "$KEY_NAME" >/dev/null 2>&1; then
  hcloud ssh-key create --name "$KEY_NAME" --public-key-from-file "$SSH_KEY_FILE" >/dev/null
  echo "    created $KEY_NAME"
else
  echo "    reusing $KEY_NAME"
fi

echo "==> firewall (80/443/22 only)"
hcloud firewall create --name superbrains-fw >/dev/null 2>&1 || true
hcloud firewall add-rule superbrains-fw --direction in --protocol tcp --port 22 --source-ips 0.0.0.0/0 0.0.0.0/0 >/dev/null 2>&1 || true
hcloud firewall add-rule superbrains-fw --direction in --protocol tcp --port 80 --source-ips 0.0.0.0/0 0.0.0.0/0 >/dev/null 2>&1 || true
hcloud firewall add-rule superbrains-fw --direction in --protocol tcp --port 443 --source-ips 0.0.0.0/0 0.0.0.0/0 >/dev/null 2>&1 || true

echo "==> server $NAME ($TYPE / $IMAGE / $LOC)"
SERVER_JSON=$(hcloud server create \
  --name "$NAME" \
  --type "$TYPE" \
  --image "$IMAGE" \
  --location "$LOC" \
  --ssh-key "$KEY_NAME" \
  --firewall superbrains-fw \
  --label project=superbrains \
  -o json)
IP=$(echo "$SERVER_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin)['server']['public_net']['ipv4']['ip'])")
echo "    IP: $IP"

echo "==> waiting for ssh"
for i in $(seq 1 30); do
  ssh -i "$HOME/.ssh/superbrains_hetzner" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 "root@$IP" "echo ready" 2>/dev/null && break
  sleep 5
done

cat <<EOF

Done. Server: $NAME @ $IP
SSH:  ssh -i ~/.ssh/superbrains_hetzner root@$IP

Next: deploy the stack
  rsync -az --exclude .git --exclude backend/.venv -e "ssh -i ~/.ssh/superbrains_hetzner" \\
    "$(dirname "$0")/.." root@$IP:/opt/superbrains/
  ssh -i ~/.ssh/superbrains_hetzner root@$IP \\
    'cd /opt/superbrains/deploy && SITE_ADDRESS=superbrains.dev docker compose up -d --build'

Remember: point DNS A record for your domain → $IP first (Caddy needs it for HTTPS).
EOF
