import postgres from "postgres";
import { rawClient } from "@/db";
import { logDataChange } from "@/lib/dataChangeLog";

// Puts a person's lost deals back from a recovered copy of the database
// (Render point-in-time recovery, connected as RESTORE_DATABASE_URL).
//
// Only adds what's missing: deals on the person's team in the copy that
// don't exist in the live database, every row in any table with a "dealId"
// column that belongs to those deals (tasks, notes, files, deal memory,
// reports, members...), and the link from the person's calls back to
// those deals. Nothing that exists live is changed or overwritten: inserts
// use ON CONFLICT DO NOTHING, and calls are only re-linked while unlinked.
// Columns are copied by name, so the copy may be older than the live
// schema (newer columns take their defaults).

type Row = Record<string, unknown>;
type Sql = postgres.Sql;

export type RestorePlan = {
  copyTakenOf: string | null;
  // What the copy holds, to tell a real recovered copy from an empty or
  // wrong database: row counts and the newest activity in it (roughly the
  // moment it's a copy of).
  copy: { users: number; teams: number; deals: number; meetings: number; newestActivity: string | null; personFound: boolean };
  team: string | null;
  deals: { id: string; name: string; stage: string | null; created: string | null }[];
  rowsByTable: Record<string, number>;
  callsToRelink: number;
};

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

// Tables (other than the deal table itself and calls, which are re-linked
// rather than copied) that hold rows belonging to a deal.
async function dealTables(sql: Sql): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
    where c.table_schema = 'public' and c.column_name = 'dealId' and t.table_type = 'BASE TABLE'
      and c.table_name not in ('deal', 'meeting', 'data_change_log')
    order by c.table_name`;
  return rows.map((r) => r.table_name);
}

async function columns(sql: Sql, table: string): Promise<string[]> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`;
  return rows.map((r) => r.column_name);
}

async function findPerson(copy: Sql, userId: string) {
  const [inCopy] = await copy<{ teamId: string | null }[]>`select "teamId" from "user" where id = ${userId}`;
  const [live] = await rawClient<{ teamId: string | null }[]>`select "teamId" from "user" where id = ${userId}`;
  return { copyTeamId: inCopy?.teamId ?? live?.teamId ?? null, liveTeamId: live?.teamId ?? null };
}

async function missingDeals(copy: Sql, copyTeamId: string): Promise<Row[]> {
  const inCopy = await copy<Row[]>`select * from "deal" where "teamId" = ${copyTeamId}`;
  if (inCopy.length === 0) return [];
  const ids = inCopy.map((d) => d.id as string);
  const live = await rawClient<{ id: string }[]>`select id from "deal" where id = any(${ids}::uuid[])`;
  const have = new Set(live.map((d) => d.id));
  return inCopy.filter((d) => !have.has(d.id as string));
}

function connect(): Sql {
  const url = process.env.RESTORE_DATABASE_URL;
  if (!url) throw new Error("RESTORE_DATABASE_URL isn't set: add the recovered database's Internal Database URL to the web service's Environment in Render.");
  return postgres(url, { max: 2, idle_timeout: 20 });
}

async function copyStats(copy: Sql, userId: string): Promise<RestorePlan["copy"]> {
  const count = async (table: string) => {
    try {
      const [{ n }] = await copy.unsafe(`select count(*)::int as n from ${q(table)}`);
      return n as number;
    } catch {
      return -1; // table missing: not an Anchor database
    }
  };
  const [users, teams, dealCount, meetingCount] = await Promise.all([count("user"), count("team"), count("deal"), count("meeting")]);
  let newestActivity: string | null = null;
  try {
    const [{ t }] = await copy<{ t: Date | null }[]>`
      select greatest((select max("updatedAt") from "meeting"), (select max("updatedAt") from "deal"), (select max("createdAt") from "user")) as t`;
    newestActivity = t ? new Date(t).toISOString() : null;
  } catch {
    newestActivity = null;
  }
  let personFound = false;
  try {
    personFound = (await copy`select 1 from "user" where id = ${userId}`).length > 0;
  } catch {
    personFound = false;
  }
  return { users, teams, deals: dealCount, meetings: meetingCount, newestActivity, personFound };
}

