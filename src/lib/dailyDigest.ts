import { db } from "@/db";
import { announcements, users } from "@/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { getHomeUpdates } from "@/lib/homeFeed";

const LOOKBACK_HOURS = 24;

// The text-message twin of the Home dashboard's "Latest updates" +
// "From leadership" panels — same underlying data (getHomeUpdates,
// announcements), just windowed to the last day and written as plain
// SMS text instead of a clickable feed. Returns null when there's
// nothing to say, so the daily send skips texting someone "nothing
// happened" every single morning.
export async function buildDailyDigestText(params: {
  teamId: string;
  teamName: string;
}): Promise<string | null> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const [recentAnnouncements, updates] = await Promise.all([
    db
      .select({ content: announcements.content, createdAt: announcements.createdAt, author: users })
      .from(announcements)
      .innerJoin(users, eq(announcements.authorUserId, users.id))
      .where(and(eq(announcements.teamId, params.teamId), gte(announcements.createdAt, since)))
      .orderBy(desc(announcements.createdAt)),
    getHomeUpdates({ teamId: params.teamId, limit: 20 }),
  ]);

  const recentUpdates = updates.filter((u) => new Date(u.at).getTime() >= since.getTime());

  if (recentAnnouncements.length === 0 && recentUpdates.length === 0) {
    return null;
  }

  const lines: string[] = [`Good morning — here's what's new on ${params.teamName}:`];

  if (recentAnnouncements.length > 0) {
    lines.push("");
    lines.push("From leadership:");
    for (const a of recentAnnouncements) {
      const author = a.author.name || a.author.email;
      lines.push(`- ${a.content} (${author})`);
    }
  }

  if (recentUpdates.length > 0) {
    lines.push("");
    lines.push("Deal activity:");
    for (const u of recentUpdates) {
      lines.push(`- ${u.text}`);
    }
  }

  if (process.env.AUTH_URL) {
    lines.push("");
    lines.push(`Open Anchor: ${process.env.AUTH_URL}/dashboard`);
  }

  return lines.join("\n");
}
