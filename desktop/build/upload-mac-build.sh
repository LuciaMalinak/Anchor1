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

ZIP_PATH=$(ls release/*-mac.zip 2>/dev/null | head -1)
if [ -z "$ZIP_PATH" ]; then
  echo "No .../release/*-mac.zip found. Build it first:"
  echo "  npm run dist:mac"
  exit 1
fi

echo "Found build: $ZIP_PATH ($(du -h "$ZIP_PATH" | cut -f1))"

echo "Asking $ANCHOR_WEB_BASE for an upload URL …"
RESPONSE=$(curl -sS -X POST "$ANCHOR_WEB_BASE/api/admin/desktop-app/upload-url" \
  -H "Content-Type: application/json" \
  -H "x-upload-secret: $DESKTOP_APP_UPLOAD_SECRET" \
  -d '{"platform":"mac"}')

UPLOAD_URL=$(echo "$RESPONSE" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('uploadUrl', ''))" 2>/dev/null || echo "")

if [ -z "$UPLOAD_URL" ]; then
  echo "Didn't get an upload URL back. Response was:"
  echo "$RESPONSE"
  exit 1
fi

echo "Uploading to R2 …"
curl -sS -X PUT "$UPLOAD_URL" \
  -H "Content-Type: application/zip" \
  --data-binary "@$ZIP_PATH" \
  --progress-bar

echo ""
echo "Done. The download button on the Integrations page (and"
echo "$ANCHOR_WEB_BASE/api/download/desktop-app/mac directly) will now serve this build."
