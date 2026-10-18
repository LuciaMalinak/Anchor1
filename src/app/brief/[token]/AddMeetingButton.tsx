"use client";

import { useState } from "react";

// A meeting the brief suggested from an email: added to the calendar only
// when this is clicked, optionally inviting the person who wrote.
export function AddMeetingButton({
  token,
  threadId,
  title,
  when,
  fromName,
  initiallyAdded,
}: {
  token: string;
  threadId: string;
  title: string;
  when: string;
  fromName: string;
  initiallyAdded: boolean;
}) {
  const [invite, setInvite] = useState(true);
  const [state, setState] = useState<"idle" | "adding" | "added">(initiallyAdded ? "added" : "idle");
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);

  async function add() {
    setState("adding");
    setError(null);
    const res = await fetch("/api/morning-brief/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, threadId, invite }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) {
      setState("added");
      setOpenUrl(body.openUrl ?? null);
      return;
    }
    setState("idle");
    if (body.error === "needs_google_permission" && body.connectUrl) {
      setConnectUrl(body.connectUrl);
      setError("Anchor needs permission to add events to your Google Calendar.");
    } else setError(body.error || "Couldn't add it. Try again.");
  }

  const first = fromName.split(" ")[0];
  return (
    <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5">
      <p className="text-sm text-sky-900">
        <span className="font-semibold">Suggested meeting: </span>
        {title} · {when}
      </p>
      {state === "added" ? (
        <p className="mt-1.5 text-sm font-medium text-emerald-700">
          Added to your calendar ✓{" "}
          {openUrl && (
            <a href={openUrl} target="_blank" rel="noreferrer" className="underline">
              Open it
            </a>
          )}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={add}
            disabled={state === "adding"}
            className="rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
          >
            {state === "adding" ? "Adding…" : "Add to calendar"}
          </button>
          <label className="flex items-center gap-1.5 text-sm text-sky-900">
            <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
            Invite {first}
          </label>
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-sm text-red-600">
          {error}{" "}
          {connectUrl && (
            <a href={connectUrl} className="font-semibold underline">
              Allow it
            </a>
          )}
        </p>
      )}
    </div>
  );
}
