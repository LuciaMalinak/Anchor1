import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { deals, meetings, summaries, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: dealId } = await params;
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal || !user?.teamId || deal.teamId !== user.teamId) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const [latest] = await db
    .select({ meeting: meetings, summary: summaries })
    .from(meetings)
    .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
    .where(and(eq(meetings.dealId, dealId), eq(meetings.status, "ready")))
    .orderBy(desc(meetings.occurredAt))
    .limit(1);

  if (!latest) {
    return NextResponse.json(
      { error: "No finished meeting recap on this deal yet" },
      { status: 400 }
    );
  }

  const teammates = await db.select().from(users).where(eq(users.teamId, user.teamId));
  const recipients = teammates.map((t) => t.email).filter(Boolean) as string[];
  if (recipients.length === 0) {
    return NextResponse.json({ error: "No team members to send to" }, { status: 400 });
  }

  const { meeting, summary } = latest;
  const actionItemsHtml = summary.actionItems
    .map((a) => `<li>${a.text}${a.owner ? ` — <em>${a.owner}</em>` : ""}</li>`)
    .join("");
  const keyPointsHtml = summary.keyPoints.map((k) => `<li>${k}</li>`).join("");

  try {
    await sendEmail({
      to: recipients,
      subject: `Recap: ${meeting.title} (${deal.name})`,
      html: `
        <h2>${meeting.title}</h2>
        <p>${summary.overview}</p>
        ${summary.keyPoints.length ? `<h3>Key points</h3><ul>${keyPointsHtml}</ul>` : ""}
        ${summary.actionItems.length ? `<h3>Action items</h3><ul>${actionItemsHtml}</ul>` : ""}
        <p style="color:#64748b;font-size:12px;">Sent from Anchor — ${deal.name}</p>
      `,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Couldn't send the email (check your Resend setup)",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ sentTo: recipients });
}
