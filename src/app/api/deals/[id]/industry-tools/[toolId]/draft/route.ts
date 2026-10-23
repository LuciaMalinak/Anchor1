import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authorizeDeal } from "@/lib/dealAccess";
import { toolReportPlainText } from "@/lib/industryTools";
import { teamToolContext } from "@/lib/industryToolRun";
import { createGmailDraft } from "@/lib/integrations/gmailDraft";
import { NeedsGooglePermissionError } from "@/lib/integrations/google";

// Saves a client-facing industry report (seller update, client process
// update, mutual action plan, group proposal…) as a Gmail draft to the
// deal's main contact. Never sends: they review and send it from Gmail.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; toolId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id, toolId } = await params;
  const authorized = await authorizeDeal(session.user.id, id);
  if (!authorized) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const tool = (await teamToolContext(authorized.deal.teamId)).tools.find((t) => t.id === toolId);
  const saved = authorized.deal.toolReports?.[toolId];
  if (!tool?.clientFacing || !saved) return NextResponse.json({ error: "Write the report first." }, { status: 404 });
  const to = authorized.deal.primaryContactEmail ? [authorized.deal.primaryContactEmail] : [];
  try {
    const result = await createGmailDraft(session.user.id, {
      to,
      subject: saved.report.title,
      body: toolReportPlainText(saved.report),
    });
    return NextResponse.json({ ok: true, openUrl: result.openUrl, to });
  } catch (err) {
    if (err instanceof NeedsGooglePermissionError) {
      return NextResponse.json(
        {
          error: "Anchor needs permission to save drafts in your Gmail.",
          connectUrl: `/api/integrations/google/connect?add=${err.scopeKey}&returnTo=${encodeURIComponent(`/dashboard/deals/${id}`)}`,
        },
        { status: 403 }
      );
    }
    console.error(`[industry tools] draft ${toolId}`, err);
    return NextResponse.json({ error: "Couldn't save the draft. Try again." }, { status: 502 });
  }
}
