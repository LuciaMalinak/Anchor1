// Guardrails for the meeting page's Gmail drafts and suggested invites.
// Run: npx tsx scripts/test-next-steps.ts
import { buildMime, replyDraft } from "@/lib/integrations/gmailMime";
import { suggestInvites, endISO } from "@/lib/suggestInvites";
import { safeReturnTo } from "@/lib/integrations/returnTo";
import { createShareToken, readShareToken } from "@/lib/shareLink";
import { findRelevantPassages, keywords } from "@/lib/askRetrieval";
import { isBriefDue, normalizePrefs, daysBetween } from "@/lib/morningBriefPrefs";
import { shouldShowToday, rankEmails, renderBriefText, renderBriefHtml, type BriefEmail, type BriefSnapshot } from "@/lib/morningBriefRender";
import { createBriefToken, readBriefToken } from "@/lib/briefLink";
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
assert(endISO("2026-10-02T22:30", 120) === "2026-10-03T00:30:00", "endISO rolls past midnight to the next day");
assert(endISO("2026-12-31T23:30", 60) === "2027-01-01T00:30:00", "endISO rolls over the year");
process.env.AUTH_SECRET ??= "test-secret";
const dealId = "93e784b7-9360-46eb-9581-a3171e6c9177";
const { token } = createShareToken(dealId, Date.UTC(2026, 9, 1));
assert(readShareToken(token, Date.UTC(2026, 9, 2))?.dealId === dealId, "share link opens the right deal");
assert(readShareToken(token, Date.UTC(2026, 11, 1)) === null, "share link stops working after 30 days");
const [payload, sig] = token.split(".");
const otherPayload = Buffer.from(`00000000-0000-0000-0000-000000000000.${Date.UTC(2027, 0, 1)}`).toString("base64url");
assert(readShareToken(`${otherPayload}.${sig}`, Date.UTC(2026, 9, 2)) === null, "share link can't be edited to point at another deal");
assert(readShareToken(`${payload}.${sig}x`, Date.UTC(2026, 9, 2)) === null && readShareToken("garbage", Date.UTC(2026, 9, 2)) === null, "tampered or junk share links are rejected");
// Ask Anchor searches the deal's own calls and documents before the web.
assert(keywords("What did they say about the pricing?").join(",") === "pric", "question boiled down to what matters");
const askSources = [
  { kind: "call" as const, label: "Call \"Kickoff\", 2026-09-01", text: "[0:10] Jordan: Thanks for joining.\n[4:12] Priya: Our budget for this year is capped at 50k, and procurement needs a SOC 2 report.\n[9:40] Jordan: Let's talk Slack later." },
  { kind: "document" as const, label: "Document \"pricing.xlsx\"", text: "Seat pricing: 40 seats at $49 per seat per month. Volume discount up to 15% above 50 seats." },
  { kind: "email" as const, label: "Emails with Acme", text: "Jordan asked to move the call to Thursday." },
];
const budgetHits = findRelevantPassages("What's their budget and does procurement need anything?", askSources);
assert(budgetHits[0]?.label.startsWith("Call") && budgetHits[0].text.includes("capped at 50k"), "budget question finds the call line");
assert(findRelevantPassages("How much is the volume discount on seats?", askSources)[0]?.label.includes("pricing.xlsx"), "pricing question finds the document");
assert(findRelevantPassages("Who won the 1998 World Cup?", askSources).length === 0, "unrelated question finds nothing, so Anchor goes to the web");
// Morning brief timing: 8:00 in the person's own time zone, once a day.
const nyPrefs = normalizePrefs({ hour: 8, timeZone: "America/New_York", days: "weekdays" });
const thu = (utcHour: number, utcMin = 0) => new Date(Date.UTC(2026, 9, 15, utcHour, utcMin)); // Thu Oct 15 2026, NY is UTC-4
assert(!isBriefDue(nyPrefs, null, thu(11, 59)).due, "not due at 7:59 local");
assert(isBriefDue(nyPrefs, null, thu(12, 5)).due && isBriefDue(nyPrefs, null, thu(12, 5)).localDate === "2026-10-15", "due at 8:05 local, dated the local day");
assert(!isBriefDue(nyPrefs, "2026-10-15", thu(13)).due, "never twice the same day");
assert(isBriefDue(nyPrefs, null, thu(16, 48)).due, "still sent the same day when the check runs hours late");
assert(!isBriefDue(nyPrefs, null, new Date(Date.UTC(2026, 9, 16, 0, 30))).due, "not sent more than 12 hours late (8:30 pm local)");
assert(!isBriefDue(nyPrefs, null, new Date(Date.UTC(2026, 9, 17, 12, 5))).due, "weekdays-only skips Saturday");
assert(isBriefDue(normalizePrefs({ ...nyPrefs, days: "everyday" }), null, new Date(Date.UTC(2026, 9, 17, 12, 5))).due, "every-day includes Saturday");
assert(isBriefDue(normalizePrefs({ hour: 8, timeZone: "Europe/Berlin" }), null, thu(6, 10)).due, "Berlin 8:00 is 6:00 UTC");
const junk = normalizePrefs({ hour: 99, timeZone: "Mars/Base", channel: "fax", remindEveryDays: 9 });
assert(junk.hour === 8 && junk.timeZone === "America/New_York" && junk.channel === "email" && junk.remindEveryDays === 1, "bad settings fall back to defaults");
assert(daysBetween("2026-10-13", "2026-10-15") === 2, "days between dates");
// Morning brief follow-ups: an unanswered email comes back every N days
// until answered, marked done or snoozed.
const every2 = { remindEveryDays: 2 as const };
assert(shouldShowToday("t1", "2026-10-15", every2, {}, {}), "new email shows");
assert(!shouldShowToday("t1", "2026-10-15", every2, { t1: { on: "2026-10-14", n: 1 } }, {}), "every-2-days skips the next day");
assert(shouldShowToday("t1", "2026-10-16", every2, { t1: { on: "2026-10-14", n: 1 } }, {}), "every-2-days comes back after 2 days");
assert(!shouldShowToday("t1", "2026-10-15", { remindEveryDays: 1 }, {}, { t1: "done" }), "done stops reminders");
assert(!shouldShowToday("t1", "2026-10-15", { remindEveryDays: 1 }, {}, { t1: "2026-10-17" }) && shouldShowToday("t1", "2026-10-17", { remindEveryDays: 1 }, {}, { t1: "2026-10-17" }), "snooze hides until its date");
const mk = (o: Partial<BriefEmail>): BriefEmail => ({ threadId: "x", fromName: "A", fromEmail: "a@x.com", subject: "s", summary: "wants x", waitingDays: 0, reminder: 1, deal: null, priority: 3, gmailUrl: "https://mail.google.com", drafted: false, ...o });
const ranked = rankEmails([mk({ threadId: "old", waitingDays: 6 }), mk({ threadId: "deal", deal: "Northwind", priority: 1 }), mk({ threadId: "new", waitingDays: 1 })]);
assert(ranked.map((e) => e.threadId).join(",") === "deal,old,new", "deal contacts first, then longest waiting");
const snap: BriefSnapshot = { date: "2026-10-15", googleConnected: true, emails: [mk({ fromName: "Dana Ruiz", deal: "Northwind", summary: "wants 50-seat pricing by Mon", waitingDays: 2, reminder: 3 })], moreEmails: 0, tasks: [{ text: "Send SOC 2 report", deal: "Northwind" }], moreTasks: 2, meetings: [{ time: "10:00 AM", title: "IT review", deal: "Northwind" }], quietDeals: [{ name: "Bluepeak", days: 12 }] };
const smsText = renderBriefText(snap, "https://a.co/brief/x");
assert(smsText.includes("Dana (Northwind): wants 50-seat pricing by Mon – 2d, reminder 3") && smsText.includes("To do: Send SOC 2 report (+2 more)") && smsText.includes("Gone quiet: Bluepeak 12d"), "text message is short and complete");
assert(smsText.length < 500, "text message stays short");
assert(renderBriefHtml({ ...snap, emails: [mk({ fromName: "<script>x</script>" })] }, "https://a.co/b", "Lucia").includes("&lt;script&gt;"), "email escapes names");
const briefToken = createBriefToken(dealId, Date.UTC(2026, 9, 15));
assert(readBriefToken(briefToken, Date.UTC(2026, 9, 16))?.userId === dealId && readBriefToken(briefToken, Date.UTC(2026, 9, 19)) === null, "brief link opens for 3 days");
assert(readBriefToken(token, Date.UTC(2026, 9, 2)) === null, "a share link can't open a brief");
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

