#!/usr/bin/env bash
# Pack the VOX HUD into a .ehpk.
#
# The bundle carries NO credential. Vite would inline VITE_VOX_SECRET at build
# time if it were set, and anyone holding the .ehpk could decompress it and
# read the value straight out of the JS — the container is zstd-compressed, not
# encrypted. So this script explicitly clears it before building, and verifies
# afterwards that nothing leaked through.
#
# An install therefore starts unpaired and gets a per-device credential from
# the pairing flow (dashboard → Account → Pair your glasses).
#
# VOX_DOMAIN is still substituted into app.json's network whitelist. That is a
# platform requirement, not a secret: the Even Realities App blocks any request
# to a domain the manifest does not list, and wildcards are not supported.
#
# Usage:  bash pack.sh                     (public build — no credential)
#         VOX_EMBED_SECRET=1 bash pack.sh  (legacy pre-paired build; dev only)
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
: "${VOX_DOMAIN:?set VOX_DOMAIN (env var or hud/.env) — the server origin host}"

if [ "${VOX_EMBED_SECRET:-0}" = "1" ]; then
  echo "⚠ VOX_EMBED_SECRET=1 — baking credentials into the bundle."
  echo "  This build must never be distributed. Anyone with the .ehpk can read them."
else
  # Clearing the shell variables is NOT enough: Vite loads hud/.env itself, so
  # the values come back regardless of the environment we hand it. Override
  # them with `.env.production.local`, which sits at the top of Vite's
  # precedence order (.env.[mode].local > .env.[mode] > .env.local > .env) and
  # is removed again on exit.
  unset VITE_VOX_SECRET VITE_VOX_SERVER
  printf 'VITE_VOX_SECRET=\nVITE_VOX_SERVER=\n' > .env.production.local
  # The one origin this build may reach — the same value that goes into
  # app.json's whitelist, baked in whole so no URL is assembled at runtime.
  printf 'VITE_VOX_ALLOWED_ORIGIN=https://%s\n' "${VOX_DOMAIN}" >> .env.production.local
  trap 'rm -f "$(dirname "$0")/.env.production.local"' EXIT
fi

npm run build

# Verify rather than trust. A build that still contains the secret is the exact
# failure this script exists to prevent, so fail loudly instead of shipping it.
if [ "${VOX_EMBED_SECRET:-0}" != "1" ] && [ -n "${VITE_VOX_SECRET:-}" ]; then
  echo "✗ VITE_VOX_SECRET is still set after unset — refusing to pack." >&2
  exit 1
fi
if [ "${VOX_EMBED_SECRET:-0}" != "1" ]; then
  leaked=0
  # Re-read the raw value from .env; the shell copy was unset above.
  if [ -f .env ]; then
    secret_value="$(grep -E '^VITE_VOX_SECRET=' .env | cut -d= -f2- | tr -d '"'"'"' ' || true)"
    if [ -n "$secret_value" ] && grep -rqF -- "$secret_value" dist; then
      echo "✗ the shared secret appears in dist/ — refusing to pack." >&2
      leaked=1
    fi
  fi
  [ "$leaked" -eq 1 ] && exit 1
  echo "✓ verified: no credential in dist/"
fi

# Every URL literal in the bundle must be covered by app.json's whitelist.
# Store review scans for exactly this and rejects the build otherwise; a
# template like `https://${host}` survives as `https://${t}` and is flagged,
# fairly, because nothing static can tell where it points.
unlisted=0
while IFS= read -r url; do
  [ -z "$url" ] && continue
  case "$url" in
    "https://${VOX_DOMAIN}"*) ;;
    *) echo "✗ bundle contains a URL not covered by the whitelist: $url" >&2; unlisted=1 ;;
  esac
done <<EOF
$(grep -ohE 'https?://[^"'"'"'\`,)\\ ]{0,80}' dist/assets/*.js 2>/dev/null | sort -u)
EOF
if [ "$unlisted" -eq 1 ]; then
  echo "  Fix the literal, or add the origin to app.json's network whitelist." >&2
  exit 1
fi
echo "✓ verified: every URL in dist/ is whitelisted" 

sed "s/YOUR_DOMAIN/${VOX_DOMAIN}/g" app.json > app.build.json
# Prefer the user's npm-global bin so a non-login shell (CI, IDE) still
# finds the CLI without relying on PATH inheritance.
EVENHUB="${EVENHUB:-$(command -v evenhub || echo "$HOME/.npm-global/bin/evenhub")}"
"$EVENHUB" pack app.build.json dist -o vox.ehpk
rm -f app.build.json
echo "✓ packed vox.ehpk (whitelist → https://${VOX_DOMAIN})"
