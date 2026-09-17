import bcrypt from "bcryptjs";

// Password hashing — used both when someone sets/changes their password
// and when they sign in with one. 10 rounds is bcrypt's common default:
// slow enough to resist brute-forcing, fast enough not to be felt here.
const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// The session cookie Auth.js reads is written by its own code for every
// sign-in method except this app's own password-sign-in route (see
// src/app/api/auth/password-sign-in/route.ts), which sets it by hand so it
// can vary the cookie's lifetime by "stay signed in" — something Auth.js's
// static config can't do per sign-in. To be recognized by auth.ts on the
// next request, that cookie has to match Auth.js's own name and secure-flag
// logic exactly (see @auth/core's defaultCookies + next-auth's env.js):
// the "__Secure-" prefix (and the `secure` flag) turn on together, based on
// whether AUTH_URL/NEXTAUTH_URL is an https:// URL — not the raw request,
// which can look like plain http behind Render's proxy.
// Named to avoid the "use..." prefix — that naming pattern makes ESLint's
// react-hooks plugin mistake a plain function for a custom Hook (and then
// flag ordinary code that calls it, like a Date.now() read in an API
// route, as if it were impure component-render code).
export function secureCookiesEnabled(): boolean {
  const url = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  return url.startsWith("https://");
}

export function sessionCookieName(): string {
  return `${secureCookiesEnabled() ? "__Secure-" : ""}authjs.session-token`;
}
