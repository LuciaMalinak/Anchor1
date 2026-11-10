import { NextResponse } from "next/server";
import { teamOwnerContext } from "@/lib/teamOwner";
import { exportTeamData } from "@/lib/teamExport";
import { logDataChange } from "@/lib/dataChangeLog";

// Team owner: download everything the team has in Anchor.AI as one JSON
// file (src/lib/teamExport.ts).
export async function GET() {
  const ctx = await teamOwnerContext();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const data = await exportTeamData(ctx.team.id);
  await logDataChange({ action: "team_exported", actorUserId: ctx.user.id, actorEmail: ctx.user.email, teamId: ctx.team.id, targetId: ctx.team.id });
  const name = `Anchor.AI export - ${ctx.team.name.replace(/[^\w .,()&-]+/g, " ").trim().slice(0, 60) || "team"} - ${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const maxDuration = 120;
