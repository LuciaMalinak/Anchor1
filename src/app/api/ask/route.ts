import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { askWorkspaceStream } from "@/lib/liveAssist";
import { buildMeetingContext, buildWorkspaceContext } from "@/lib/askAnchorContext";
import { loadAskSources } from "@/lib/askSources";
import { findRelevantPassages, formatPassages } from "@/lib/askRetrieval";
import { getDealLeadStyle } from "@/lib/styleProfile";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const MAX_HISTORY_TURNS = 6;

// The app-wide Ask Anchor panel. With a meetingId it answers about that
// one meeting (the recap page); without, about everything this person can
// see. Deal pages use /api/deals/[id]/assist instead. Streams plain text,
// same as the deal route, so AskAnchorDock reads both the same way.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const question = String(body.question || "").trim().slice(0, 2000);
  if (!question) {
    return NextResponse.json({ error: "Ask Anchor something first." }, { status: 400 });
  }
  const rawHistory: unknown[] = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory
    .filter((h): h is { role: "user" | "assistant"; content: string } => {
      if (!h || typeof h !== "object") return false;
      const role = (h as { role?: unknown }).role;
      const content = (h as { content?: unknown }).content;
      return (role === "user" || role === "assistant") && typeof content === "string";
    })
    .slice(-MAX_HISTORY_TURNS * 2);

  const meetingId = typeof body.meetingId === "string" && body.meetingId ? body.meetingId : null;
  let scope: "workspace" | "meeting" = "workspace";
  let contextBlock: string;
  // Whose way of working the answer should follow: the deal's lead on a
  // meeting recap, otherwise the person asking (they lead their deals).
  let leadUserId: string | null = userId;
  let leadName: string | null = null;
  try {
    let dealIds: string[] = [];
    if (meetingId) {
      const meeting = await buildMeetingContext(userId, meetingId);
      if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
      scope = "meeting";
      contextBlock = meeting.context;
      dealIds = meeting.dealId ? [meeting.dealId] : [];
      leadUserId = meeting.leadUserId;
    } else {
      const workspace = await buildWorkspaceContext(userId);
      if (!workspace) return NextResponse.json({ error: "Join or create a team first." }, { status: 400 });
      contextBlock = workspace.context;
      dealIds = workspace.dealIds;
    }

    // Search the calls, documents and emails behind it for this question
    // first, so the answer starts from the team's own material.
    const sources = await loadAskSources({ dealIds, includeUnassignedFor: meetingId ? undefined : userId }).catch((err) => {
      console.error("[ask] loading sources failed:", err);
      return [];
    });
    const searchText = [...history.filter((h) => h.role === "user").slice(-1).map((h) => h.content), question].join(" ");
    const passages = findRelevantPassages(searchText, sources, { maxPassages: 8, maxChars: 7000 });
    if (passages.length) {
      contextBlock = `Passages matched to this question from the team's own calls, documents and emails (each labelled with where it's from):\n${formatPassages(passages)}\n\n${contextBlock}`;
    }
    if (leadUserId) {
      const [lead] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, leadUserId));
      leadName = lead ? lead.name || lead.email : null;
    }
  } catch (err) {
    console.error("[ask] building context failed:", err);
    return NextResponse.json({ error: "Anchor couldn't load your workspace. Try again." }, { status: 500 });
  }
  const leadStyle = await getDealLeadStyle(leadUserId, { allowSynchronousRebuild: false });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of askWorkspaceStream({ scope, contextBlock, lead: { name: leadName, style: leadStyle }, question, history })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error("[ask] stream failed:", err);
        controller.enqueue(encoder.encode("Anchor couldn't finish answering that — try asking again."));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
