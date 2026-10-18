"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type AutoResult = {
  enabled: boolean;
  turnedOn: boolean;
  googleConnected: boolean;
  gmailCanDraft: boolean;
  prefs?: { hour: number; minute: number; days: string };
};

// Shown on Home while this person's Morning brief isn't on. Someone with
// Gmail connected who never set it up gets it turned on right away, in
// their own time zone (see /api/morning-brief/auto-enable), and a note
// saying so; everyone else gets the button to set it up.
export function MorningBriefPrompt({ neverSetUp }: { neverSetUp: boolean }) {
  const [auto, setAuto] = useState<AutoResult | null>(null);
  const [sending, setSending] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  useEffect(() => {
    if (!neverSetUp) return;
    fetch("/api/morning-brief/auto-enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body && setAuto(body))
      .catch(() => {});
  }, [neverSetUp]);

  async function sendNow() {
    setSending("sending");
    const res = await fetch("/api/morning-brief/send-now", { method: "POST" }).catch(() => null);
    setSending(res?.ok ? "sent" : "failed");
  }

  if (auto?.enabled) {
    const p = auto.prefs;
    const time = p ? new Date(2000, 0, 1, p.hour, p.minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "8:00 AM";
    return (
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-emerald-900">Your morning brief is on</h2>
          <p className="mt-1 max-w-2xl text-sm text-emerald-800">
            Every {p?.days === "everyday" ? "day" : "weekday"} at {time} by email: the emails waiting on you, with how to handle each one and a
            reply written the way you write, plus today&apos;s meetings and to-dos.
            {!auto.gmailCanDraft && (
              <>
                {" "}
                <a
                  href="/api/integrations/google/connect?add=gmail_compose&returnTo=%2Fdashboard"
                  className="font-semibold underline"
                >
                  Also save the replies in my Gmail drafts
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={sendNow}
            disabled={sending === "sending" || sending === "sent"}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {sending === "sending" ? "Sending…" : sending === "sent" ? "Sent — check your inbox" : sending === "failed" ? "Try again" : "Send me one now"}
          </button>
          <Link href="/dashboard/profile#morning-brief" className="text-sm font-medium text-emerald-900 underline">
            Change
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-brand">Get your morning brief</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Each morning by email, text or Slack: the emails still waiting on your reply, with a suggested reply for each, today&apos;s
          meetings, your to-dos and deals going quiet.
          {auto && !auto.googleConnected && " Connect Google on the Integrations page so it can see your inbox."}
        </p>
      </div>
      <Link
        href="/dashboard/profile#morning-brief"
        className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
      >
        Set it up
      </Link>
    </section>
  );
}
