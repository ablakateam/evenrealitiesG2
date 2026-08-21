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

# Legal pages carry a SUPPORT_EMAIL placeholder in the repo (the PII
# pre-commit guard blocks the real address). Substitute it here, the same
# way hud/pack.sh substitutes the domain into app.json.
if [ -f "${LOCAL_DIR}/../hud/.env" ]; then
  set -a; . "${LOCAL_DIR}/../hud/.env"; set +a
fi
if [ -n "${VOX_SUPPORT_EMAIL:-}" ]; then
  for f in "${LOCAL_DIR}"/dist/privacy/index.html "${LOCAL_DIR}"/dist/terms/index.html; do
    [ -f "$f" ] && sed -i '' "s/SUPPORT_EMAIL/${VOX_SUPPORT_EMAIL}/g" "$f"
  done
  echo "→ support email substituted into legal pages"
else
  echo "⚠ VOX_SUPPORT_EMAIL unset — legal pages will show the placeholder" >&2
fi

echo "→ Deploying to ${SSH_TARGET}:${REMOTE_DIR}"
ssh "${SSH_TARGET}" "mkdir -p ${REMOTE_DIR}"
rsync -avz --delete "${LOCAL_DIR}/dist/" "${SSH_TARGET}:${REMOTE_DIR}/"

# index.html must never be cached; assets are content-hashed so they're safe.
ssh "${SSH_TARGET}" "systemctl reload nginx && echo '✓ nginx reloaded'"

echo "✓ Dashboard deployed → ${SSH_TARGET}:${REMOTE_DIR}"
