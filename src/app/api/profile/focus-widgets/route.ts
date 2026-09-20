import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isFocusWidgetKey } from "@/lib/focusWidgets";

// Saves this person's own focus-mode widget selection (users.focusWidgets
// — see src/lib/focusWidgets.ts and src/app/focus/[meetingId]). Separate
// from /api/profile/dashboard-prefs: different feature, different page,
// same "per-user, plain JSON PATCH" shape.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  if (body.focusWidgets === null) {
    // Explicit reset to the default set.
    const [updated] = await db
      .update(users)
      .set({ focusWidgets: null })
      .where(eq(users.id, session.user.id))
      .returning();
    return NextResponse.json({ focusWidgets: updated.focusWidgets });
  }

  if (!Array.isArray(body.focusWidgets)) {
    return NextResponse.json({ error: "focusWidgets must be a list or null" }, { status: 400 });
  }

  const seen = new Set<string>();
  const clean = body.focusWidgets.filter((k: unknown) => {
    if (typeof k !== "string" || !isFocusWidgetKey(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // A focus window showing nothing defeats the point of it — reject
  // rather than silently falling back to the defaults, so the person
  // sees why their selection didn't save instead of it quietly reverting.
  if (clean.length === 0) {
    return NextResponse.json({ error: "Keep at least one widget on." }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set({ focusWidgets: clean })
    .where(eq(users.id, session.user.id))
    .returning();

  return NextResponse.json({ focusWidgets: updated.focusWidgets });
}
