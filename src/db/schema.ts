import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  boolean,
  primaryKey,
  pgEnum,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ---------------------------------------------------------------------------
// Auth.js tables (shape required by @auth/drizzle-adapter)
// ---------------------------------------------------------------------------

export const users = pgTable("user", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").unique().notNull(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  // Every user belongs to exactly one team, auto-created for them on
  // first sign-in (or joined automatically if their email had a pending
  // invite) — see the `createUser` event in src/auth.ts. Nullable only
  // because it's added after the users table already existed in
  // production; in practice every user has one.
  teamId: uuid("teamId").references(() => teams.id, { onDelete: "set null" }),
  // Role/title shown on a teammate's profile (e.g. "Account Executive").
  // Separate from `image`, which doubles as an OAuth-provided avatar URL
  // or a path to a photo the person uploaded themselves.
  title: text("title"),
  phone: text("phone"),
  linkedin: text("linkedin"),
  department: text("department"),
  // Free-text catch-all shown on the profile ("Other info") — timezone,
  // focus areas, whatever doesn't fit a dedicated field.
  otherInfo: text("otherInfo"),
  // Whether this person has been shown the one-time welcome splash on
  // their first visit to the dashboard (see WelcomeSplash.tsx) — flipped
  // to true right after it plays, so it never shows again. Defaults false
  // for everyone, including pre-existing accounts (no backfill UPDATE) —
  // harmless for them to see it once too, and safer than a backfill that
  // could misfire if the migration is ever re-run after new signups.
  welcomeSeen: boolean("welcomeSeen").notNull().default(false),
  // bcrypt hash of the password the person sets right after their first
  // sign-in (see /welcome/set-password). Null until then — a magic-link
  // or LinkedIn sign-in doesn't require one, but every account is guided
  // to create one so password sign-in (with "stay signed in") and email
  // sign-in both work afterward. Never the plaintext password itself.
  passwordHash: text("passwordHash"),
  // False (the default, and true for every existing account) means this
  // person sees every deal on their team, same as always. True is set
  // only for someone who joined through a request-to-join link that
  // named a specific deal (see /join/[teamId] and the approval flow on
  // the Team page) — they can only see deals they have a `dealMembers`
  // row for, checked via src/lib/dealAccess.ts.
  restrictedToDeals: boolean("restrictedToDeals").notNull().default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "account",
  {
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// ---------------------------------------------------------------------------
// Anchor domain tables
// ---------------------------------------------------------------------------

export const meetingStatusEnum = pgEnum("meeting_status", [
  "uploaded",
  "transcribing",
  "summarizing",
  "ready",
  "failed",
  // Added for the Recall.ai auto-join bot flow (src/lib/recall.ts): a
  // meeting starts as "joining" while the bot dials into the call, moves
  // to "recording" once it's in and capturing audio, then joins the same
  // "uploaded" -> "transcribing" -> ... pipeline as a manual upload once
  // the recording webhook delivers the audio file.
  "joining",
  "recording",
]);

export const meetings = pgTable("meeting", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  occurredAt: timestamp("occurredAt", { mode: "date" }).defaultNow().notNull(),
  audioFileName: text("audioFileName"),
  audioStoragePath: text("audioStoragePath"),
  durationSeconds: integer("durationSeconds"),
  status: meetingStatusEnum("status").default("uploaded").notNull(),
  errorMessage: text("errorMessage"),
  // Set when this meeting came from the "send Anchor to a live meeting"
  // flow rather than a file upload — lets the webhook find its way back
  // to the right meeting row when Recall.ai says the recording is ready.
  recallBotId: text("recallBotId"),
  // Set when "Send Anchor to a live meeting" was scheduled for a future
  // time rather than joined immediately — Recall.ai's own infra (via
  // join_at on bot creation) handles the actual joining reliably even if
  // this app isn't awake at that moment. Null means "join now" (the
  // original, still-default behavior). Once real transcript data starts
  // arriving the meeting's status flips to "recording" regardless of
  // this field — see the transcript webhook.
  scheduledAt: timestamp("scheduledAt", { mode: "date" }),
  // Optional — meetings can stand alone (the original flow) or be grouped
  // under a deal so a team can see prep/live/recap for one client in one
  // place. Null means "not attached to a deal".
  dealId: uuid("dealId").references(() => deals.id, { onDelete: "set null" }),
  // AI-generated coaching for a meeting that's actively in progress
  // (status "recording") — short talking-point nudges plus a checklist
  // derived from the deal's prep notes, regenerated periodically off the
  // live transcript. Null until the first live-coaching pass runs; stale
  // once the meeting finishes (only meaningful while "recording").
  liveSuggestions: jsonb("liveSuggestions").$type<{
    nudges: string[];
    checklist: { label: string; covered: boolean }[];
  }>(),
  liveSuggestionsUpdatedAt: timestamp("liveSuggestionsUpdatedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
});

// One row per finalized utterance Recall.ai's real-time transcription
// streams back while a "send Anchor to a live meeting" bot is on a call —
// what powers the live transcript feed and live coaching on the During
// tab. Unrelated to the `transcript` table above, which holds the single
// full post-meeting transcript written once processing finishes.
export const meetingLiveSegments = pgTable("meeting_live_segment", {
  id: uuid("id").defaultRandom().primaryKey(),
  meetingId: uuid("meetingId")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" }),
  speakerName: text("speakerName"),
  text: text("text").notNull(),
  relativeSeconds: integer("relativeSeconds"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// A person Anchor has learned about, scoped to the account that owns the
// relationship. This is what carries context between meetings.
export const contacts = pgTable("contact", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  company: text("company"),
  role: text("role"),
  // Rolling, AI-maintained summary of who this person is and what matters
  // to them, updated after every meeting they appear in.
  relationshipSummary: text("relationshipSummary"),
  // What you've typed in directly about this person — kept separate from
  // relationshipSummary so a manual note is never overwritten by the
  // next auto-generated one.
  notes: text("notes"),
  // Set when this contact was created or matched from a Salesforce sync
  // — lets a re-sync update the same row instead of creating a duplicate.
  // Null for every contact that only ever came from a meeting.
  salesforceContactId: text("salesforceContactId"),
  firstMetAt: timestamp("firstMetAt", { mode: "date" }).defaultNow().notNull(),
  lastMeetingAt: timestamp("lastMeetingAt", { mode: "date" }),
  meetingCount: integer("meetingCount").default(0).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
});

// One row per speaker Anchor detected in a given meeting. May or may not
// be resolved to a known contact yet.
export const meetingParticipants = pgTable("meeting_participant", {
  id: uuid("id").defaultRandom().primaryKey(),
  meetingId: uuid("meetingId")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" }),
  contactId: uuid("contactId").references(() => contacts.id, {
    onDelete: "set null",
  }),
  speakerLabel: text("speakerLabel").notNull(), // e.g. "Speaker A"
  displayName: text("displayName"), // resolved or guessed name
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const transcripts = pgTable("transcript", {
  id: uuid("id").defaultRandom().primaryKey(),
  meetingId: uuid("meetingId")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" })
    .unique(),
  provider: text("provider").notNull(), // e.g. "assemblyai"
  fullText: text("fullText").notNull(),
  // Array of { speakerLabel, text, startMs, endMs }
  utterances: jsonb("utterances").$type<
    { speakerLabel: string; text: string; startMs: number; endMs: number }[]
  >(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const summaries = pgTable("summary", {
  id: uuid("id").defaultRandom().primaryKey(),
  meetingId: uuid("meetingId")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" })
    .unique(),
  overview: text("overview").notNull(),
  keyPoints: jsonb("keyPoints").$type<string[]>().notNull(),
  actionItems: jsonb("actionItems")
    .$type<{ text: string; owner: string | null }[]>()
    .notNull(),
  // How this meeting connects to prior history with these same people,
  // when Anchor has seen them before. Null on someone's first meeting.
  continuityNote: text("continuityNote"),
  // Concrete sales-relevant moments the model noticed — buying signals,
  // risks/objections, and things blocking progress — separate from the
  // generic keyPoints so they can be called out distinctly in the UI.
  // Empty array when nothing genuinely stood out; never padded.
  dealSignals: jsonb("dealSignals")
    .$type<{ type: "buying_signal" | "risk" | "blocker"; detail: string }[]>()
    .default([])
    .notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// Raw per-meeting note about one contact — the actual grounding history
// behind contacts.relationshipSummary. Without this, the rolling summary
// only ever sees itself (summarize-the-summary), which drifts over many
// meetings with no way to check it against what was actually said. This
// table is what mergeContactMemory's periodic full re-synthesis reads
// from — see src/lib/summarize.ts and src/lib/processMeeting.ts. Deals
// don't need an equivalent table: the `summary` table above already
// gives per-meeting grounding via meeting.dealId.
export const contactNotes = pgTable("contact_note", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contactId")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  meetingId: uuid("meetingId")
    .notNull()
    .references(() => meetings.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// A versioned history of every rolling-memory update (deal or contact) —
// what deals.memory / contacts.relationshipSummary looked like at each
// point, what changed, and whether it was an ordinary incremental merge
// or a full re-synthesis from raw history. Gives an audit trail (a bad
// merge is visible and traceable) where before there was only ever the
// current, overwritten-in-place string. subjectId is polymorphic (a
// deals.id or a contacts.id depending on subjectType) so it isn't a
// literal foreign key — always filter by subjectType first.
export const memorySubjectEnum = pgEnum("memory_subject", ["deal", "contact"]);

export const memorySnapshots = pgTable("memory_snapshot", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectType: memorySubjectEnum("subjectType").notNull(),
  subjectId: uuid("subjectId").notNull(),
  meetingId: uuid("meetingId").references(() => meetings.id, { onDelete: "set null" }),
  memory: text("memory").notNull(),
  // Short bullet points of what changed vs. the prior version, when the
  // model could identify them — the visible trace of "self-teaching."
  keyChanges: jsonb("keyChanges").$type<string[]>().default([]).notNull(),
  method: text("method").notNull(), // "incremental" | "resynthesis"
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// A rolling, AI-maintained profile of how ONE specific person on the team
// tends to negotiate, decide, and communicate — built only from their own
// words (deal notes they wrote, decision boundaries they set, deal-chat
// messages they sent), never from what other people said about them. This
// is what lets Live Assist and handoff briefings answer the way the actual
// deal lead would when someone else is covering their meeting, instead of
// in one generic voice for everyone. See src/lib/styleProfile.ts.
export const userStyleProfiles = pgTable("user_style_profile", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("userId")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // Null until there's enough of this person's own material to build
  // something real from — never a generic placeholder.
  profile: text("profile"),
  // How many source items (deal notes/boundaries/messages) fed the most
  // recent build — the gate for "is there enough signal yet," and a way
  // to tell a thin profile from a well-grounded one.
  sourceCount: integer("sourceCount").default(0).notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Teams and deals — lets more than one person share meetings, files, and
// recap emails for the same client instead of everything being scoped to
// a single user.
// ---------------------------------------------------------------------------

export const teams = pgTable("team", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  // Whoever created the team — the "team lead" for purposes of deciding
  // who can approve/decline requests to join (see
  // src/lib/joinRequestAccess.ts). Nullable only so existing rows don't
  // break before the migration's backfill runs; set on every new team
  // going forward (see getOrCreateTeamId and the createUser event).
  ownerUserId: uuid("ownerUserId").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  // General, non-deal-specific "worth knowing today" news roundup, shared
  // by the whole team and refreshed at most once a day — see
  // src/lib/dailyBriefing.ts. Deal-specific news lives on the deal itself
  // (companyResearch / newsHeadline).
  dailyBriefing: text("dailyBriefing"),
  dailyBriefingUpdatedAt: timestamp("dailyBriefingUpdatedAt", { mode: "date" }),
  // Short, ticker-style headlines (market/stock moves for a finance team,
  // the equivalent live industry news for any other vertical) — a
  // separate, much-faster-refreshing feed from dailyBriefing above, shown
  // as a small scrolling bar rather than a paragraph. See
  // src/lib/industryTicker.ts. A row written before that file's
  // {text,direction} redesign can still hold a plain string[] until its
  // next refresh — always read this through normalizeTickerItems().
  industryTicker: jsonb("industryTicker").$type<{ text: string; direction: "up" | "down" | "flat" }[]>(),
  industryTickerUpdatedAt: timestamp("industryTickerUpdatedAt", { mode: "date" }),
  // Optional industry "subsector" the team owner picks on the Team page
  // (see src/lib/industries.ts for the fixed list). Null means no
  // preference set — the default look and generic AI behavior. Currently
  // drives the landing page's industry section and a small accent-color
  // reskin in the dashboard; industry-tuned AI prompts are a later step,
  // not built on top of this yet.
  industry: text("industry"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// A pending invite: someone on the team entered this email address, but
// they haven't signed in yet. The createUser event in src/auth.ts checks
// this table when a brand-new user is created and joins them to the
// inviting team instead of creating a fresh one for them.
export const teamInvites = pgTable("team_invite", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("teamId")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  invitedByUserId: uuid("invitedByUserId")
    .notNull()
    .references(() => users.id),
  // Set only when this invite came from an approved join request that
  // named a specific deal (see /api/join-requests/[id]/approve) — the
  // createUser event in src/auth.ts uses this to flag the new user
  // `restrictedToDeals` and grant them exactly this one deal instead of
  // the whole team. Null for an ordinary "invite a teammate" invite,
  // which still grants full team access as it always has.
  restrictToDealId: uuid("restrictToDealId").references(() => deals.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// A client/account that meetings and files get grouped under, shared by
// everyone on the team (not scoped to one user the way a bare meeting is).
export const deals = pgTable("deal", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("teamId")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Free-text stage, not an enum — a small fixed list of options is
  // offered in the UI, but keeping the column plain text avoids a
  // migration every time the list of stages changes.
  stage: text("stage").default("Prospecting").notNull(),
  primaryContactName: text("primaryContactName"),
  primaryContactRole: text("primaryContactRole"),
  primaryContactEmail: text("primaryContactEmail"),
  // Used to derive a company logo (via a public logo lookup, with a
  // graceful fallback if it 404s) and shown as a link on the deal page.
  companyWebsite: text("companyWebsite"),
  // Rolling, AI-maintained summary of this deal as a whole — the
  // deal-level equivalent of a contact's relationshipSummary. Updated
  // after every meeting attached to this deal finishes processing, so
  // it's the running "what Anchor has learned about this account" memory
  // referenced on the Before tab and grounding Ask Anchor.
  memory: text("memory"),
  // What you've told Anchor directly — separate from `memory`, which
  // Anchor writes itself after each meeting. Shown together, but never
  // silently overwritten by the auto-learned side.
  notes: text("notes"),
  // Short public-company briefing Anchor fetches on request via web
  // search (industry, size, recent news) — never information about a
  // named individual, only the company itself.
  companyResearch: text("companyResearch"),
  companyResearchUpdatedAt: timestamp("companyResearchUpdatedAt", { mode: "date" }),
  // One-line headline for the most notable recent (~30 day) public news
  // about the company, pulled from the same search — null when nothing
  // that fresh turned up. Drives the "News" callout on the deal page.
  newsHeadline: text("newsHeadline"),
  // Recent Gmail/Calendar activity involving whoever's on the other side
  // of this deal — read-only, pulled from whichever of the deal's lead
  // or creator has Google connected (see src/lib/dealIntegrationContext.ts).
  // Null whenever there's no connection, no matching activity, or the
  // deal has no resolved contacts to match against yet — never a
  // placeholder. Refreshed at most every 6 hours, same rhythm as
  // companyResearch above.
  emailContext: text("emailContext"),
  calendarContext: text("calendarContext"),
  integrationContextUpdatedAt: timestamp("integrationContextUpdatedAt", { mode: "date" }),
  // What a teammate covering this deal's meeting is allowed to decide on
  // their own (e.g. "can offer up to 10% discount, can't commit to custom
  // features") — set by the deal owner, reused every time a handoff
  // briefing is generated. Anchor never infers this; it only ever
  // reflects what you typed here.
  decisionBoundaries: text("decisionBoundaries"),
  // Set when this deal was created or matched from a synced Salesforce
  // Opportunity — lets a re-sync update the same row instead of creating
  // a duplicate. Null for every deal that only ever lived in Anchor.
  salesforceOpportunityId: text("salesforceOpportunityId"),
  // Standing ownership on the deal, separate from the point-in-time
  // handoff briefing above: who's driving it day to day, and who's
  // designated to step in if the lead is out. Both nullable and both any
  // teammate — set from the deal page, never inferred.
  leadUserId: uuid("leadUserId").references(() => users.id, { onDelete: "set null" }),
  backupUserId: uuid("backupUserId").references(() => users.id, { onDelete: "set null" }),
  createdByUserId: uuid("createdByUserId")
    .notNull()
    .references(() => users.id),
  // False (the default, and true for every existing deal) means every
  // unrestricted teammate on the team sees this deal — same as always.
  // True means only the deal's creator/lead/backup and whoever has a
  // `dealMembers` row for it can see it, regardless of whether those
  // people are individually restrictedToDeals or not. This is a
  // per-deal opt-in lock ("only certain people at my company should see
  // this client"), separate from users.restrictedToDeals, which is a
  // per-PERSON lock applying to every deal. See src/lib/dealAccess.ts,
  // which is the only place both are read together.
  restricted: boolean("restricted").notNull().default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
});

// Grants one restricted user (users.restrictedToDeals = true) access to
// one deal. Ignored entirely for everyone else — an unrestricted user
// already sees every deal on their team, as they always have; see
// src/lib/dealAccess.ts, which is the only place this table is read.
export const dealMembers = pgTable(
  "deal_member",
  {
    dealId: uuid("dealId")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("addedAt", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.dealId, t.userId] })]
);

// A public, unauthenticated request to join a team — submitted from the
// /join/[teamId] page (linked from the Team page's "share this link" box)
// rather than sent by an existing teammate the way `teamInvites` is.
// Stays "pending" until someone already on the team approves or declines
// it from the Team page; approving turns it into an ordinary teamInvite
// (see /api/join-requests/[id]/approve) so the rest of sign-in works
// exactly as it does for a normal invite.
export const joinRequestStatusEnum = pgEnum("join_request_status", [
  "pending",
  "approved",
  "declined",
]);

export const joinRequests = pgTable("join_request", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("teamId")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  // Free text exactly as the requester typed it — not validated against
  // real deal names (the public form never lists them, so a stranger
  // with the link can't see the team's client list). Whoever approves
  // the request picks the actual deal from a real dropdown themselves;
  // see `matchedDealId` below.
  dealName: text("dealName").notNull(),
  status: joinRequestStatusEnum("status").default("pending").notNull(),
  matchedDealId: uuid("matchedDealId").references(() => deals.id, {
    onDelete: "set null",
  }),
  decidedByUserId: uuid("decidedByUserId").references(() => users.id, {
    onDelete: "set null",
  }),
  decidedAt: timestamp("decidedAt", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// A document attached to a deal directly (as opposed to a meeting
// recording) — notes, contracts, anything the team uploads by hand.
export const dealFiles = pgTable("deal_file", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("dealId")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  fileName: text("fileName").notNull(),
  storagePath: text("storagePath").notNull(),
  fileSize: integer("fileSize"),
  // Plain text pulled out at upload time (txt/md/csv/pdf/docx) so Ask
  // Anchor can actually use what's in the file, not just its name. Null
  // means either an unsupported file type or extraction failed — the
  // file itself is still uploaded and downloadable either way.
  extractedText: text("extractedText"),
  uploadedByUserId: uuid("uploadedByUserId")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// Team chat scoped to a single deal — the Chat tab. Deliberately simple:
// no editing, deleting, or read receipts, just a running thread the whole
// team (anyone on the deal's team) can post to and read.
export const dealMessages = pgTable("deal_message", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("dealId")
    .notNull()
    .references(() => deals.id, { onDelete: "cascade" }),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  // Null (the default, and every message sent before this existed) means
  // visible to the whole team, same as always. A non-null array limits
  // this message to just those user ids, plus the sender themselves —
  // enforced in /api/deals/[id]/messages/route.ts, which is the only
  // place messages are read or written. Not a foreign key (a jsonb array
  // can't be one) — ids are validated against the team at send time.
  recipientUserIds: jsonb("recipientUserIds").$type<string[]>(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Third-party integrations — one row per (teammate, provider) OAuth
// connection. This is the connection layer only: it stores the tokens
// needed to call each provider's API. Pulling that data into deal context
// (so it actually grounds Ask Anchor / handoffs) is a separate, later
// phase — see src/lib/integrations/config.ts for the current provider list.
// ---------------------------------------------------------------------------

export const integrationProviderEnum = pgEnum("integration_provider", [
  "google",
  "microsoft",
  "slack",
  "salesforce",
]);

export const integrationConnections = pgTable(
  "integration_connection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    // Best-effort label for what's shown as connected — an email address
    // for Google/Microsoft, a workspace name for Slack. Purely cosmetic.
    externalAccountEmail: text("externalAccountEmail"),
    // MVP-only: stored as plain text, same tradeoff as the API keys
    // already sitting in .env for this project. Before this goes beyond a
    // design-partner demo, these should move to an encrypted column (or a
    // secrets manager) — see ENGINEER_BRIEF.md.
    accessToken: text("accessToken").notNull(),
    refreshToken: text("refreshToken"),
    tokenExpiresAt: timestamp("tokenExpiresAt", { mode: "date" }),
    scope: text("scope"),
    // Salesforce (unlike Google/Microsoft/Slack) has a per-org API base
    // URL handed back in the token response, not a fixed one — every API
    // call has to go to this org's instance instead of a shared endpoint.
    // Unused by other providers.
    instanceUrl: text("instanceUrl"),
    connectedAt: timestamp("connectedAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("integration_connection_user_provider_idx").on(t.userId, t.provider)]
);

// ---------------------------------------------------------------------------
// Home page: a cross-deal to-do list. Two sources feed the same table —
// "meeting" rows are materialized automatically from a summary's
// actionItems right after it's generated (see processMeeting.ts), and
// "manual" rows are typed in directly on the home page. Keeping both in
// one table (rather than synthesizing meeting action items on the fly
// each time) is what makes a checkbox and comments possible — jsonb
// array entries have no stable id to hang state off of.
// ---------------------------------------------------------------------------

export const tasks = pgTable("task", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("teamId")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  // Optional — a manual task doesn't have to be tied to a deal, and it's
  // what lets the home page rank tasks by that deal's health.
  dealId: uuid("dealId").references(() => deals.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  // Cosmetic-only "who this is for" — the AI's best guess at a name for a
  // meeting-sourced task, or whatever a teammate typed for a manual one.
  // Not a resolved user id, so it never blocks on matching a real person.
  ownerLabel: text("ownerLabel"),
  source: text("source").notNull(), // "meeting" | "manual"
  sourceMeetingId: uuid("sourceMeetingId").references(() => meetings.id, { onDelete: "set null" }),
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completedAt", { mode: "date" }),
  completedByUserId: uuid("completedByUserId").references(() => users.id, { onDelete: "set null" }),
  // Null for a meeting-sourced task (the AI created it, not a person).
  createdByUserId: uuid("createdByUserId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

export const taskComments = pgTable("task_comment", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("taskId")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});
