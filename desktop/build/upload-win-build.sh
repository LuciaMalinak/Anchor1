#!/bin/bash
# One command to publish a freshly-built Windows installer to the website's
# download button (DesktopTokenPanel.tsx -> GET /api/download/desktop-app/win),
# and — if this build was made after the auto-update feature shipped — the
# update feed (latest.yml) that lets already-installed copies discover it.
#
# What it does: finds the .exe electron-builder just produced under
# release/, asks the website for a short-lived direct-to-R2 upload URL
# (POST /api/admin/desktop-app/upload-url — see that route and
# src/lib/desktopAppUploadSecret.ts in the main repo), then PUTs it
# straight to R2. The bytes never pass through Render's own server.
#
# Requires DESKTOP_APP_UPLOAD_SECRET to be set as an environment variable
# before running this (never hardcoded here, never committed) — it must
# match the same-named secret set in Render's environment variables for
# the website.
#
# Usage:
#   export DESKTOP_APP_UPLOAD_SECRET="whatever is set in Render"
#   bash desktop/build/upload-win-build.sh
#
# Optional: set ANCHOR_WEB_BASE to point at a different environment
# (defaults to the production site).

set -e

ANCHOR_WEB_BASE="${ANCHOR_WEB_BASE:-https://anchor-be6o.onrender.com}"

if [ -z "$DESKTOP_APP_UPLOAD_SECRET" ]; then
  echo "DESKTOP_APP_UPLOAD_SECRET isn't set. Run:"
  echo "  export DESKTOP_APP_UPLOAD_SECRET=\"<the value from Render's environment variables>\""
  echo "then re-run this script."
  exit 1
fi

cd "$(dirname "$0")/.."  # desktop/

EXE_PATH="release/Anchor-Desktop-Setup.exe"
if [ ! -f "$EXE_PATH" ]; then
  echo "No $EXE_PATH found. Build it first:"
  echo "  npm run dist:win"
  exit 1
fi

echo "Found build: $EXE_PATH ($(du -h "$EXE_PATH" | cut -f1))"

# Same as upload-mac-build.sh: asks the website for a short-lived upload
# URL, retrying for a few minutes if the site is briefly unavailable (e.g.
# restarting for a deploy pushed at the same moment as this build), and
# stopping straight away on a real refusal like a wrong upload secret.
# Parses the reply with Node, which is always there when building the app
# (GitHub's Windows machines don't have a python3 command).
json_upload_url() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).uploadUrl||'')}catch{}})"
}

request_upload_url() {
  local body="$1" response url attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    response=$(curl -sS -m 60 -X POST "$ANCHOR_WEB_BASE/api/admin/desktop-app/upload-url" \
      -H "Content-Type: application/json" \
      -H "x-upload-secret: $DESKTOP_APP_UPLOAD_SECRET" \
      -d "$body" 2>&1 || true)
    url=$(echo "$response" | json_upload_url 2>/dev/null || echo "")
    if [ -n "$url" ]; then
      echo "$url"
      return 0
    fi
    if echo "$response" | grep -qi "not authorized"; then
      break
    fi
    echo "  Anchor didn't answer with an upload URL (attempt $attempt of 10) — retrying in 30s …" >&2
    sleep 30
  done
  echo "Didn't get an upload URL back. Last response was: $response" >&2
  if [ -n "$GITHUB_ACTIONS" ]; then
    echo "::error::Upload URL request failed. Last response: $(echo "$response" | head -c 300 | tr '\n' ' ')" >&2
  fi
  return 1
}

echo "Asking $ANCHOR_WEB_BASE for an upload URL …"
UPLOAD_URL=$(request_upload_url '{"platform":"win"}') || exit 1

echo "Uploading to R2 …"
curl -sS --fail --retry 3 -X PUT "$UPLOAD_URL" \
  -H "Content-Type: application/x-msdownload" \
  --data-binary "@$EXE_PATH" \
  --progress-bar

echo ""
echo "Done. The download button on the Integrations page (and"
echo "$ANCHOR_WEB_BASE/api/download/desktop-app/win directly) will now serve this build."

# Also publish the update feed (latest.yml) — see upload-mac-build.sh for
# why. Skip silently if it's missing (older, pre-auto-update builds).
YML_PATH="release/latest.yml"
if [ -f "$YML_PATH" ]; then
  echo ""
  echo "Publishing update feed ($YML_PATH) …"
  YML_UPLOAD_URL=$(request_upload_url '{"file":"latest.yml"}') || exit 1
  curl -sS --fail --retry 3 -X PUT "$YML_UPLOAD_URL" \
    -H "Content-Type: text/yaml" \
    --data-binary "@$YML_PATH" \
    --progress-bar
  echo ""
  echo "Update feed published. Installed copies of the app will pick this up on their next auto-update check."
else
  echo ""
  echo "No $YML_PATH found — skipping update-feed publish (this build wasn't made with npm run dist:win after the auto-update feature shipped)."
fi
