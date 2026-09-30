// Builds the raw RFC 822 message for a Gmail draft (see gmailDraft.ts).
// Kept free of database imports so scripts/test-next-steps.ts can run it.
export type DraftInput = {
  to: string[];
  cc?: string[];
  subject: string;
  body: string; // plain text
};

function encodeHeader(v: string): string {
  // RFC 2047 so names/subjects with accents or em dashes survive
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}
function stripCRLF(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim(); // prevent header injection
}

export function buildMime(d: DraftInput): string {
  const headers = [
    d.to.length ? `To: ${d.to.map(stripCRLF).join(", ")}` : null, // Gmail allows a draft with no recipient yet
    d.cc?.length ? `Cc: ${d.cc.map(stripCRLF).join(", ")}` : null,
    `Subject: ${encodeHeader(stripCRLF(d.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const body = Buffer.from(d.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}
