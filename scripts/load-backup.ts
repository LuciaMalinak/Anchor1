// Loads one of Anchor's nightly backups (src/lib/backup.ts) into a database,
// so lost data can be recreated from any past day.
//
// Usage (DATABASE_URL = an EMPTY database to load into, never the live one):
//   DATABASE_URL=postgres://... npx tsx scripts/load-backup.ts backups/anchor-2026-11-10.json.gz
//     (an R2 key: needs the R2_* settings), or a local .json.gz file path.
//
// It creates Anchor's tables (the same startup migrations the app runs),
// then inserts every row of the backup. Rows are copied by column name and
// only added (ON CONFLICT DO NOTHING); tables are retried in passes so rows
// that point at other tables land once those exist. Afterwards, point
// RESTORE_DATABASE_URL at this database and use Actions -> Restore deals
// from backup to put a person's missing data back into the live database.
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

async function main() {
  const source = process.argv[2];
  if (!source || !process.env.DATABASE_URL) {
    console.error("Usage: DATABASE_URL=<empty database> npx tsx scripts/load-backup.ts <R2 key or local .json.gz>");
    process.exit(1);
  }
  const { rawClient } = await import("../src/db");
  const [{ n }] = await rawClient<{ n: number }[]>`
    select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'user'`;
  if (n) {
    const [{ users }] = await rawClient.unsafe(`select count(*)::int as users from "user"`);
    if (users > 0) {
      console.error(`This database already has ${users} users. Load backups only into an EMPTY database.`);
      process.exit(1);
    }
  }

  let gz: Buffer;
  if (source.startsWith("backups/")) {
    const { r2Get } = await import("../src/lib/r2");
    const data = await r2Get(source);
    if (!data) throw new Error(`No backup found in R2 at ${source}`);
    gz = data;
  } else {
    gz = await readFile(source);
  }
  const backup = JSON.parse(gunzipSync(gz).toString("utf8")) as { createdAt: string; tables: Record<string, Record<string, unknown>[]> };
  console.log(`Backup from ${backup.createdAt}: ${Object.keys(backup.tables).length} tables`);

  const { runStartupMigrations } = await import("../src/lib/startupMigrations");
  await runStartupMigrations();

  const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const liveColumns = async (table: string) =>
    (await rawClient<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`).map((r) => r.column_name);

  // Foreign-key columns per table. Tables point at each other in circles
  // (a user's team, a team's owner), so rows go in first with their
  // optional links left empty, and the links are filled in afterwards.
  const fkRows = await rawClient<{ table_name: string; column_name: string; is_nullable: string }[]>`
    select kcu.table_name, kcu.column_name, c.is_nullable
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.columns c on c.table_schema = kcu.table_schema and c.table_name = kcu.table_name and c.column_name = kcu.column_name
    where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'`;
  const optionalLinks = new Map<string, Set<string>>();
  for (const r of fkRows) {
    if (r.is_nullable !== "YES") continue;
    if (!optionalLinks.has(r.table_name)) optionalLinks.set(r.table_name, new Set());
    optionalLinks.get(r.table_name)!.add(r.column_name);
  }
  const pkRows = await rawClient<{ table_name: string; column_name: string }[]>`
    select kcu.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'`;
  const primaryKey = new Map<string, string[]>();
  for (const r of pkRows) primaryKey.set(r.table_name, [...(primaryKey.get(r.table_name) ?? []), r.column_name]);

  // Pass 1: every row, optional links empty. Required links still need the
  // row they point at, so tables are retried until no more progress.
  let pending = Object.entries(backup.tables).filter(([, rows]) => rows.length > 0);
  const loaded: Record<string, number> = {};
  for (let pass = 1; pass <= 8 && pending.length; pass++) {
    const failed: typeof pending = [];
    let lastError = "";
    for (const [table, rows] of pending) {
      const cols = await liveColumns(table);
      if (cols.length === 0) {
        await rawClient.unsafe(`create table if not exists ${q(table)} (data jsonb)`);
        console.warn(`  ${table}: not in today's schema; kept as raw JSON rows`);
        await rawClient.unsafe(`insert into ${q(table)} (data) select * from jsonb_array_elements($1::jsonb)`, [JSON.stringify(rows)]);
        loaded[table] = rows.length;
        continue;
      }
      const skip = optionalLinks.get(table) ?? new Set<string>();
      const canFillLater = (primaryKey.get(table) ?? []).length > 0;
      const use = Object.keys(rows[0]).filter((c) => cols.includes(c) && !(canFillLater && skip.has(c)));
      const list = use.map(q).join(", ");
      try {
        const res = await rawClient.unsafe(
          `insert into ${q(table)} (${list}) select ${list} from jsonb_populate_recordset(null::${q(table)}, $1::jsonb) on conflict do nothing`,
          [JSON.stringify(rows)]
        );
        loaded[table] = (loaded[table] ?? 0) + res.count;
      } catch (err) {
        failed.push([table, rows]);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    if (failed.length === pending.length) {
      for (const [table] of failed) console.error(`  ${table}: couldn't be loaded (${lastError})`);
      break;
    }
    pending = failed;
  }

  // Pass 2: fill in the optional links, matching rows by primary key.
  for (const [table, rows] of Object.entries(backup.tables)) {
    const links = [...(optionalLinks.get(table) ?? [])].filter((c) => rows.length && c in rows[0]);
    const pk = primaryKey.get(table) ?? [];
    if (!links.length || !pk.length || !loaded[table]) continue;
    const set = links.map((c) => `${q(c)} = src.${q(c)}`).join(", ");
    const match = pk.map((c) => `t.${q(c)} = src.${q(c)}`).join(" and ");
    try {
      await rawClient.unsafe(
        `update ${q(table)} t set ${set} from jsonb_populate_recordset(null::${q(table)}, $1::jsonb) src where ${match}`,
        [JSON.stringify(rows)]
      );
    } catch (err) {
      console.error(`  ${table}: links couldn't be restored (${err instanceof Error ? err.message : err})`);
    }
  }
  for (const [table, count] of Object.entries(loaded)) console.log(`  ${table}: ${count} rows`);
  console.log("Done.");
  await rawClient.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
