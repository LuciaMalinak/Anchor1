#!/bin/bash
# One-time setup: creates a self-signed, LOCAL-ONLY code-signing
# certificate in your Mac's login keychain, so Anchor Desktop gets a
# STABLE signing identity across rebuilds instead of a new ad-hoc
# identity every single time.
#
# Why this matters: without a paid Apple Developer ID certificate, the
# build signs with codesign's ad-hoc shorthand ("-"), which has no
# certificate behind it at all — its "identity" is really just a hash of
# that exact build's bytes, different every time you rebuild. macOS ties
# Accessibility and Screen Recording grants to that identity, so every
# rebuild silently un-grants both, even though the app itself is fine —
# you have to re-grant them in System Settings after every single build.
# A real certificate (even one you generate yourself, never seen by Apple
# or anyone else) gives the app one STABLE identity across every future
# build, so a grant made once keeps working from then on.
#
# This script:
#   - touches ONLY your own login keychain (never the System keychain,
#     never any system-wide trust setting)
#   - creates a certificate that is useless for anything except signing
#     your own local builds of this one app — it doesn't chain to any
#     Certificate Authority, isn't trusted by Safari/TLS/anything else,
#     and can't be used to impersonate Apple or sign anyone else's app
#   - is exactly the same kind of thing Xcode generates automatically
#     for you the first time you build any app from a fresh install
#   - is safe to re-run — if the certificate already exists, it does
#     nothing and just confirms that
#
# Run it once:  bash desktop/build/create-local-signing-cert.sh
# Then rebuild the app as usual (npm run dist:mac) — build/afterSign.js
# automatically detects and uses this certificate once it exists, no
# further changes needed.

set -e

CERT_NAME="Anchor Desktop Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
WORKDIR=$(mktemp -d)
cd "$WORKDIR"

echo "Checking for an existing certificate named \"$CERT_NAME\" …"
if security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | grep -q "$CERT_NAME"; then
  echo "Already exists — nothing to do. Just rebuild the app (npm run dist:mac) and it'll be used automatically."
  cd - > /dev/null
  rm -rf "$WORKDIR"
  exit 0
fi

echo "Generating a new local self-signed code-signing certificate …"
openssl req -new -x509 -newkey rsa:2048 -keyout anchor.key -out anchor.crt \
  -days 3650 -nodes -subj "/CN=$CERT_NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"

openssl pkcs12 -export -out anchor.p12 -inkey anchor.key -in anchor.crt -passout pass:anchor

echo "Importing into your login keychain — macOS may ask for your Mac login password, that's expected …"
security import anchor.p12 -k "$KEYCHAIN" -P "anchor" -T /usr/bin/codesign -T /usr/bin/security

echo "Marking it trusted for code signing on this Mac …"
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" anchor.crt || \
  echo "(That step reported an issue, but codesign usually still works without it — we'll find out on the next build either way.)"

cd - > /dev/null
rm -rf "$WORKDIR"

echo ""
echo "Verifying …"
if security find-identity -v -p codesigning "$KEYCHAIN" | grep -q "$CERT_NAME"; then
  echo "Done — \"$CERT_NAME\" is ready. Your next build (npm run dist:mac) will use it automatically, and Accessibility/Screen Recording grants should survive future rebuilds from here on."
else
  echo "Couldn't confirm the certificate landed correctly — open Keychain Access and look for \"$CERT_NAME\" under My Certificates, or just tell Claude what you see and we'll sort it out."
fi
