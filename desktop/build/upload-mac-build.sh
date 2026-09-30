#!/bin/bash
# One command to publish a freshly-built Mac zip to the website's
# download button (DesktopTokenPanel.tsx -> GET /api/download/desktop-app/mac).
#
# What it does: finds the zip electron-builder just produced under
# release/, asks the website for a short-lived direct-to-R2 upload URL
# (POST /api/admin/desktop-app/upload-url — see that route and
# src/lib/desktopAppUploadSecret.ts in the main repo), then PUTs the zip
# straight to R2. The bytes never pass through Render's own server, so a
# 100+MB Electron build never sits in its memory.
#
# Requires DESKTOP_APP_UPLOAD_SECRET to be set as an environment variable
# before running this (never hardcoded here, never committed) — it must
# match the same-named secret set in Render's environment variables for
# the website. If you don't have it handy, check Render's dashboard
# (Environment tab) for the anchor-be6o service; if it isn't set there
# yet, uploads are disabled until it is (the endpoint just returns a
# clear 503 explaining that).
#
# Usage:
#   export DESKTOP_APP_UPLOAD_SECRET="whatever is set in Render"
#   bash desktop/build/upload-mac-build.sh
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

ZIP_PATH="release/Anchor-Desktop-mac.zip"
if [ ! -f "$ZIP_PATH" ]; then
  echo "No $ZIP_PATH found. Build it first:"
  echo "  npm run dist:mac"
  echo ""
  echo "(Using the exact artifactName from package.json rather than a *-mac.zip"
  echo "glob on purpose — a leftover build from an older version, e.g."
  echo "'Anchor Desktop-0.1.0-arm64-mac.zip', can also match that glob and sort"
  echo "before the real one, silently uploading the wrong build. Delete any old"
  echo "files under release/ before rebuilding if you're not sure which is current.)"
  exit 1
fi

echo "Found build: $ZIP_PATH ($(du -h "$ZIP_PATH" | cut -f1))"

# Asks the website for a short-lived upload URL (body: JSON naming the
# file). Retries for a few minutes if the site is briefly unavailable, e.g.
# restarting for a deploy pushed at the same moment as this build; stops
# straight away on a real refusal like a wrong upload secret. Prints the
# URL, or nothing if it never got one (the last response goes to stderr).
request_upload_url() {
  local body="$1" response url attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    response=$(curl -sS -m 60 -X POST "$ANCHOR_WEB_BASE/api/admin/desktop-app/upload-url" \
      -H "Content-Type: application/json" \
      -H "x-upload-secret: $DESKTOP_APP_UPLOAD_SECRET" \
      -d "$body" 2>&1 || true)
    url=$(echo "$response" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('uploadUrl', ''))" 2>/dev/null || echo "")
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
UPLOAD_URL=$(request_upload_url '{"platform":"mac"}') || exit 1

echo "Uploading to R2 …"
curl -sS --fail --retry 3 -X PUT "$UPLOAD_URL" \
  -H "Content-Type: application/zip" \
  --data-binary "@$ZIP_PATH" \
  --progress-bar

echo ""
echo "Done. The download button on the Integrations page (and"
echo "$ANCHOR_WEB_BASE/api/download/desktop-app/mac directly) will now serve this build."

# Also publish the update feed (latest-mac.yml) electron-builder generated
# right alongside the zip — this is what lets ALREADY-INSTALLED copies of
# the app (that have the auto-update code) discover this build on their
# own, via autoUpdater.checkForUpdates(). Skip silently if it's missing —
# older builds made before the auto-update feature won't have one.
YML_PATH="release/latest-mac.yml"
if [ -f "$YML_PATH" ]; then
  echo ""
  echo "Publishing update feed ($YML_PATH) …"
  YML_UPLOAD_URL=$(request_upload_url '{"file":"latest-mac.yml"}') || exit 1
  curl -sS --fail --retry 3 -X PUT "$YML_UPLOAD_URL" \
    -H "Content-Type: text/yaml" \
    --data-binary "@$YML_PATH" \
    --progress-bar
  echo ""
  echo "Update feed published. Installed copies of the app will pick this up on their next auto-update check."
else
  echo ""
  echo "No $YML_PATH found — skipping update-feed publish (this build wasn't made with npm run dist:mac after the auto-update feature shipped)."
fi
