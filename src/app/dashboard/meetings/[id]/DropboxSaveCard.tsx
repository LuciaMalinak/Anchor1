"use client";

import { useEffect, useRef, useState } from "react";
import { stashPendingGoogleAction, takePendingGoogleAction } from "@/lib/pendingGoogleAction";

type Pending = { folder: string; includeTranscript: boolean };

// "Save to Dropbox" on a meeting recap: saves the recap as a file in the
// deal's folder (the folder is theirs to change), adding a new file each
// time rather than overwriting anything.
export function DropboxSaveCard({ meetingId, defaultFolder }: { meetingId: string; defaultFolder: string }) {
  const [folder, setFolder] = useState(defaultFolder);
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ path: string; link: string } | null>(null);

  // Back from granting Dropbox write access: finish the save.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = takePendingGoogleAction<Pending>("dropbox", meetingId);
    if (pending) {
      queueMicrotask(() => {
        setFolder(pending.folder);
        setIncludeTranscript(pending.includeTranscript);
        void save(pending, true);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  async function save(p: Pending, afterPermission = false) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/dropbox-save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && body.connectUrl) {
        if (afterPermission) {
          throw new Error("Anchor needs permission to save to Dropbox. Click Save to Dropbox and allow it on Dropbox's screen.");
        }
        // First save: Dropbox asks for write access, then brings them back
        // here and the save finishes on its own.
        stashPendingGoogleAction("dropbox", meetingId, p);
        window.location.href = body.connectUrl;
        return;
      }
      if (!res.ok) throw new Error(body.error || "Couldn't save to Dropbox");
      setSaved(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save to Dropbox");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-medium text-slate-900">Save to Dropbox</h2>
      <p className="mt-1 text-xs text-slate-500">
        Keeps this call&apos;s recap with the rest of the deal&apos;s files. Adds a new file; never overwrites one.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Folder</label>
          <input
            type="text"
            value={folder}
            onChange={(e) => {
              setFolder(e.target.value);
              setSaved(null);
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeTranscript}
            onChange={(e) => {
              setIncludeTranscript(e.target.checked);
              setSaved(null);
            }}
          />
          Include the full transcript
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          {saved ? (
            <a
              href={saved.link}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700"
            >
              Saved to {saved.path} ↗
            </a>
          ) : (
            <button
              type="button"
              onClick={() => void save({ folder, includeTranscript })}
              disabled={saving || !folder.trim()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save to Dropbox"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
