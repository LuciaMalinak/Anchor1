import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { summaries, transcripts } from "@/db/schema";
import { authorizeMeeting } from "@/lib/meetingAccess";
import {
  CRM_NAME,
  NeedsCrmPermissionError,
  crmTargetFor,
  readCrm,
  validateChanges,
  writeCrm,
  type CrmSnapshot,
} from "@/lib/integrations/crmWrite";
import { proposeCrmUpdate } from "@/lib/dealTools";

const MAX_TRANSCRIPT_CHARS = 30_000;

function stageLabel(snapshot: CrmSnapshot, value: string | null): string | null {
  if (!value) return null;
  return snapshot.stageOptions.find((o) => o.value === value)?.label ?? value;
}

// "Update Salesforce / HubSpot" on a meeting recap.
//   { action: "propose" } -> the record as it is now, plus the changes the
//     call supports (each with a reason). Nothing is written.
//   { action: "apply", changes } -> writes only those reviewed changes to
//     the deal's linked record, after validating them against it again.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  const access = await authorizeMeeting(userId, id);
  if (!access?.deal) {
    return NextResponse.json({ error: "This meeting isn't on a deal you can see." }, { status: 404 });
  }
  const target = await crmTargetFor(userId, access.deal);
  if (!target.provider) {
    return NextResponse.json(
      {
        error:
          target.reason === "not_linked"
            ? "This deal isn't linked to a CRM record yet. Sync Salesforce or HubSpot from Integrations first."
            : `Connect ${CRM_NAME[target.linkedTo!]} on the Integrations page to update it from here.`,
      },
      { status: 400 }
    );
  }
  const crmName = CRM_NAME[target.provider];
  const body = await req.json().catch(() => ({}));

  let snapshot: CrmSnapshot;
  try {
    snapshot = await readCrm(userId, target.provider, target.recordId);
  } catch (err) {
    console.error("[crm-update] read failed:", err);
    return NextResponse.json({ error: `Couldn't read the deal from ${crmName}. Try again, or reconnect it on Integrations.` }, { status: 502 });
  }

  if (body.action === "propose") {
    const [[summary], [transcript]] = await Promise.all([
      db.select().from(summaries).where(eq(summaries.meetingId, id)),
      db.select().from(transcripts).where(eq(transcripts.meetingId, id)),
    ]);
    if (!summary) {
      return NextResponse.json({ error: "This meeting hasn't finished processing yet." }, { status: 400 });
    }
    const context = [
      `Meeting: ${access.meeting.title}`,
      `Summary: ${summary.overview}`,
      summary.keyPoints.length ? `Key points:\n${summary.keyPoints.map((k) => `- ${k}`).join("\n")}` : "",
      summary.actionItems.length ? `Action items:\n${summary.actionItems.map((a) => `- ${a.text}${a.owner ? ` (${a.owner})` : ""}`).join("\n")}` : "",
      summary.dealSignals?.length ? `Signals:\n${summary.dealSignals.map((s) => `- ${s.type}: ${s.detail}`).join("\n")}` : "",
      transcript ? `Transcript:\n${transcript.fullText.slice(0, MAX_TRANSCRIPT_CHARS)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      const proposal = await proposeCrmUpdate({
        crmName,
        allowedStages: snapshot.stageOptions.map((o) => o.label),
        current: {
          stage: stageLabel(snapshot, snapshot.stage),
          closeDate: snapshot.closeDate,
          amount: snapshot.amount,
          nextStep: snapshot.nextStep,
        },
        meetingDate: access.meeting.occurredAt.toISOString().slice(0, 10),
        context,
      });
      // The model picks stages by label; the CRM wants the stage's value.
      const stageValue = proposal.stage
        ? snapshot.stageOptions.find((o) => o.label === proposal.stage!.value)?.value ?? null
        : null;
      return NextResponse.json({
        crmName,
        snapshot,
        proposal: { ...proposal, stage: proposal.stage && stageValue ? { ...proposal.stage, value: stageValue } : null },
      });
    } catch (err) {
      console.error("[crm-update] propose failed:", err);
      return NextResponse.json({ error: "Couldn't work out the updates. Try again." }, { status: 502 });
    }
  }

  if (body.action === "apply") {
    const changes = validateChanges(snapshot, body.changes);
    if (typeof changes === "string") {
      return NextResponse.json({ error: changes }, { status: 400 });
    }
    try {
      await writeCrm(userId, target.provider, target.recordId, changes);
      const updated = await readCrm(userId, target.provider, target.recordId).catch(() => null);
      return NextResponse.json({ crmName, snapshot: updated ?? snapshot, applied: Object.keys(changes) });
    } catch (err) {
      if (err instanceof NeedsCrmPermissionError) {
        return NextResponse.json(
          {
            error: "needs_crm_permission",
            connectUrl: `/api/integrations/hubspot/connect?add=deals_write&returnTo=${encodeURIComponent(`/dashboard/meetings/${id}`)}`,
          },
          { status: 403 }
        );
      }
      console.error("[crm-update] write failed:", err);
      return NextResponse.json(
        { error: `${crmName} didn't accept the update. Check you can edit this record there, then try again.` },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ crmName, snapshot });
}
