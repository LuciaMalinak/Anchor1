import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { dataChangeLog, users } from "@/db/schema";
import { logDataChange } from "@/lib/dataChangeLog";
import { applyRebuild, planRebuild, type RebuildPlan } from "@/lib/rebuildDeals";

// Rebuild a person's lost deals from their unlinked calls (src/lib/rebuildDeals.ts).
// Run from .github/workflows/rebuild-deals.yml with the same CRON_SECRET as
// the other support jobs. Without apply=1 it only previews, and saves the
// preview; apply=1 carries out the latest preview from the last 24 hours,
// so what's applied is exactly what was shown.
const PREVIEW_VALID_MS = 24 * 60 * 60_000;

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

  if (req.nextUrl.searchParams.get("apply") !== "1") {
    const plan = await planRebuild(person.id);
    await logDataChange({ action: "deals_rebuild_preview", targetId: person.id, details: { plan } });
    return NextResponse.json({ person: person.name, mode: "preview", plan });
  }

  const [preview] = await db
    .select({ details: dataChangeLog.details })
    .from(dataChangeLog)
    .where(
      and(
        eq(dataChangeLog.action, "deals_rebuild_preview"),
        eq(dataChangeLog.targetId, person.id),
        gt(dataChangeLog.createdAt, new Date(Date.now() - PREVIEW_VALID_MS))
      )
    )
    .orderBy(desc(dataChangeLog.createdAt))
    .limit(1);
  const plan = (preview?.details as { plan?: RebuildPlan } | null)?.plan;
  if (!plan) return NextResponse.json({ error: "Run a preview first (apply = false), then apply within 24 hours." }, { status: 400 });
  const result = await applyRebuild(person.id, plan);
  return NextResponse.json({ person: person.name, mode: "applied", ...result, plan });
}

export const maxDuration = 300;
