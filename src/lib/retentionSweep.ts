import { purgeExpiredCalls } from "@/lib/retention";

// Automatic deletion of old calls for teams that turned it on (see
// retention.ts), run by the server itself (instrumentation.ts). Safe to
// run often: it only deletes what's past each team's window.
const RETENTION_FIRST_MS = 10 * 60_000;
const RETENTION_EVERY_MS = 6 * 60 * 60_000;

export function startRetentionSweep() {
  const sweep = async () => {
    try {
      const result = await purgeExpiredCalls();
      if (result.calls) console.log("[retention] deleted old calls:", result);
    } catch (err) {
      console.error("[retention] sweep failed:", err);
    }
  };
  setTimeout(() => {
    void sweep();
    setInterval(sweep, RETENTION_EVERY_MS).unref();
  }, RETENTION_FIRST_MS).unref();
}
