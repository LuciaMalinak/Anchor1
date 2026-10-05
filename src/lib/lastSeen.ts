import { db, rawClient } from "@/db";
import { memberLastSeen } from "@/db/schema";

// Records when a member last loaded the app (see memberLastSeen in
// schema.ts). Sign-in sessions can't answer that: they last 1 or 90 days
// depending on how someone signed in and aren't refreshed as they use the
// app, which made the admin pages show "1m ago" for people who hadn't
// been on in weeks.

// Created here on first use (IF NOT EXISTS, so it's harmless every time)
// instead of a manual migration step before deploying.
let ensured: Promise<void> | null = null;
export function ensureLastSeenTable(): Promise<void> {
  ensured ??= rawClient
    .unsafe(
      `CREATE TABLE IF NOT EXISTS "member_last_seen" (
        "userId" uuid PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
        "lastSeenAt" timestamp NOT NULL
      )`,
    )
    .then(
      () => {},
      (err) => {
        ensured = null; // Try again next time rather than staying broken.
        throw err;
      },
    );
  return ensured;
}

// One write per person every few minutes is plenty for "last used".
const WRITE_EVERY_MS = 5 * 60 * 1000;
const lastWrite = new Map<string, number>();

export async function recordSeen(userId: string): Promise<void> {
  const now = Date.now();
  if (now - (lastWrite.get(userId) ?? 0) < WRITE_EVERY_MS) return;
  lastWrite.set(userId, now);
  try {
    await ensureLastSeenTable();
    const at = new Date(now);
    await db
      .insert(memberLastSeen)
      .values({ userId, lastSeenAt: at })
      .onConflictDoUpdate({ target: memberLastSeen.userId, set: { lastSeenAt: at } });
  } catch (err) {
    // Never let this get in the way of loading the page.
    console.error("[lastSeen] couldn't record a visit:", err);
  }
}
