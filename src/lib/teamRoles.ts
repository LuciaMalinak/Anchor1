import { isAppOwner } from "./appOwner";

// Who leads a team, for settings only leaders see (Your Anchor: the
// team's specialty and company context). The team owner always does, and
// so does anyone whose title on their profile is a leadership one: CEO,
// founder, managing partner, managing director, president, principal…
const LEADER_TITLE =
  /\b(ceo|coo|cfo|cto|cro|chief|founder|co-?founder|president|chair(man|woman|person)?|managing (partner|director|principal)|partner|principal|owner|head of|general partner)\b/i;

export function isTeamLeader(
  user: { id: string; title?: string | null; email?: string | null },
  team: { ownerUserId: string | null } | null | undefined
): boolean {
  if (team?.ownerUserId === user.id) return true;
  if (user.title && LEADER_TITLE.test(user.title)) return true;
  return isAppOwner(user.email);
}
