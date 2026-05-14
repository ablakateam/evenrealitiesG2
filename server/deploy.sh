#!/usr/bin/env bash
#
# Deploy vox-server to the Vultr VPS via rsync + ssh.
# Prereqs (local):  npm run build  has produced ./dist/
# Prereqs (remote): /opt/vox/.env populated with MASTER_KEY + BOOTSTRAP_SECRET
#
# Usage:
#   bash deploy.sh                  (defaults to vox-vps ssh alias)
#   SSH_TARGET=root@1.2.3.4 bash deploy.sh
#
set -euo pipefail

SSH_TARGET="${SSH_TARGET:-vox-vps}"
REMOTE_DIR="/opt/vox"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "→ Deploying to ${SSH_TARGET}:${REMOTE_DIR}"

# 1. Ensure local build is fresh.
if [[ ! -d "${LOCAL_DIR}/dist" ]]; then
  echo "✗ dist/ missing — run 'npm run build' first" >&2
  exit 1
fi

# 2. Make remote target exist (idempotent).
ssh "${SSH_TARGET}" "mkdir -p ${REMOTE_DIR}/data ${REMOTE_DIR}/dist"

# 3. Rsync the build artifacts + manifest. Excludes node_modules; we install
#    remotely so native deps (better-sqlite3, argon2) compile for the VPS arch.
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.tsbuildinfo' \
  --exclude='*.map' \
  "${LOCAL_DIR}/dist/" "${SSH_TARGET}:${REMOTE_DIR}/dist/"

rsync -avz \
  "${LOCAL_DIR}/package.json" \
  "${LOCAL_DIR}/package-lock.json" \
  "${LOCAL_DIR}/ecosystem.config.cjs" \
  "${SSH_TARGET}:${REMOTE_DIR}/"

# 4. Install production deps remotely so native modules build against the VPS
#    Node binary, and reload pm2.
ssh "${SSH_TARGET}" bash <<'REMOTE'
set -euo pipefail
cd /opt/vox

# Generate MASTER_KEY + BOOTSTRAP_SECRET on first deploy if .env is absent.
if [[ ! -f .env ]]; then
  echo "→ first deploy on this VPS; generating /opt/vox/.env"
  MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  BOOTSTRAP_SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")
  cat > .env <<EOF
NODE_ENV=production
PORT=3000
DB_PATH=/opt/vox/data/vox.db
MASTER_KEY=${MASTER_KEY}
BOOTSTRAP_SECRET=${BOOTSTRAP_SECRET}
LOG_LEVEL=info
EOF
  chmod 600 .env
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo " IMPORTANT — save the BOOTSTRAP_SECRET shown below."
  echo " It is the bearer token used to authenticate API calls until you"
  echo " pair a real user via the dashboard. After pairing, rotate it."
  echo "════════════════════════════════════════════════════════════════"
  echo "BOOTSTRAP_SECRET=${BOOTSTRAP_SECRET}"
  echo "════════════════════════════════════════════════════════════════"
fi

npm ci --omit=dev --silent

# Stop legacy P1 hello-world if it's still around, replace with vox-server.
if pm2 describe vox-hello >/dev/null 2>&1; then
  echo "→ removing P1 vox-hello placeholder"
  pm2 delete vox-hello
fi

if pm2 describe vox-server >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --env production
else
  pm2 start ecosystem.config.cjs --env production
fi
pm2 save

echo
echo "→ pm2 status:"
pm2 list

echo
echo "→ /api/health from server itself:"
curl -fs http://127.0.0.1:3000/api/health | head -1
REMOTE

echo
echo "✓ Deploy complete."
