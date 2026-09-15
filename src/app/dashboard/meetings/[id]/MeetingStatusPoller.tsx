"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Polls this meeting's status and refreshes the server-rendered page once
// processing finishes, so the transcript/summary appear without the user
// having to manually reload.
export function MeetingStatusPoller({ meetingId }: { meetingId: string }) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/meetings/${meetingId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.meeting.status === "ready" || data.meeting.status === "failed") {
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [meetingId, router]);

  return null;
}
