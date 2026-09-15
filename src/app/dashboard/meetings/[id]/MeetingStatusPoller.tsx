"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Polls this meeting's status and refreshes the server-rendered page
// whenever it changes (joining -> recording -> uploaded -> transcribing
// -> summarizing -> ready/failed), so the status message on screen keeps
// pace with what's actually happening instead of only updating once at
// the very end.
export function MeetingStatusPoller({
  meetingId,
  initialStatus,
}: {
  meetingId: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const lastStatus = useRef(initialStatus);

  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/meetings/${meetingId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.meeting.status !== lastStatus.current) {
        lastStatus.current = data.meeting.status;
        router.refresh();
      }
      if (data.meeting.status === "ready" || data.meeting.status === "failed") {
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [meetingId, router]);

  return null;
}
