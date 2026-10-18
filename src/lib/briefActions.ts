import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { morningBriefs } from "@/db/schema";
import { readBriefToken } from "@/lib/briefLink";
import { getBriefRow } from "@/lib/morningBrief";
import type { BriefEmail, BriefSnapshot, ShownState } from "@/lib/morningBriefRender";

// Shared by the Morning brief's one-click actions on a single email
// (add a suggested meeting to the calendar, decline it, save the reply to
// Gmail drafts): who is acting — from the brief's own link (token)
// without signing in, or signed in — and that email as saved in their
// latest brief. Requests only name the email; everything else comes from
// what Anchor saved.

export async function briefActor(token: unknown): Promise<string | null> {
  const fromToken = typeof token === "string" ? readBriefToken(token) : null;
  if (fromToken) return fromToken.userId;
  const session = await auth();
  return session?.user?.id ?? null;
}

export function validThreadId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(v) ? v : null;
}

export async function loadBriefEmail(userId: string, threadId: string) {
  const row = await getBriefRow(userId);
  const brief = (row?.lastBrief ?? null) as BriefSnapshot | null;
  const email = brief?.emails.find((e) => e.threadId === threadId) ?? null;
  const shown = { ...((row?.shown as ShownState) ?? {}) };
  return { brief, email, shown };
}

// Saves a change to one email in the latest brief (and what's remembered
// for its thread, so tomorrow's brief keeps it).
export async function saveBriefEmail(
  userId: string,
  brief: BriefSnapshot,
  shown: ShownState,
  threadId: string,
  change: { email?: Partial<BriefEmail>; shown?: Partial<ShownState[string]> }
) {
  const emails = brief.emails.map((e) => (e.threadId === threadId ? { ...e, ...change.email } : e));
  if (change.shown && shown[threadId]) shown[threadId] = { ...shown[threadId], ...change.shown };
  await db
    .update(morningBriefs)
    .set({ lastBrief: { ...brief, emails } as unknown as Record<string, unknown>, shown, updatedAt: new Date() })
    .where(eq(morningBriefs.userId, userId));
}

// "2026-10-22T10:00" in `timeZone` -> that moment in UTC.
export function zonedToUtc(local: string, timeZone: string): Date {
  const [d, t] = local.split("T");
  const [y, mo, day] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, day, h, mi);
  const offsetAt = (ms: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .formatToParts(new Date(ms))
        .map((p) => [p.type, p.value])
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - ms;
  };
  // Twice, so a time near a daylight-saving change lands right.
  let utc = asUtc - offsetAt(asUtc);
  utc = asUtc - offsetAt(utc);
  return new Date(utc);
}
