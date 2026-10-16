// Uploads a recording in pieces instead of one request. An hour of audio
// is 30-60MB, and sending it in one go to a small server either hung on a
// slow connection (the page sat on "Uploading…" for good) or ran it out of
// memory. Each piece is small, retried on its own, and shows progress;
// the route that finishes the upload (finish-recording, or POST
// /api/meetings) joins them. Shared by the browser and the server.

export const PART_BYTES = 5 * 1024 * 1024;
export const MAX_PART_BYTES = 10 * 1024 * 1024;
// 500MB at 5MB a piece, the same cap uploads have always had.
export const MAX_PARTS = 100;

const PART_TIMEOUT_MS = 120_000;
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

export function isValidUploadId(id: string): boolean {
  return /^[a-zA-Z0-9-]{8,64}$/.test(id);
}

export type UploadedParts = { uploadId: string; parts: number };

async function sendPart(uploadId: string, index: number, data: Blob): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PART_TIMEOUT_MS);
    let message = "Upload failed — check your connection";
    try {
      const res = await fetch(`/api/uploads/part?uploadId=${uploadId}&index=${index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: data,
        signal: controller.signal,
      });
      if (res.ok) return;
      const body = await res.json().catch(() => ({}));
      message = body.error || "Upload failed";
      // A refusal (signed out, bad piece) won't change on a retry.
      if (res.status < 500) throw new Error(message);
    } catch (err) {
      // Network drops and timeouts reject with TypeError/AbortError and
      // are worth retrying; the refusal thrown just above isn't.
      if (err instanceof Error && err.name !== "TypeError" && err.name !== "AbortError") throw err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt >= RETRY_DELAYS_MS.length) throw new Error(message);
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
}

// onProgress gets 0..1 as pieces finish.
export async function uploadInParts(blob: Blob, onProgress?: (fraction: number) => void): Promise<UploadedParts> {
  const parts = Math.max(1, Math.ceil(blob.size / PART_BYTES));
  if (parts > MAX_PARTS) throw new Error("Recording is too large (500MB max)");
  const uploadId = crypto.randomUUID();
  onProgress?.(0);
  for (let i = 0; i < parts; i++) {
    await sendPart(uploadId, i, blob.slice(i * PART_BYTES, (i + 1) * PART_BYTES));
    onProgress?.((i + 1) / parts);
  }
  return { uploadId, parts };
}

// The Upload buttons (home page, deal page): sends the form's file in
// pieces, then creates the meeting from them. Returns POST /api/meetings'
// response, so callers handle it as before.
export async function uploadMeetingFile(form: FormData, onProgress?: (fraction: number) => void): Promise<Response> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a recording first.");
  const { uploadId, parts } = await uploadInParts(file, onProgress);
  return fetch("/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, parts, fileName: file.name, title: form.get("title"), dealId: form.get("dealId") }),
  });
}
