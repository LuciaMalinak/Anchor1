"use client";

import { useEffect, useRef, useState } from "react";

// Puts the suggested reply in Gmail drafts, in the same thread, ready to
// send — for any email whose draft isn't there yet.
// saveNow: opened from "Save to Gmail drafts" in the brief email, so it
// saves straight away.
export function SaveDraftButton({
  token,
  threadId,
  initiallySaved,
  saveNow,
}: {
  token: string;
  threadId: string;
  initiallySaved: boolean;
  saveNow?: boolean;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved">(initiallySaved ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [openUrl, setOpenUrl] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setError(null);
    const res = await fetch("/api/morning-brief/save-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, threadId }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) {
      setState("saved");
      setOpenUrl(body.openUrl ?? null);
      return;
    }
    setState("idle");
    if (body.error === "needs_google_permission" && body.connectUrl) {
      setConnectUrl(body.connectUrl);
      setError("Anchor needs permission to create Gmail drafts.");
    } else setError(body.error || "Couldn't save it. Try again.");
  }

  const started = useRef(false);
  useEffect(() => {
    if (saveNow && !initiallySaved && !started.current) {
      started.current = true;
      void save();
    }
    // Only on first load from the email link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "saved") {
    return (
      <span className="text-sm font-medium text-emerald-700">
        In your Gmail drafts ✓{" "}
        {openUrl && (
          <a href={openUrl} target="_blank" rel="noreferrer" className="underline">
            Open drafts
          </a>
        )}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={save}
        disabled={state === "saving"}
        className="rounded-md border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5 disabled:opacity-60"
      >
        {state === "saving" ? "Saving…" : "Save to Gmail drafts"}
      </button>
      {error && (
        <span className="text-sm text-red-600">
          {error}{" "}
          {connectUrl && (
            <a href={connectUrl} className="font-semibold underline">
              Allow it
            </a>
          )}
        </span>
      )}
    </span>
  );
}
