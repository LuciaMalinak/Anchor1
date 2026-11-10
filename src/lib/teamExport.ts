import { rawClient } from "@/db";

// "Download all our data" for a team owner (Team page): everything the
// team has in Anchor.AI as one JSON file — deals, contacts, meetings with
// transcripts and summaries, tasks, notes, messages, files' details and
// so on. Works off the live table list, so new tables are included
// automatically: a table is exported when it can be tied to this team by a
// teamId, dealId, meetingId, contactId or userId column. Sign-in secrets,
// connection tokens and Anchor.AI's own internal records are left out.

// Never exported: credentials and tokens, and Anchor.AI's internal tables.
const EXCLUDED = new Set([
  "account",
  "session",
  "verificationToken",
  "api_token",
  "integration_connection",
  "sign_in_failure",
  "linkedin_bot",
  "linkedin_bot_item",
  "promo_code",
  "admin_access_log",
  "ai_usage",
  "member_last_seen",
  "backup_run",
  "backup_alert",
  "sales_lead",
]);

// Secret columns dropped from any table that has them.
const SECRET_COLUMNS = new Set(["passwordHash", "twoFactorSecret", "twoFactorRecoveryHashes", "stripeCustomerId", "stripeSubscriptionId"]);

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function exportTeamData(teamId: string) {
  const [team] = await rawClient<{ name: string }[]>`select "name" from "team" where "id" = ${teamId}`;
  if (!team) throw new Error("Team not found");
  const userIds = (await rawClient<{ id: string }[]>`select "id" from "user" where "teamId" = ${teamId}`).map((r) => r.id);
  const dealIds = (await rawClient<{ id: string }[]>`select "id" from "deal" where "teamId" = ${teamId}`).map((r) => r.id);
  const meetingIds = (
    await rawClient<{ id: string }[]>`
      select "id" from "meeting"
      where "dealId" = any(${dealIds}::uuid[]) or ("dealId" is null and "userId" = any(${userIds}::uuid[]))`
  ).map((r) => r.id);
  const contactIds = (await rawClient<{ id: string }[]>`select "id" from "contact" where "userId" = any(${userIds}::uuid[])`).map(
    (r) => r.id
  );

  const columns = await rawClient<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' order by table_name, ordinal_position`;
  const byTable = new Map<string, string[]>();
  for (const c of columns) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);

  const tables: Record<string, unknown[]> = {};
  for (const [table, cols] of byTable) {
    if (EXCLUDED.has(table)) continue;
    const keep = cols.filter((c) => !SECRET_COLUMNS.has(c));
    const select = `select ${keep.map(q).join(", ")} from ${q(table)}`;
    let where: string | null = null;
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (table === "team") where = `"id" = ${p(teamId)}`;
    else if (table === "user") where = `"id" = any(${p(userIds)}::uuid[])`;
    else if (table === "meeting") where = `"id" = any(${p(meetingIds)}::uuid[])`;
    else if (cols.includes("teamId")) where = `"teamId" = ${p(teamId)}`;
    else {
      // Any link to this team's deals, meetings, contacts or people, but
      // never a row that belongs to another team's deal.
      const links: string[] = [];
      if (cols.includes("dealId")) links.push(`"dealId" = any(${p(dealIds)}::uuid[])`);
      if (cols.includes("meetingId")) links.push(`"meetingId" = any(${p(meetingIds)}::uuid[])`);
      if (cols.includes("contactId")) links.push(`"contactId" = any(${p(contactIds)}::uuid[])`);
      if (cols.includes("userId")) links.push(`"userId" = any(${p(userIds)}::uuid[])`);
      if (links.length === 0) continue;
      where = `(${links.join(" or ")})`;
      if (cols.includes("dealId")) where += ` and ("dealId" is null or "dealId" = any(${p(dealIds)}::uuid[]))`;
    }
    const rows = await rawClient.unsafe(`${select} where ${where}`, params as never[]);
    if (rows.length) tables[table] = [...rows];
  }

  return {
    exportedAt: new Date().toISOString(),
    team: team.name,
    about:
      "Everything your team has in Anchor.AI. Each section is one kind of record (deal, contact, meeting, transcript, summary, task, …). Uploaded files and call recordings are listed here; email lucia@anchortechnolgies.com for a copy of the files themselves.",
    tables,
  };
}
