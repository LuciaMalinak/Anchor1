// Runs once when a Next.js server starts, before it handles requests.
// Used to apply the small additive database changes in startupMigrations.ts
// automatically on every deploy.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { runStartupMigrations } = await import("@/lib/startupMigrations");
  await runStartupMigrations();
}