// CRM updates: only real values for the record's own options get through.
import("@/lib/integrations/crmValidate").then(({ validateChanges, isRealDate }) => {
  const snap = { provider: "salesforce" as const, recordId: "006", recordName: null, recordUrl: null, stage: "Qualification", stageOptions: [{ value: "Qualification", label: "Qualification" }, { value: "Negotiation", label: "Negotiation" }], closeDate: "2026-12-31", amount: 100, nextStep: null };
  assert(!isRealDate("2026-02-31") && !isRealDate("2026-13-01") && isRealDate("2028-02-29"), "only real calendar dates count");
  assert(typeof validateChanges(snap, { stage: "Made up" }) === "string", "unknown CRM stage rejected");
  assert(typeof validateChanges(snap, { amount: -1 }) === "string", "negative amount rejected");
  assert(typeof validateChanges(snap, { stage: "Qualification" }) === "string", "no-op update rejected");
  const ok = validateChanges(snap, { stage: "Negotiation", nextStep: "x".repeat(300) });
  assert(typeof ok === "object" && ok.stage === "Negotiation" && ok.nextStep?.length === 255, "valid update kept, next step capped at 255");
}).catch((err) => { console.error("FAIL crmWrite tests", err); process.exit(1); });
import("@/lib/integrations/documentSearch").then(({ dealSearchTerm, formatDocumentContext, trimExcerpt, MAX_EXCERPT_CHARS }) => {
  assert(dealSearchTerm("Northbridge — Series B") === "Northbridge", "deal search term: company before an em dash");
  assert(dealSearchTerm("Acme - Renewal 2027") === "Acme", "deal search term: company before a hyphen");
  assert(dealSearchTerm("Globex: pilot") === "Globex", "deal search term: company before a colon");
  assert(dealSearchTerm("HP — expansion") === "HP — expansion", "deal search term: too-short company falls back to the full name");
  assert(trimExcerpt("a  b\n\nc") === "a b c", "excerpt whitespace collapsed");
  assert(trimExcerpt("x".repeat(MAX_EXCERPT_CHARS + 50)).length === MAX_EXCERPT_CHARS + 1, "long excerpt trimmed with an ellipsis");
  assert(formatDocumentContext([]) === null, "no documents -> no document context");
  const ctx = formatDocumentContext([{ source: "Dropbox", name: "deck.pdf", modified: "2026-09-30T10:00:00Z", link: null, excerpt: "hello" }]);
  assert(ctx === "— deck.pdf (Dropbox, updated 2026-09-30)\nhello", "document context formatted with source and date");
}).catch((err) => { console.error("FAIL documentSearch tests", err); process.exit(1); });

