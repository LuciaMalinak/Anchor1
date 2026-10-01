"use client";

import { stopMeeting } from "@/lib/stopMeeting";

// Ask Anchor can take a couple of real actions, not just answer — stop
// the live meeting, open one of the deal's files (see the tools in
// askAnchorStream, src/lib/liveAssist.ts). The answer stream carries each
// action as a marker after the text; these helpers keep the markers out
// of what's displayed and carry them out once the answer has finished.
const ACTION = /\[\[anchor:(stop|open):([^\]\s]+)\]\]/g;
// A marker that's only partly streamed in so far.
const PARTIAL_ACTION = /\[\[[^\]]*\]?$/;

export function stripAskActions(text: string): string {
  return text.replace(ACTION, "").replace(PARTIAL_ACTION, "").trimEnd();
}

// Runs every action in a finished answer. Returns a note to show under
// the answer when one couldn't be done, or null when all went fine.
export async function runAskActions(text: string): Promise<string | null> {
  for (const [, kind, arg] of text.matchAll(ACTION)) {
    if (kind === "stop") {
      const result = await stopMeeting(arg);
      if (!result.ok) return `Couldn't stop the meeting: ${result.error}`;
    } else if (kind === "open") {
      // May be blocked as a pop-up since it isn't a direct click — the
      // answer always includes the file as a link too.
      window.open(arg, "_blank", "noopener,noreferrer");
    }
  }
  return null;
}
