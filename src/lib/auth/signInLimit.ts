import { NextRequest } from "next/server";
import { rawClient } from "@/db";

// Stops password guessing: after too many wrong passwords for one email, or
// from one network address, password sign-in is refused for a while.
// Counts live in the "sign_in_failure" table (src/lib/startupMigrations.ts)
// so they hold across restarts and server instances. Google, LinkedIn and
// email-link sign-in aren't affected.
const WINDOW_MINUTES = 15;
const MAX_PER_EMAIL = 8;
const MAX_PER_IP = 30;

export function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

export async function signInLocked(email: string, ip: string | null): Promise<boolean> {
  const [row] = await rawClient<{ byEmail: number; byIp: number }[]>`
    select
      (select count(*)::int from "sign_in_failure" where "email" = ${email.toLowerCase()} and "createdAt" > now() - make_interval(mins => ${WINDOW_MINUTES})) as "byEmail",
      (select count(*)::int from "sign_in_failure" where ${ip}::text is not null and "ip" = ${ip} and "createdAt" > now() - make_interval(mins => ${WINDOW_MINUTES})) as "byIp"`;
  return (row?.byEmail ?? 0) >= MAX_PER_EMAIL || (row?.byIp ?? 0) >= MAX_PER_IP;
}

export async function recordSignInFailure(email: string, ip: string | null): Promise<void> {
  await rawClient`insert into "sign_in_failure" ("email", "ip") values (${email.toLowerCase()}, ${ip})`;
  // Keep the table small: nothing older than a day matters.
  if (Math.random() < 0.05) await rawClient`delete from "sign_in_failure" where "createdAt" < now() - interval '1 day'`;
}

export async function clearSignInFailures(email: string): Promise<void> {
  await rawClient`delete from "sign_in_failure" where "email" = ${email.toLowerCase()}`;
}
