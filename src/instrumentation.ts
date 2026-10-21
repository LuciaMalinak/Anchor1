// Runs once when a Next.js server starts, before it handles requests.
// Used to apply the small additive database changes in startupMigrations.ts
// automatically on every deploy.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { runStartupMigrations } = await import("@/lib/startupMigrations");
  await runStartupMigrations();
  startStuckMeetingSweep();
  if (process.env.NODE_ENV === "production") startMorningBriefSchedule();
}

// A restart (every deploy is one) stops any meeting write-up in progress,
// and a call can end without anything saying so — this picks both back
// up (see stuckMeetings.ts). First run waits a couple of minutes so open
// live panels and desktop apps have polled again, showing which calls
// are still going.
const SWEEP_FIRST_MS = 2 * 60_000;
const SWEEP_EVERY_MS = 5 * 60_000;

function startStuckMeetingSweep() {
  const sweep = async () => {
    try {
      const { recoverStuckMeetings } = await import("@/lib/stuckMeetings");
      const result = await recoverStuckMeetings();
      if (result.resumed || result.ended || result.failed) console.log("[stuckMeetings] sweep:", result);
    } catch (err) {
      console.error("[stuckMeetings] sweep failed:", err);
    }
  };
  setTimeout(() => {
    void sweep();
    setInterval(sweep, SWEEP_EVERY_MS).unref();
  }, SWEEP_FIRST_MS).unref();
}

// Morning briefs go out within a few minutes of each person's chosen time
// (see runDueMorningBriefs). The server checks itself rather than waiting
// on the hourly GitHub workflow, which GitHub often runs hours late.
// Replies to new emails are drafted once an hour, as before.
const BRIEF_CHECK_FIRST_MS = 60_000;
const BRIEF_CHECK_EVERY_MS = 5 * 60_000;
const BRIEF_CHECKS_PER_DRAFT_RUN = 12;

function startMorningBriefSchedule() {
  let checks = 0;
  const check = async () => {
    const draftReplies = checks++ % BRIEF_CHECKS_PER_DRAFT_RUN === 0;
    try {
      const { runDueMorningBriefs } = await import("@/lib/morningBrief");
      const result = await runDueMorningBriefs({ draftReplies });
      if (result.sent || result.failed || result.drafted) console.log("[morningBrief] scheduled check:", result);
    } catch (err) {
      console.error("[morningBrief] scheduled check failed:", err);
    }
  };
  setTimeout(() => {
    void check();
    setInterval(check, BRIEF_CHECK_EVERY_MS).unref();
  }, BRIEF_CHECK_FIRST_MS).unref();
}
