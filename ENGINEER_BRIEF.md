# Anchor MVP — engineering handoff brief

This document is for you (Lucia) to use when briefing or interviewing an
engineer, and for that engineer to read on day one. It describes what
exists, what was deliberately left out of the MVP and why, and what a
first hire would actually spend their time on.

## What this MVP does

A signed-in user uploads a meeting recording (audio or video). Anchor
transcribes it with speaker separation, has Claude read the transcript and
produce an overview, key points, and action items, and — this is the
differentiated part — tries to identify who each speaker is from the
conversation itself and builds a rolling memory of that person: what they
care about, what was discussed, how it's evolved meeting over meeting. The
next time that same person shows up in a transcript, Anchor surfaces what
it already knows about them alongside the new summary.

That loop — upload, transcribe, summarize, remember — is real and working
end to end, not a mockup. The stack: Next.js, Postgres (via Drizzle, not
Prisma — see below), AssemblyAI for transcription, Claude for
summarization and memory, Auth.js for sign-in.

## Deliberate MVP shortcuts — read this before "fixing" any of these

Everything below was a conscious call to get a real, working product in
front of design partners fast, not an oversight. An engineer's early
weeks are largely about deciding which of these to address first based on
what actual usage tells you.

**No live meeting bot.** Anchor does not join Zoom/Meet/Teams calls
automatically. Users upload a recording after the fact (all three
platforms produce one natively). Building a bot that joins calls live is
a real, multi-week engineering project on its own — either building
against each platform's SDK directly (fragile, a lot of ongoing
maintenance as platforms change their UIs/APIs) or paying for
infrastructure that does this for you (Recall.ai and similar vendors
exist specifically for this). This is probably the single highest-value
thing an engineer builds next, once upload-based usage validates the
core value prop.

**Processing runs in-process, not on a queue.** When a file is uploaded,
transcription and summarization kick off immediately in the same server
process and the client polls for status. This works fine for a handful of
users but has two real problems at scale: a long call can take several
minutes to process, and if the server restarts mid-job, that job is lost
with no retry. The fix is a proper job queue (Inngest, Trigger.dev, or a
simple Postgres-backed queue) — a well-understood, contained piece of
work.

**Audio files are stored on local disk.** Fine for local development,
but this will not survive a redeployment on most hosting platforms and
won't work at all across multiple server instances. Needs to move to S3,
Cloudflare R2, or Supabase Storage before this goes to more than a
handful of users — a few hours of work, well-trodden.

**Speaker-to-contact matching is name-string matching, nothing smarter.**
Claude infers a speaker's name from what's said in the transcript, and
Anchor matches that to an existing contact by exact name (case
insensitive). No matching on email, no fuzzy matching on nicknames or
misspellings, no handling of two different people who happen to share a
name. This is the part of the product most worth investing real
engineering (and product) thought into as usage grows — it's the core
differentiator, so it deserves better than a string match once you have
real users to learn from.

**No calendar or CRM integration.** Nothing pulls in who was invited to a
meeting, and nothing pushes notes out to a CRM. Both are natural
next steps once you know which one design partners actually ask for.

**No automated tests.** Fine for a single founder iterating with AI
assistance on a small surface area; not fine once multiple people are
shipping to the same codebase. Standard advice: an engineer should add
tests as they touch code, not stop to write a full suite up front.

**No error tracking, logging, or monitoring.** Right now, if something
breaks for a design partner, you find out because they tell you. Sentry
(errors) and a basic uptime check are a same-day setup and should be one
of the first things a new engineer wires up.

**No rate limiting or abuse protection** on uploads or API routes. Not
urgent with a handful of trusted design partners; necessary before any
public signup.

**Compliance and enterprise readiness are untouched.** The deck's
enterprise path talks about segregated/self-hosted deployment, retention
controls, and access governance. None of that exists in this MVP — it's
SMB-shaped by design, on purpose, since that's the immediate validation
target. Enterprise readiness (SOC 2 path, audit logs, data residency
controls, SSO) is a distinct, substantial engineering program of its own
and shouldn't be started until there's a real enterprise prospect asking
for it.

## Why Drizzle instead of Prisma

Prisma is the more commonly recommended ORM in most current tutorials,
but its CLI needs to download a native query-engine binary from
Prisma's own servers at install and build time. That download was
blocked by network policy in the environment this MVP was built in, so
Drizzle was used instead — it's pure JavaScript/TypeScript, needs nothing
beyond the npm registry and a database driver, and is a legitimate,
increasingly popular choice on its own merits (not just a workaround). An
engineer familiar with Prisma will be productive with Drizzle within a
day; the concepts map closely.

## First 30/60/90 for an engineer, roughly in priority order

1. Get the app deployed somewhere real (see `SETUP.md`) and move file
   storage to S3/R2/Supabase Storage so uploads survive a redeploy.
2. Add error tracking (Sentry) and basic uptime monitoring.
3. Move processing to a real job queue so long recordings don't time out
   and failed jobs can retry.
4. Whatever design partners actually complain about first — this will
   very likely reorder everything above it.
5. Once upload-based usage is validated: live meeting capture (the bot
   that joins calls automatically), which is the single biggest lift on
   this list and the thing worth being most deliberate about scoping and
   possibly buying rather than building.

## What you do NOT need an engineer for yet

Iterating on the product itself — new fields to extract from a meeting,
changes to the summary format, tweaks to how contacts are matched — can
mostly keep happening the way this MVP was built, with an AI coding
assistant, as long as someone is reviewing what gets shipped. Where a
dedicated engineer earns their keep is exactly the list above: the parts
that are about reliability, scale, security, and integrations with
systems outside Anchor's own database — the parts that break in ways a
non-engineer can't diagnose or fix under time pressure, and the parts
that take sustained, uninterrupted attention rather than a session at a
time.
