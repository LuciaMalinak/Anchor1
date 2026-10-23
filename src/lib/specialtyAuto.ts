import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { withAiUser } from "./aiUsage";
import { buildTeamSpecialty } from "./specialtyBuilder";

// Builds every team's specialty on its own: from the company website they
// give at sign-up, or failing that the domain of the owner's work email,
// in the background, so a new team finds "Anchor for <Company>" ready a
// minute later without clicking anything. Each team is tried once
// automatically (specialtyStatus); after that the owner can rebuild from
// the Team page.

// Personal email providers, whose domain says nothing about the company.
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "mail.com",
  "zoho.com", "yandex.com", "hey.com", "fastmail.com", "qq.com", "163.com", "web.de", "comcast.net", "att.net",
]);

export function websiteFromEmail(email: string | null | undefined): string | null {
  const domain = (email ?? "").split("@")[1]?.trim().toLowerCase();
  if (!domain || PERSONAL_DOMAINS.has(domain) || !domain.includes(".")) return null;
  return `https://${domain}`;
}

// A build that hasn't finished in this long is treated as lost (a restart
// mid-build) and can be started again.
const STALE_BUILD_MS = 10 * 60_000;

// Starts building in the background and returns straight away. Only one
// build per team at a time.
export async function startSpecialtyBuild(
  teamId: string,
  input: { website?: string | null; description?: string | null },
  userId: string
): Promise<boolean> {
  const claimed = await db
    .update(teams)
    .set({
      specialtyStatus: "building",
      specialtyRequestedAt: new Date(),
      specialtyError: null,
      ...(input.website ? { companyWebsite: input.website } : {}),
    })
    .where(
      and(
        eq(teams.id, teamId),
        or(
          isNull(teams.specialtyStatus),
          ne(teams.specialtyStatus, "building"),
          lt(teams.specialtyRequestedAt, new Date(Date.now() - STALE_BUILD_MS))
        )
      )
    )
    .returning({ id: teams.id });
  if (!claimed.length) return false;

  void withAiUser({ userId }, () => buildTeamSpecialty(teamId, input))
    .then(() => db.update(teams).set({ specialtyStatus: "ready" }).where(eq(teams.id, teamId)))
    .catch(async (err) => {
      console.error(`[specialty] building ${teamId} failed:`, err);
      // Shown to the team's leaders, so a failed build says why.
      const reason = err instanceof Error && err.message ? err.message : "Unknown error";
      await db.update(teams).set({ specialtyStatus: "failed", specialtyError: reason.slice(0, 300) }).where(eq(teams.id, teamId));
    });
  return true;
}

// The automatic first build: once per team, for its owner, when there's a
// website to go on (given at sign-up, or the owner's work email domain).
export async function ensureTeamSpecialty(teamId: string, ownerUserId: string, ownerEmail: string | null | undefined): Promise<void> {
  const [team] = await db
    .select({ specialty: teams.specialty, status: teams.specialtyStatus, website: teams.companyWebsite, ownerUserId: teams.ownerUserId })
    .from(teams)
    .where(eq(teams.id, teamId));
  if (!team || team.ownerUserId !== ownerUserId || team.specialty || team.status) return;
  const website = team.website ?? websiteFromEmail(ownerEmail);
  if (!website) return;
  await startSpecialtyBuild(teamId, { website }, ownerUserId);
}
