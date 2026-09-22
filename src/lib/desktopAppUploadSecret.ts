// Authorizes replacing the Anchor Desktop installer everyone downloads —
// deliberately NOT following the RECALL_WEBHOOK_SECRET pattern elsewhere
// in this codebase (a hardcoded fallback value baked into source). A
// leaked or guessable secret here would let someone swap out the file
// every teammate's computer downloads and runs, so this requires a real
// secret set only in Render's environment; with nothing set, uploading a
// new build is simply impossible rather than falling back to a known
// value. Generate one with `openssl rand -hex 32` and set it as
// DESKTOP_APP_UPLOAD_SECRET in Render — never commit the value itself.
export function getDesktopAppUploadSecret(): string | null {
  const secret = process.env.DESKTOP_APP_UPLOAD_SECRET;
  return secret && secret.length >= 20 ? secret : null;
}
