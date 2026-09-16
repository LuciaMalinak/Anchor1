import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  primaryKey,
  pgEnum,
  uniqueIndex,
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
  // Optional — meetings can stand alone (the original flow) or be grouped
  // under a deal so a team can see prep/live/recap for one client in one
  // place. Null means "not attached to a deal".
  dealId: uuid("dealId").references(() => deals.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
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
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Teams and deals — lets more than one person share meetings, files, and
// recap emails for the same client instead of everything being scoped to
// a single user.
// ---------------------------------------------------------------------------

export const teams = pgTable("team", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  // General, non-deal-specific "worth knowing today" news roundup, shared
  // by the whole team and refreshed at most once a day — see
  // src/lib/dailyBriefing.ts. Deal-specific news lives on the deal itself
  // (companyResearch / newsHeadline).
  dailyBriefing: text("dailyBriefing"),
  dailyBriefingUpdatedAt: timestamp("dailyBriefingUpdatedAt", { mode: "date" }),
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
  // What a teammate covering this deal's meeting is allowed to decide on
  // their own (e.g. "can offer up to 10% discount, can't commit to custom
  // features") — set by the deal owner, reused every time a handoff
  // briefing is generated. Anchor never infers this; it only ever
  // reflects what you typed here.
  decisionBoundaries: text("decisionBoundaries"),
  // Standing ownership on the deal, separate from the point-in-time
  // handoff briefing above: who's driving it day to day, and who's
  // designated to step in if the lead is out. Both nullable and both any
  // teammate — set from the deal page, never inferred.
  leadUserId: uuid("leadUserId").references(() => users.id, { onDelete: "set null" }),
  backupUserId: uuid("backupUserId").references(() => users.id, { onDelete: "set null" }),
  createdByUserId: uuid("createdByUserId")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
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
    connectedAt: timestamp("connectedAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("integration_connection_user_provider_idx").on(t.userId, t.provider)]
);