export async function planRestore(userId: string): Promise<RestorePlan> {
  const copy = connect();
  try {
    const { copyTeamId } = await findPerson(copy, userId);
    const stats = await copyStats(copy, userId);
    const now = stats.newestActivity;
    if (!copyTeamId) return { copyTakenOf: null, copy: stats, team: null, deals: [], rowsByTable: {}, callsToRelink: 0 };
    const [team] = await copy<{ name: string }[]>`select name from "team" where id = ${copyTeamId}`;
    const lost = await missingDeals(copy, copyTeamId);
    const ids = lost.map((d) => d.id as string);
    const rowsByTable: Record<string, number> = {};
    let callsToRelink = 0;
    if (ids.length) {
      for (const t of await dealTables(copy)) {
        const [{ n }] = await copy.unsafe(`select count(*)::int as n from ${q(t)} where "dealId" = any($1::uuid[])`, [ids]);
        if (n) rowsByTable[t] = n;
      }
      const calls = await copy<{ id: string }[]>`select id from "meeting" where "userId" = ${userId} and "dealId" = any(${ids}::uuid[])`;
      if (calls.length) {
        const [{ n }] = await rawClient<{ n: number }[]>`
          select count(*)::int as n from "meeting" where id = any(${calls.map((c) => c.id)}::uuid[]) and "dealId" is null`;
        callsToRelink = n;
      }
    }
    return {
      copyTakenOf: now,
      copy: stats,
      team: team?.name ?? null,
      deals: lost.map((d) => ({
        id: d.id as string,
        name: String(d.name),
        stage: (d.stage as string) ?? null,
        created: d.createdAt ? new Date(d.createdAt as string).toISOString().slice(0, 10) : null,
      })),
      rowsByTable,
      callsToRelink,
    };
  } finally {
    await copy.end({ timeout: 5 });
  }
}

// Copies rows by column name into the live table, skipping any that exist.
async function insertRows(tx: Sql, table: string, rows: Row[], liveCols: string[]): Promise<number> {
  if (rows.length === 0) return 0;
  const cols = Object.keys(rows[0]).filter((c) => liveCols.includes(c));
  const list = cols.map(q).join(", ");
  const res = await tx.unsafe(
    `insert into ${q(table)} (${list}) select ${list} from jsonb_populate_recordset(null::${q(table)}, $1::jsonb) on conflict do nothing`,
    [JSON.stringify(rows)]
  );
  return res.count;
}

export async function applyRestore(userId: string): Promise<{ deals: number; rows: Record<string, number>; callsRelinked: number }> {
  const copy = connect();
  try {
    const { copyTeamId, liveTeamId } = await findPerson(copy, userId);
    if (!copyTeamId || !liveTeamId) throw new Error("Couldn't find the person's team.");
    const lost = await missingDeals(copy, copyTeamId);
    const ids = lost.map((d) => d.id as string);
    if (ids.length === 0) return { deals: 0, rows: {}, callsRelinked: 0 };

    // Their team in the live database, if the copy's team id no longer exists there.
    const [teamLive] = await rawClient<{ id: string }[]>`select id from "team" where id = ${copyTeamId}`;
    const targetTeam = teamLive ? copyTeamId : liveTeamId;
    const deals = lost.map((d) => ({ ...d, teamId: targetTeam }));

    const children: { table: string; rows: Row[] }[] = [];
    for (const t of await dealTables(copy)) {
      const rows = (await copy.unsafe(`select * from ${q(t)} where "dealId" = any($1::uuid[])`, [ids])) as Row[];
      if (rows.length) children.push({ table: t, rows: rows.map((r) => ("teamId" in r ? { ...r, teamId: targetTeam } : r)) });
    }
    const calls = await copy<{ id: string; dealId: string }[]>`
      select id, "dealId" from "meeting" where "userId" = ${userId} and "dealId" = any(${ids}::uuid[])`;

    const result = { deals: 0, rows: {} as Record<string, number>, callsRelinked: 0 };
    await rawClient.begin(async (tx) => {
      result.deals = await insertRows(tx as unknown as Sql, "deal", deals, await columns(tx as unknown as Sql, "deal"));
      // A child table can point at another child table; retry until no
      // more progress (savepoints keep one failure from aborting the rest).
      let pending = children;
      for (let pass = 0; pass < 4 && pending.length; pass++) {
        const failed: typeof pending = [];
        for (const c of pending) {
          try {
            const n = await tx.savepoint(async (sp) => insertRows(sp as unknown as Sql, c.table, c.rows, await columns(sp as unknown as Sql, c.table)));
            result.rows[c.table] = (result.rows[c.table] ?? 0) + n;
          } catch {
            failed.push(c);
          }
        }
        if (failed.length === pending.length) break;
        pending = failed;
      }
      for (const c of calls) {
        const res = await tx`update "meeting" set "dealId" = ${c.dealId} where id = ${c.id} and "dealId" is null`;
        result.callsRelinked += res.count;
      }
    });

    await logDataChange({
      action: "deals_restored_from_backup",
      teamId: targetTeam,
      targetId: userId,
      details: { deals: lost.map((d) => d.name), rows: result.rows, callsRelinked: result.callsRelinked },
    });
    return result;
  } finally {
    await copy.end({ timeout: 5 });
  }
}
