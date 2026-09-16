import fs from "fs/promises";
import path from "path";

// MVP-only local disk storage. Fine for one server instance; will NOT
// survive a redeploy on Vercel (ephemeral filesystem) or work across
// multiple instances. Swapping this for S3 / Supabase Storage / R2 is a
// same-shaped, few-hour task for whoever picks this up next — see
// ENGINEER_BRIEF.md.
const STORAGE_ROOT = path.join(process.cwd(), "storage", "meetings");

export async function saveMeetingAudio(
  meetingId: string,
  fileName: string,
  data: Buffer
): Promise<string> {
  const dir = path.join(STORAGE_ROOT, meetingId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, data);
  return filePath;
}

const AVATAR_STORAGE_ROOT = path.join(process.cwd(), "storage", "avatars");

// One photo per user — clears out anything already there before writing
// the new one, so there's never more than one file per user to serve.
export async function saveUserAvatar(
  userId: string,
  fileName: string,
  data: Buffer
): Promise<string> {
  const dir = path.join(AVATAR_STORAGE_ROOT, userId);
  await fs.mkdir(dir, { recursive: true });
  const existing = await fs.readdir(dir).catch(() => []);
  await Promise.all(existing.map((f) => fs.unlink(path.join(dir, f))));
  const ext = path.extname(fileName) || ".jpg";
  const filePath = path.join(dir, `avatar${ext}`);
  await fs.writeFile(filePath, data);
  return filePath;
}

export async function readUserAvatar(
  userId: string
): Promise<{ data: Buffer; fileName: string } | null> {
  const dir = path.join(AVATAR_STORAGE_ROOT, userId);
  const existing = await fs.readdir(dir).catch(() => []);
  if (existing.length === 0) return null;
  const fileName = existing[0];
  const data = await fs.readFile(path.join(dir, fileName));
  return { data, fileName };
}

const DEAL_STORAGE_ROOT = path.join(process.cwd(), "storage", "deals");

// Arbitrary documents attached to a deal by hand (notes, contracts, etc),
// as opposed to a meeting recording. Same local-disk caveat as above.
export async function saveDealFile(
  dealId: string,
  fileName: string,
  data: Buffer
): Promise<string> {
  const dir = path.join(DEAL_STORAGE_ROOT, dealId);
  await fs.mkdir(dir, { recursive: true });
  // Timestamp-prefixed so two uploads with the same filename don't clobber
  // each other; the original name is still what's shown and downloaded as.
  const filePath = path.join(dir, `${Date.now()}-${fileName}`);
  await fs.writeFile(filePath, data);
  return filePath;
}
