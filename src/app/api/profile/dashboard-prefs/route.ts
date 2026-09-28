import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isColorThemeKey } from "@/lib/colorThemes";
import { isDashboardSectionKey } from "@/lib/dashboardSections";

// Saves this person's own dashboard customization — section order and
// accent color theme (see users.dashboardLayout / users.colorTheme in
// schema.ts). Deliberately separate from the FormData-based /api/profile
// route: this is plain JSON, called straight from the dashboard home page
// itself (DashboardCustomize.tsx), not the profile settings page.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof users.$inferInsert> = {};

  if (body.dashboardLayout !== undefined) {
    if (body.dashboardLayout === null) {
      updates.dashboardLayout = null;
    } else if (Array.isArray(body.dashboardLayout)) {
      // De-duped, filtered to known section keys — an unrecognized or
      // repeated entry (a stale client, a future section renamed) is
      // just dropped rather than rejected; resolveDashboardOrder fills
      // in anything left out when this is read back.
      const seen = new Set<string>();
      const clean = body.dashboardLayout.filter((k: unknown) => {
        if (typeof k !== "string" || !isDashboardSectionKey(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      updates.dashboardLayout = clean;
    } else {
      return NextResponse.json({ error: "dashboardLayout must be a list or null" }, { status: 400 });
    }
  }

  if (body.colorTheme !== undefined) {
    if (body.colorTheme === null) {
      updates.colorTheme = null;
    } else if (typeof body.colorTheme === "string" && isColorThemeKey(body.colorTheme)) {
      updates.colorTheme = body.colorTheme;
    } else {
      return NextResponse.json({ error: "Not a recognized color theme" }, { status: 400 });
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, session.user.id))
    .returning();

  return NextResponse.json({
    dashboardLayout: updated.dashboardLayout,
    colorTheme: updated.colorTheme,
  });
}
