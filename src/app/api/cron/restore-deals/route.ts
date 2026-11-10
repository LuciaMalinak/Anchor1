import { NextRequest, NextResponse } from "next/server";
import { ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { applyRestore, planRestore } from "@/lib/restoreDeals";

// Restore a person's lost deals from a recovered database copy
// (src/lib/restoreDeals.ts). Run from .github/workflows/restore-deals.yml
// with the same CRON_SECRET as the other support jobs: preview first, then
// apply=1. Needs RESTORE_DATABASE_URL set on the web service.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("x-cron-key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 3) return NextResponse.json({ error: "q needs at least 3 characters" }, { status: 400 });
  const people = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)))
    .limit(2);
  if (people.length !== 1) {
    return NextResponse.json({ error: `Need exactly one match for "${q}", found ${people.length}. Use more of their email.` }, { status: 400 });
  }
  const person = people[0];
  try {
    if (req.nextUrl.searchParams.get("apply") === "1") {
      const result = await applyRestore(person.id);
      return NextResponse.json({ person: person.name, mode: "applied", ...result });
    }
    const plan = await planRestore(person.id);
    return NextResponse.json({ person: person.name, mode: "preview", plan });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const maxDuration = 300;
