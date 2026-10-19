// Runs once when a Next.js server starts, before it handles requests.
// Used to apply the small additive database changes in startupMigrations.ts
// automatically on every deploy.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { runStartupMigrations } = await import("@/lib/startupMigrations");
  await runStartupMigrations();
  startStuckMeetingSweep();
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
