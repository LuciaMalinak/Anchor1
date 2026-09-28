// The app owner (Lucia, for now) can see and approve/decline requests to
// join ANY team in the system, not just her own — see
// src/lib/joinRequestAccess.ts, the only place this is checked.
// Comma-separated so more owner emails can be added later without a code
// change; defaults to Lucia's own email so this works out of the box.
export const APP_OWNER_EMAILS = (process.env.APP_OWNER_EMAILS ?? "lucia.malinak@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAppOwner(email: string | null | undefined): boolean {
  return Boolean(email && APP_OWNER_EMAILS.includes(email.toLowerCase()));
}
