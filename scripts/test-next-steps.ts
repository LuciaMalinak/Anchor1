// Guardrails for the meeting page's Gmail drafts and suggested invites.
// Run: npx tsx scripts/test-next-steps.ts
import { buildMime } from "@/lib/integrations/gmailMime";
import { suggestInvites, endISO } from "@/lib/suggestInvites";
import { safeReturnTo } from "@/lib/integrations/returnTo";
const assert = (c: boolean, m: string) => { if (!c) { console.error("FAIL", m); process.exit(1); } else console.log("ok ", m); };
const mime = buildMime({ to: ["sam@acme.com"], subject: "Acme — next steps\r\nBcc: evil@x.com", body: "Hi Sam —\nthanks.\nMüller" });
const [hdr, b64] = mime.split("\r\n\r\n");
assert(!/^Bcc:/m.test(hdr), "header injection stripped");
assert(/Subject: =\?UTF-8\?B\?/.test(hdr), "non-ASCII subject RFC2047-encoded");
assert(Buffer.from(b64.replace(/\r\n/g, ""), "base64").toString("utf8") === "Hi Sam —\r\nthanks.\r\nMüller", "body round-trips UTF-8 with CRLF");
assert(!/^To:/m.test(buildMime({ to: [], subject: "x", body: "y" }).split("\r\n\r\n")[0]), "no empty To header");
assert(safeReturnTo("/dashboard/meetings/abc") === "/dashboard/meetings/abc", "returnTo keeps a local path");
assert(safeReturnTo("//evil.com") === null && safeReturnTo("/\\evil.com") === null && safeReturnTo("https://evil.com") === null, "returnTo rejects other sites");
assert(endISO("2026-10-02T10:00:00", 30) === "2026-10-02T10:30:00", "endISO 30m");
assert(endISO("2026-10-02T09:45", 45) === "2026-10-02T10:30:00", "endISO carries hour");
const transcript = "Sam: Let's get on a call Friday to review the churn cohort.\nYou: Great, Friday at 10 works.";
const fake = async () => JSON.stringify([
  { title: "Churn cohort review — Acme", startISO: "2026-10-02T10:00", durationMinutes: 30, attendees: ["sam@acme.com", "invented@nowhere.com"], sourceQuote: "Let's get on a call Friday to review the churn cohort.", confidence: "high" },
  { title: "Past meeting", startISO: "2026-09-01T10:00", durationMinutes: 30, attendees: [], sourceQuote: "Let's get on a call Friday to review the churn cohort.", confidence: "high" },
  { title: "Hallucinated", startISO: "2026-10-05T10:00", durationMinutes: 30, attendees: [], sourceQuote: "We agreed to meet Monday about pricing.", confidence: "high" },
  { title: "x", startISO: "bad", durationMinutes: 30, attendees: [], sourceQuote: "zzz", confidence: "high" },
]);
(async () => {
  const s = await suggestInvites({ transcript, actionItems: [], meetingDateISO: "2026-09-30", timeZone: "America/New_York",
    participants: [{ name: "Sam", email: "sam@acme.com" }, { name: "You", email: "lucia@anchor.com" }] }, fake);
  assert(s.length === 1, "only the valid, future, transcript-grounded suggestion survives");
  assert(JSON.stringify(s[0].attendees) === '["sam@acme.com"]', "invented attendee email removed");
  const s2 = await suggestInvites({ transcript, actionItems: [], meetingDateISO: "2026-09-30", timeZone: "UTC", participants: [] }, async () => "Sorry, here you go: {");
  assert(s2.length === 0, "garbage model output -> empty list, no crash");
})();
