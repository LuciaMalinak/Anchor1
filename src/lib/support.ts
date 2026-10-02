import { APP_OWNER_EMAILS } from "@/lib/appOwner";
import { sendEmail } from "@/lib/email";

// "Get help" requests with Chrome Remote Desktop screen sharing — see the
// supportRequests table in schema.ts, SupportButton.tsx (the person asking)
// and AdminSupportRequests.tsx (the app owner helping). The table is created
// on deploy by startupMigrations.ts.

// Where the person generates a one-time access code ("Get Support") and
// where the helper enters it ("Give Support") — the same Google page.
export const REMOTE_SUPPORT_URL = "https://remotedesktop.google.com/support";
// Google's codes stop working after 5 minutes.
export const ACCESS_CODE_TTL_MS = 5 * 60 * 1000;

export const SUPPORT_STATUSES = ["open", "in_progress", "resolved"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

// Access codes are 12 digits; people paste them with spaces or dashes.
export function normalizeAccessCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 12 ? digits : null;
}

export function formatAccessCode(code: string): string {
  return code.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

// Emails the app owner(s) — a code is only good for 5 minutes, so waiting
// for someone to happen to open Admin isn't enough. Best-effort.
export async function notifySupport(params: {
  kind: "new" | "code";
  who: string;
  message: string;
  accessCode?: string;
  adminUrl: string;
}) {
  const subject =
    params.kind === "new"
      ? `Anchor: ${params.who} asked for help`
      : `Anchor: ${params.who} shared their screen code — connect within 5 minutes`;
  const codeHtml = params.accessCode
    ? `<p style="font-size:22px;font-weight:600;letter-spacing:2px;font-family:monospace">${formatAccessCode(params.accessCode)}</p>
       <p>Open <a href="${REMOTE_SUPPORT_URL}">Chrome Remote Desktop</a> → Give Support, enter the code, and they'll be asked to approve.</p>`
    : "";
  await sendEmail({
    to: APP_OWNER_EMAILS,
    subject,
    html: `<p><strong>${escapeHtml(params.who)}</strong> needs help:</p>
      <blockquote>${escapeHtml(params.message)}</blockquote>
      ${codeHtml}
      <p><a href="${params.adminUrl}">Open support requests in Admin</a></p>`,
  }).catch((err) =>
    console.error("[support] couldn't email the app owner:", err),
  );
}
