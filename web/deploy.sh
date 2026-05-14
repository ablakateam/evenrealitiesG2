#!/usr/bin/env bash
#
# Build + deploy the VOX dashboard to the Vultr VPS.
# Nginx serves /opt/vox-web at the site root; /api + /webhooks proxy to Node.
#
# Usage:
#   bash deploy.sh                  (defaults to vox-vps ssh alias)
#   SSH_TARGET=root@1.2.3.4 bash deploy.sh
#
set -euo pipefail

SSH_TARGET="${SSH_TARGET:-vox-vps}"
REMOTE_DIR="/opt/vox-web"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "→ Building dashboard…"
cd "$LOCAL_DIR"
npm run build

echo "→ Deploying to ${SSH_TARGET}:${REMOTE_DIR}"
ssh "${SSH_TARGET}" "mkdir -p ${REMOTE_DIR}"
rsync -avz --delete "${LOCAL_DIR}/dist/" "${SSH_TARGET}:${REMOTE_DIR}/"

# index.html must never be cached; assets are content-hashed so they're safe.
ssh "${SSH_TARGET}" "systemctl reload nginx && echo '✓ nginx reloaded'"

echo "✓ Dashboard deployed → ${SSH_TARGET}:${REMOTE_DIR}"
