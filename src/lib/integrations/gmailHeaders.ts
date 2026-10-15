// Header-only checks on Gmail messages for the Morning brief (see
// gmailInbox.ts). Kept free of database imports so
// scripts/test-next-steps.ts can run it.
export type Header = { name: string; value: string };
export type GmailMessage = {
  id?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Header[] };
};

const AUTOMATED_SENDER = /(^|[._+-])(no-?reply|do-?not-?reply|notifications?|notify|mailer-daemon|postmaster|bounce|alerts?|newsletter|updates?|news|digest|billing|receipts?|support-noreply)([._+-]|@)/i;

export function header(m: GmailMessage, name: string): string {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// "Dana Ruiz <dana@northwind.com>" -> { name: "Dana Ruiz", email: "dana@northwind.com" }
export function parseAddress(value: string): { name: string; email: string } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  const email = value.trim().toLowerCase();
  return { name: email, email };
}

export function addresses(value: string): string[] {
  return (value.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []).map((a) => a.toLowerCase());
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Whether the latest message in a thread still needs this person's reply,
// on headers alone (the AI step in morningBrief.ts makes the finer call).
// Exported for scripts/test-next-steps.ts.
export function looksAwaitingReply(m: GmailMessage, myEmails: Set<string>): boolean {
  const labels = m.labelIds ?? [];
  if (labels.includes("SENT") || labels.includes("DRAFT")) return false;
  const from = parseAddress(header(m, "From")).email;
  if (!from || myEmails.has(from)) return false;
  if (AUTOMATED_SENDER.test(from)) return false;
  if (header(m, "List-Unsubscribe") || header(m, "List-Id")) return false;
  const precedence = header(m, "Precedence").toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") return false;
  const auto = header(m, "Auto-Submitted").toLowerCase();
  if (auto && auto !== "no") return false;
  const recipients = [...addresses(header(m, "To")), ...addresses(header(m, "Cc"))];
  return recipients.some((r) => myEmails.has(r));
}

