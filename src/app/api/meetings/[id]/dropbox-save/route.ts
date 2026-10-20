import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/db";
import { transcripts } from "@/db/schema";
import { authorizeMeeting } from "@/lib/meetingAccess";
import { isProviderConfigured } from "@/lib/integrations/config";
import { NeedsDropboxPermissionError, saveDropboxFile } from "@/lib/integrations/dropbox";
import { loadRecap, recapFileName, recapMarkdown } from "@/lib/recapExport";

const Body = z.object({
  folder: z.string().min(1).max(400),
  includeTranscript: z.boolean().default(false),
});

// "Save to Dropbox" on a meeting recap: writes the recap (and, if asked,
// the transcript) as a Markdown file into the chosen folder. Adds a new
// file every time; never overwrites one.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { id } = await params;
  const access = await authorizeMeeting(userId, id);
  if (!access) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  if (!isProviderConfigured("dropbox")) {
    return NextResponse.json({ error: "Dropbox isn't set up on this server yet." }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a Dropbox folder first." }, { status: 400 });
  }

  const recap = await loadRecap(access.meeting, access.deal);
  if (!recap) {
    return NextResponse.json({ error: "This meeting hasn't finished processing yet." }, { status: 400 });
  }
  let transcript: string | null = null;
  if (parsed.data.includeTranscript) {
    const [row] = await db.select().from(transcripts).where(eq(transcripts.meetingId, id));
    transcript = row?.fullText ?? null;
  }

  try {
    const saved = await saveDropboxFile(userId, {
      folder: parsed.data.folder,
      fileName: recapFileName(recap),
      content: recapMarkdown(recap, transcript),
    });
    return NextResponse.json(saved);
  } catch (err) {
    if (err instanceof NeedsDropboxPermissionError) {
      return NextResponse.json(
        {
          error: "needs_dropbox_permission",
          connectUrl: `/api/integrations/dropbox/connect?add=files_write&returnTo=${encodeURIComponent(`/dashboard/meetings/${id}`)}`,
        },
        { status: 403 }
      );
    }
    console.error("[dropbox-save] failed:", err);
    const message = err instanceof Error ? err.message : "";
    return NextResponse.json(
      {
        error: message.startsWith("Dropbox isn't connected")
          ? message
          : "Dropbox didn't accept the file. Try again, or reconnect Dropbox on the Integrations page.",
      },
      { status: 502 }
    );
  }
}
