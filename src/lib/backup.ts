import { gzipSync } from "node:zlib";
import { rawClient } from "@/db";
import { isR2Configured, r2Delete, r2ListKeys, r2Put } from "@/lib/r2";
import { APP_OWNER_EMAILS } from "@/lib/appOwner";
import { sendEmail } from "@/lib/email";

// A full copy of Anchor's database, once a day: every table, every row,
// as gzipped JSON in the R2 bucket (backups/anchor-YYYY-MM-DD.json.gz).
// It's a safety net independent of the database host, so a lost database,
// a bad change or a mistaken deletion can always be put back. Runs from
// the server's own schedule (instrumentation.ts) and /api/cron/backup.
// Copies are kept for BACKUP_KEEP_DAYS (35 by default), then deleted, so
// data a client deleted (or that automatic deletion removed, see
// retention.ts) doesn't live on in old backups indefinitely. Within that
// window any day can be recreated (scripts/load-backup.ts loads one into
// a database; /api/cron/restore-deals copies from it). If backups stop,
// the owner gets an email (backupAlertIfDue below).

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
    const pruned = await pruneOldBackups().catch((err) => {
      console.error("[backup] couldn't delete old backups:", err);
      return 0;
    });
    if (pruned) console.log(`[backup] deleted ${pruned} backup(s) older than ${BACKUP_KEEP_DAYS} days`);
    return record({ ok: true, key, bytes: gz.length, tables: tables.length, rows });
  } catch (err) {
    console.error("[backup] failed:", err);
    return record({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export const BACKUP_KEEP_DAYS = Math.max(7, Number(process.env.BACKUP_KEEP_DAYS) || 35);
// However old, the newest few are always kept, so a long stretch without
// backups never leaves none at all.
const ALWAYS_KEEP_NEWEST = 7;

// Which backup keys are past BACKUP_KEEP_DAYS, never touching the newest
// few or anything that isn't a dated daily backup.
export function backupsToDelete(keys: string[], now = Date.now(), keepDays = BACKUP_KEEP_DAYS): string[] {
  const dated = keys
    .map((key) => ({ key, day: /^backups\/anchor-(\d{4}-\d{2}-\d{2})\.json\.gz$/.exec(key)?.[1] }))
    .filter((k): k is { key: string; day: string } => Boolean(k.day))
    .sort((a, b) => b.day.localeCompare(a.day));
  const cutoffDay = new Date(now - keepDays * 86_400_000).toISOString().slice(0, 10);
  return dated
    .slice(ALWAYS_KEEP_NEWEST)
    .filter((k) => k.day < cutoffDay)
    .map((k) => k.key);
}

// Deletes backups older than BACKUP_KEEP_DAYS. Only called right after a
// successful backup. Returns how many were deleted.
export async function pruneOldBackups(): Promise<number> {
  const old = backupsToDelete((await r2ListKeys("backups/")).map((k) => k.key));
  for (const key of old) await r2Delete(key);
  return old.length;
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

// Emails the owner, at most once a day, when there's been no successful
// backup for more than 26 hours (or backups were never set up), so a
// stopped backup is noticed the same day instead of when it's needed.
const ALERT_AFTER_MS = 26 * 3600_000;
const ALERT_EVERY_MS = 24 * 3600_000;

export async function backupAlertIfDue(): Promise<boolean> {
  await ensureLogTable();
  await rawClient.unsafe(`CREATE TABLE IF NOT EXISTS "backup_alert" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "createdAt" timestamp NOT NULL DEFAULT now())`);
  const lastOk = await lastSuccessfulBackupAt();
  if (lastOk && Date.now() - lastOk.getTime() < ALERT_AFTER_MS) return false;
  const [alerted] = await rawClient<{ createdAt: Date }[]>`select "createdAt" from "backup_alert" order by "createdAt" desc limit 1`;
  if (alerted && Date.now() - alerted.createdAt.getTime() < ALERT_EVERY_MS) return false;
  if (APP_OWNER_EMAILS.length === 0) return false;
  const last = await lastBackup();
  const reason = !isR2Configured()
    ? "File storage isn't set up, so no backups are being made. Add the four R2_* settings to the web service's Environment in Render."
    : `The last attempt failed: ${last?.error ?? "unknown error"}.`;
  await rawClient`insert into "backup_alert" default values`;
  await sendEmail({
    to: APP_OWNER_EMAILS,
    subject: "Anchor.AI: client data isn't being backed up",
    html: `<p>Anchor.AI hasn't made a successful backup ${lastOk ? `since <strong>${lastOk.toISOString().slice(0, 16).replace("T", " ")} UTC</strong>` : "<strong>yet</strong>"}.</p>
      <p>${reason}</p>
      <p>Backups are the copy of every client's data kept outside the database, so it can always be recreated. Anchor.AI tries again every hour and will email you again tomorrow if it still can't.</p>`,
  }).catch((err) => console.error("[backup] alert email failed:", err));
  return true;
}
