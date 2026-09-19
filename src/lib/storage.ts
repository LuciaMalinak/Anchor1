import fs from "fs/promises";
import path from "path";
import { isR2Configured, r2Put, r2Get, r2Delete, r2DeletePrefix, r2FirstKey } from "./r2";

// Local disk storage — the original MVP-only implementation. Fine for one
// server instance, but does NOT survive a redeploy or restart on Render's
// free tier (no persistent disk), which is why every function below
// prefers R2 (see r2.ts) whenever it's configured and only falls back to
// this when it isn't. Swapping this out entirely once R2 is always
// configured is a natural follow-up cleanup.
const STORAGE_ROOT = path.join(process.cwd(), "storage", "meetings");
const AVATAR_STORAGE_ROOT = path.join(process.cwd(), "storage", "avatars");
const DEAL_STORAGE_ROOT = path.join(process.cwd(), "storage", "deals");

const EXT_TO_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function contentTypeFor(fileName: string): string | undefined {
  return EXT_TO_TYPE[path.extname(fileName).toLowerCase()];
}

export async function saveMeetingAudio(
  meetingId: string,
  fileName: string,
  data: Buffer
): Promise<string> {
  if (isR2Configured()) {
    const key = `meetings/${meetingId}/${fileName}`;
    await r2Put(key, data, contentTypeFor(fileName));
    return key;
  }
  const dir = path.join(STORAGE_ROOT, meetingId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, data);
  return filePath;
}

// Best-effort cleanup when a meeting is deleted — never throws, since the
// database row is the source of truth and a leftover file on disk (or one
// that was never written, e.g. a "joining" meeting with no audio yet) is
// harmless either way.
export async function deleteMeetingAudio(meetingId: string): Promise<void> {
  if (isR2Configured()) {
    await r2DeletePrefix(`meetings/${meetingId}/`).catch(() => {});
    return;
  }
  const dir = path.join(STORAGE_ROOT, meetingId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

// One photo per user — clears out anything already there before writing
// the new one, so there's never more than one file per user to serve.
export async function saveUserAvatar(
  userId: string,
  fileName: string,
  data: Buffer
): Promise<string> {
  const ext = path.extname(fileName) || ".jpg";
  if (isR2Configured()) {
    await r2DeletePrefix(`avatars/${userId}/`).catch(() => {});
    const key = `avatars/${userId}/avatar${ext}`;
    await r2Put(key, data, contentTypeFor(key));
    return key;
  }
  const dir = path.join(AVATAR_STORAGE_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });
  const existing = await fs.readdir(dir).catch(() => []);
  await Promise.all(existing.map((f) => fs.unlink(path.join(dir, f))));
  const filePath = path.join(dir, `avatar${ext}`);
  await fs.writeFile(filePath, data);
  return filePath;
}

export async function readUserAvatar(
  userId: string
): Promise<{ data: Buffer; fileName: string } | null> {
  if (isR2Configured()) {
    const key = await r2FirstKey(`avatars/${userId}/`);
    if (!key) return null;
    const data = await r2Get(key);
    if (!data) return null;
    return { data, fileName: key.split("/").pop()! };
  }
  const dir = path.join(AVATAR_STORAGE_ROOT, userId);
  const existing = await fs.readdir(dir).catch(() => []);
  if (existing.length === 0) return null;
  const fileName = existing[0];
  const data = await fs.readFile(path.join(dir, fileName));
  return { data, fileName };
}

// Arbitrary documents attached to a deal by hand (notes, contracts, etc),
// as opposed to a meeting recording.
export async function saveDealFile(
  dealId: string,
  fileName: string,
  data: Buffer
): Promise<string> {
  // Timestamp-prefixed so two uploads with the same filename don't clobber
  // each other; the original name is still what's shown and downloaded as.
  if (isR2Configured()) {
    const key = `deals/${dealId}/${Date.now()}-${fileName}`;
    await r2Put(key, data);
    return key;
  }
  const dir = path.join(DEAL_STORAGE_ROOT, dealId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}-${fileName}`);
  await fs.writeFile(filePath, data);
  return filePath;
}

// Removes one deal file's stored bytes — used when someone deletes a
// stale/unreadable upload so they can re-attach a fresh copy (e.g. once
// text extraction for a format has just been added and an already-
// uploaded file needs to be re-processed to pick it up). Best-effort and
// never throws, same rationale as deleteMeetingAudio above: the DB row is
// what the app actually reads from, so a storage-side miss shouldn't
// block the delete the user asked for.
export async function deleteDealFile(storagePath: string): Promise<void> {
  if (!storagePath.startsWith("/")) {
    await r2Delete(storagePath).catch(() => {});
    return;
  }
  await fs.unlink(storagePath).catch(() => {});
}

// Generic reader for a stored path/key — used by routes that just need
// the raw bytes back (e.g. deal file downloads). Handles both an R2
// object key (anything saved while R2 was configured) and a legacy local
// filesystem path (anything saved before R2 was set up), distinguished by
// whether the value is an absolute path — R2 keys never start with "/".
export async function readStoredFile(storagePath: string): Promise<Buffer | null> {
  if (!storagePath.startsWith("/")) {
    return r2Get(storagePath);
  }
  return fs.readFile(storagePath).catch(() => null);
}
