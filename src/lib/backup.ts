import { gzipSync } from "node:zlib";
import { rawClient } from "@/db";
import { isR2Configured, r2Delete, r2Put } from "@/lib/r2";

// A full copy of Anchor's database, once a day: every table, every row,
// as gzipped JSON in the R2 bucket (backups/anchor-YYYY-MM-DD.json.gz).
// It's a safety net independent of the database host, so a lost database,
// a bad change or a mistaken deletion can always be put back. Runs from
// the server's own schedule (instrumentation.ts) and /api/cron/backup.
// Copies are kept for KEEP_DAYS (the Privacy Policy says up to 30 days).

const KEEP_DAYS = 30;

// Removes the copies that have aged out. Backups are named by date, so the
// ones from just past the window are deleted by name; a missed day is still
// caught by a later run because the sweep covers another 30 days back.
async function removeOldBackups(now: Date): Promise<void> {
  for (let age = KEEP_DAYS + 1; age <= KEEP_DAYS * 2; age++) {
    const day = new Date(now.getTime() - age * 86_400_000).toISOString().slice(0, 10);
    await r2Delete(`backups/anchor-${day}.json.gz`).catch(() => {});
  }
}

export type BackupResult = { ok: boolean; key?: string; bytes?: number; tables?: number; rows?: number; error?: string };

async function ensureLogTable() {
  await rawClient.unsafe(`CREATE TABLE IF NOT EXISTS "backup_run" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "ok" boolean NOT NULL,
    "key" text,
    "bytes" bigint,
    "tables" integer,
    "rows" integer,
    "error" text,
    "createdAt" timestamp NOT NULL DEFAULT now()
  )`);
}

export async function lastBackup(): Promise<{ ok: boolean; key: string | null; bytes: number | null; error: string | null; createdAt: Date } | null> {
  await ensureLogTable();
  const [row] = await rawClient<{ ok: boolean; key: string | null; bytes: string | null; error: string | null; createdAt: Date }[]>`
    select "ok", "key", "bytes", "error", "createdAt" from "backup_run" order by "createdAt" desc limit 1`;
  return row ? { ...row, bytes: row.bytes === null ? null : Number(row.bytes) } : null;
}

export async function lastSuccessfulBackupAt(): Promise<Date | null> {
  await ensureLogTable();
  const [row] = await rawClient<{ createdAt: Date }[]>`
    select "createdAt" from "backup_run" where "ok" order by "createdAt" desc limit 1`;
  return row?.createdAt ?? null;
}

export async function runBackup(): Promise<BackupResult> {
  await ensureLogTable();
  const record = async (r: BackupResult) => {
    await rawClient`insert into "backup_run" ("ok", "key", "bytes", "tables", "rows", "error")
      values (${r.ok}, ${r.key ?? null}, ${r.bytes ?? null}, ${r.tables ?? null}, ${r.rows ?? null}, ${r.error ?? null})`;
    return r;
  };
  if (!isR2Configured()) {
    return record({ ok: false, error: "Backups need file storage (the R2_* settings in Render)." });
  }
  try {
    const tables = await rawClient<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`;
    const data: Record<string, unknown[]> = {};
    let rows = 0;
    for (const { table_name } of tables) {
      const result = await rawClient.unsafe(`select * from "${table_name.replace(/"/g, '""')}"`);
      data[table_name] = [...result];
      rows += result.length;
    }
    const json = Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), tables: data }));
    const gz = gzipSync(json);
    const key = `backups/anchor-${new Date().toISOString().slice(0, 10)}.json.gz`;
    await r2Put(key, gz, "application/gzip");
    await removeOldBackups(new Date()).catch((err) => console.error("[backup] removing old copies failed:", err));
    return record({ ok: true, key, bytes: gz.length, tables: tables.length, rows });
  } catch (err) {
    console.error("[backup] failed:", err);
    return record({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// For the server's own schedule: one backup a day.
// Skipped while storage isn't set up, and retried at most hourly after a
// failure, so the log isn't flooded.
export async function runBackupIfDue(): Promise<BackupResult | null> {
  if (!isR2Configured()) return null;
  const lastOk = await lastSuccessfulBackupAt();
  if (lastOk && Date.now() - lastOk.getTime() < 23 * 3600_000) return null;
  const last = await lastBackup();
  if (last && !last.ok && Date.now() - last.createdAt.getTime() < 3600_000) return null;
  return runBackup();
}