// Which inbox threads still need a reply, on headers alone.
import("@/lib/integrations/gmailHeaders").then(({ looksAwaitingReply, parseAddress, replyAllFor }) => {
  const me = new Set(["lucia@acme.com"]);
  const msg = (headers: Record<string, string>, labelIds: string[] = ["INBOX"]) => ({
    labelIds,
    payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
  });
  assert(looksAwaitingReply(msg({ From: "Dana Ruiz <dana@northwind.com>", To: "Lucia <lucia@acme.com>" }), me), "a person writing to me needs a reply");
  assert(!looksAwaitingReply(msg({ From: "Lucia <lucia@acme.com>", To: "dana@northwind.com" }, ["SENT"]), me), "my own reply last means answered");
  assert(!looksAwaitingReply(msg({ From: "news@vendor.com", To: "lucia@acme.com", "List-Unsubscribe": "<mailto:x>" }), me), "newsletters skipped");
  assert(!looksAwaitingReply(msg({ From: "no-reply@zoom.us", To: "lucia@acme.com" }), me), "no-reply senders skipped");
  assert(!looksAwaitingReply(msg({ From: "dana@northwind.com", To: "team@acme.com" }), me), "mail only to a group list skipped");
  assert(parseAddress('"Ruiz, Dana" <Dana@Northwind.com>').email === "dana@northwind.com", "parses sender address");
  const answered = msg({ From: "Dana <dana@northwind.com>", To: "lucia@acme.com, sam@northwind.com", Cc: "legal@northwind.com, Lucia@Acme.com", Subject: "RE: Pricing", "Message-Id": "<m3@nw>", References: "<m1@acme> <m2@nw>" });
  const all = replyAllFor(answered, me);
  assert(all.to.join() === "dana@northwind.com,sam@northwind.com" && all.cc.join() === "legal@northwind.com", "reply-all keeps everyone on the chain but me");
  assert(all.subject === "RE: Pricing" && all.references === "<m1@acme> <m2@nw> <m3@nw>", "reply stays in the same conversation");
  const draft = buildMime(replyDraft({ fromEmail: "dana@northwind.com", subject: "Pricing", replyToHeader: "<m3@nw>", replyAll: all }, "Thanks"));
  assert(draft.includes("To: dana@northwind.com, sam@northwind.com\r\nCc: legal@northwind.com") && draft.includes("References: <m1@acme> <m2@nw> <m3@nw>"), "reply-all draft headers");
}).catch((err) => { console.error("FAIL gmailHeaders tests", err); process.exit(1); });
