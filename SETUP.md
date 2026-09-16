# Running and deploying Anchor

## Local development

1. `npm install`
2. Make sure Postgres is running and `DATABASE_URL` in `.env.local` points
   at it. `npx drizzle-kit push` creates/updates the tables from
   `src/db/schema.ts`.
3. Fill in `.env.local`:
   - `ASSEMBLYAI_API_KEY` — free account at assemblyai.com, no card needed.
   - `ANTHROPIC_API_KEY` — console.anthropic.com, needs billing set up.
   - `RESEND_API_KEY` and `EMAIL_FROM` — needed for real sign-in emails.
     resend.com has a free tier; for real deliverability you'll eventually
     want a verified sending domain.
   - `AUTH_SECRET` — any long random string for local dev. Generate a real
     one for production with `openssl rand -base64 33`.
4. `npm run dev`, visit `localhost:3000`.

## Deploying for design partners to actually use

**Host on Render, not Vercel, for now.** Vercel is the more commonly
recommended platform for Next.js, but it runs your app as short-lived
serverless functions that get frozen shortly after they respond to a
request. This app kicks off transcription and summarization in the
background after responding to an upload — real work that takes a
couple of minutes for a real meeting — and Vercel is not a safe home for
that pattern without first rebuilding it around a job queue (see
`ENGINEER_BRIEF.md`). Render runs the app as one continuously running
server, which is exactly what this code already assumes, so it works
today without that rewrite. It also has a free tier, doesn't require a
card to start, and can host the Postgres database alongside the app so
there's one account to create instead of several.

Accounts needed, all in Lucia's name (none of these can be created on
her behalf — each needs its own billing/ownership, or in most cases just
an email):

- **AssemblyAI** (transcription) — assemblyai.com, free, no card.
- **Anthropic** (summarization) — console.anthropic.com, needs a card;
  a few dollars of credit covers a lot of testing at current pricing.
- **Render** (hosting + database) — render.com, free tier, no card to
  start.
- **Resend** (sign-in emails) — resend.com, free tier, no card. Not
  strictly required to click around it yourself, but needed before
  other people can sign in with their own email.
- **Recall.ai** (optional — lets Anchor auto-join and record a live
  call instead of only accepting uploads) — recall.ai, pay-as-you-go,
  first 5 hours free.
- **LinkedIn** (optional — "Sign in with LinkedIn" button) — see below.

Steps once those exist:

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo. `render.yaml` in
   this repo tells Render to create the web service and a Postgres
   database together in one step, instead of configuring each by hand.
3. Render will prompt for the environment variables marked `sync: false`
   in `render.yaml` (the API keys) — paste in the same values from
   `.env.local`. `DATABASE_URL` and `AUTH_SECRET` are filled in
   automatically.
4. Run `npx drizzle-kit push` once against the production `DATABASE_URL`
   (shown in Render's database dashboard) to create the tables there.
5. For sign-in emails to land reliably (not in spam) once more than one
   or two people are using it, verify a sending domain in Resend rather
   than using their shared testing address.

## Setting up "Sign in with LinkedIn"

1. Create an app at linkedin.com/developers/apps (you'll need a LinkedIn
   Page associated with it — a personal profile alone isn't enough;
   create a minimal company page if you don't already have one).
2. On the app's **Products** tab, request **"Sign In with LinkedIn using
   OpenID Connect"** — this is instant/self-serve, no approval wait.
3. On the **Auth** tab, add this exact redirect URL:
   `https://<your-app>.onrender.com/api/auth/callback/linkedin`
4. Copy the **Client ID** and **Client Secret** from that same tab into
   `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` (locally in
   `.env.local`, in production as Render environment variables). The
   button only appears on the sign-in page once both are set — no code
   changes needed either way.

**Still true regardless of host:** local-disk file storage (flagged in
`ENGINEER_BRIEF.md`) is fine for one Render instance serving a handful
of design partners, but doesn't scale past that — multiple server
instances, or a move to a platform without a persistent disk, need
S3/R2/Supabase Storage first. Not a blocker for getting design partners
using this now; worth fixing before relying on it for anything that
matters.
