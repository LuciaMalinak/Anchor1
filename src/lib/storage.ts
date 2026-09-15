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
