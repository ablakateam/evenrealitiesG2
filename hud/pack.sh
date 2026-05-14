#!/usr/bin/env bash
# Pack the VOX HUD into a .ehpk, substituting the real server domain into the
# app.json network whitelist at build time. The committed app.json keeps a
# `YOUR_DOMAIN` placeholder so the live domain never lands in git.
#
# Usage:  VOX_DOMAIN=your.server.example bash pack.sh
#         (or put VOX_DOMAIN=... in hud/.env — gitignored)
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
: "${VOX_DOMAIN:?set VOX_DOMAIN (env var or hud/.env) — the server origin host}"

npm run build
sed "s/YOUR_DOMAIN/${VOX_DOMAIN}/g" app.json > app.build.json
evenhub pack app.build.json dist -o vox.ehpk
rm -f app.build.json
echo "✓ packed vox.ehpk (whitelist → https://${VOX_DOMAIN})"
