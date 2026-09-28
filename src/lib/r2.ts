import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 is S3-compatible, so the regular AWS S3 SDK works against
// it unchanged — just pointed at R2's endpoint instead of AWS's. This is
// the fix for storage.ts's local-disk files not surviving a Render
// restart/redeploy (Render's free tier has no persistent disk). See
// .env.example for where to get these four values.
export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
  );
}

let cachedClient: S3Client | null = null;

function client(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return cachedClient;
}

function bucket(): string {
  return process.env.R2_BUCKET_NAME!;
}

export async function r2Put(key: string, data: Buffer, contentType?: string): Promise<void> {
  await client().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: data, ContentType: contentType })
  );
}

// Returns null on any read failure (missing key included) rather than
// throwing — callers treat "not found" the same way the old fs helpers
// did (a caught fs.readFile rejection).
export async function r2Get(key: string): Promise<Buffer | null> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

// Deletes exactly one object — for removing a single deal file without
// touching any of the deal's other files, which live under the same
// `deals/${dealId}/` prefix (unlike r2DeletePrefix below, which is a
// whole-prefix wipe used for cascading a meeting or user gone entirely).
export async function r2Delete(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// Deletes every object under a prefix — the R2 equivalent of `fs.rm(dir,
// { recursive: true })` for a per-meeting/per-user "folder".
export async function r2DeletePrefix(prefix: string): Promise<void> {
  const list = await client().send(
    new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix })
  );
  const objects = (list.Contents || [])
    .map((o) => (o.Key ? { Key: o.Key } : null))
    .filter((o): o is { Key: string } => o !== null);
  if (objects.length === 0) return;
  await client().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: objects } }));
}

// First key under a prefix — used where there's meant to be exactly one
// object per prefix (e.g. one avatar per user).
export async function r2FirstKey(prefix: string): Promise<string | null> {
  const list = await client().send(
    new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, MaxKeys: 1 })
  );
  return list.Contents?.[0]?.Key ?? null;
}

// Short-lived, direct-to-R2 upload/download URLs — used for large files
// (see src/app/api/admin/desktop-app/upload-url/route.ts and
// src/app/api/download/desktop-app/[platform]/route.ts) so the bytes
// never pass through — and are never buffered in memory by — our own
// Render instance. `expiresInSeconds` caps how long the URL is usable;
// keep uploads short (a few minutes, since it's issued right before an
// immediate curl) and downloads short too (the download route re-signs a
// fresh one on every click, so the public link itself never expires even
// though each individual signed URL does).
export async function r2PresignedPutUrl(
  key: string,
  contentType: string,
  expiresInSeconds: number
): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn: expiresInSeconds }
  );
}

export async function r2PresignedGetUrl(
  key: string,
  expiresInSeconds: number,
  downloadFilename?: string
): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: downloadFilename
        ? `attachment; filename="${downloadFilename}"`
        : undefined,
    }),
    { expiresIn: expiresInSeconds }
  );
}
