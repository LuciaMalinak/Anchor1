// A single, stable identifier for "which build of the website is currently
// running" — used only to detect when a NEWER deploy has gone live while
// someone still has an old tab open (see /api/version and
// components/UpdateBanner.tsx). Render sets RENDER_GIT_COMMIT automatically
// for every build and every running instance, so this changes exactly when
// a new deploy actually ships — no extra build step needed. Falls back to
// the package.json version for any environment that doesn't set it (local
// dev, this sandbox), which is stable across a dev session, so the banner
// simply never fires there — that's fine, it's a production-only concern.
import pkg from "../../package.json";

export function getAppVersion(): string {
  return process.env.RENDER_GIT_COMMIT || `dev-${pkg.version}`;
}
