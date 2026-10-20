import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { authorizeMeeting } from "@/lib/meetingAccess";
import { isProviderConfigured } from "@/lib/integrations/config";
import { NeedsSlackPermissionError, listSlackChannels, postSlackChannelMessage } from "@/lib/integrations/slack";
import { loadRecap, slackRecapText } from "@/lib/recapExport";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare") }),
  z.object({ action: z.literal("post"), channelId: z.string().min(1).max(40), text: z.string().min(1).max(12_000) }),
]);

// "Post to Slack" on a meeting recap.
//   { action: "prepare" } -> the channels they can post to, plus a draft
//     message built from the recap. Nothing is sent.
//   { action: "post", channelId, text } -> posts the (edited) message.
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
  if (!isProviderConfigured("slack")) {
    return NextResponse.json({ error: "Slack isn't set up on this server yet." }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick a channel and write a message first." }, { status: 400 });
  }

  try {
    if (parsed.data.action === "prepare") {
      const recap = await loadRecap(access.meeting, access.deal);
      if (!recap) {
        return NextResponse.json({ error: "This meeting hasn't finished processing yet." }, { status: 400 });
      }
      const channels = await listSlackChannels(userId);
      return NextResponse.json({ channels, text: slackRecapText(recap) });
    }
    const { permalink } = await postSlackChannelMessage(userId, parsed.data);
    return NextResponse.json({ posted: true, permalink });
  } catch (err) {
    if (err instanceof NeedsSlackPermissionError) {
      return NextResponse.json(
        {
          error: "needs_slack_permission",
          connectUrl: `/api/integrations/slack/connect?add=post_channels&returnTo=${encodeURIComponent(`/dashboard/meetings/${id}`)}`,
        },
        { status: 403 }
      );
    }
    console.error("[slack-post] failed:", err);
    const message = err instanceof Error ? err.message : "";
    return NextResponse.json(
      {
        error:
          message === "channel_not_found" || message === "not_in_channel"
            ? "Anchor can't post in that channel. Pick a public channel, or invite the Anchor app to it in Slack."
            : message.startsWith("Slack isn't connected")
              ? message
              : "Slack didn't accept that. Try again, or reconnect Slack on the Integrations page.",
      },
      { status: 502 }
    );
  }
}
