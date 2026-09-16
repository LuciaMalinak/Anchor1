"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MicRecorder } from "@/components/MicRecorder";
import { DEAL_STAGES } from "@/lib/dealStages";

type MeetingStatus =
  | "joining"
  | "recording"
  | "uploaded"
  | "transcribing"
  | "summarizing"
  | "ready"
  | "failed";

type DealMeeting = {
  id: string;
  title: string;
  status: MeetingStatus;
  occurredAt: string;
  errorMessage: string | null;
  summary: {
    overview: string;
    keyPoints: string[];
    actionItems: { text: string; owner: string | null }[];
    continuityNote: string | null;
  } | null;
};

type DealFile = {
  id: string;
  fileName: string;
  fileSize: number | null;
  createdAt: string;
};

const STATUS_LABEL: Record<MeetingStatus, string> = {
  joining: "Joining meeting…",
  recording: "Recording…",
  uploaded: "Queued",
  transcribing: "Transcribing…",
  summarizing: "Summarizing…",
  ready: "Ready",
  failed: "Failed",
};

type Tab = "before" | "during" | "after";

function TabBar({ active, onChange, duringCount }: { active: Tab; onChange: (t: Tab) => void; duringCount: number }) {
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "before", label: "Before" },
    { key: "during", label: "During", badge: duringCount || undefined },
    { key: "after", label: "After" },
  ];
  return (
    <div className="flex gap-2">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`relative rounded-md px-4 py-1.5 text-xs font-semibold tracking-[0.15em] transition ${
            active === t.key
              ? "bg-brand text-white"
              : "border border-slate-300 text-slate-500 hover:border-slate-400"
          }`}
        >
          {t.label.toUpperCase()}
          {t.badge ? (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
              {t.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function NewMeetingForms({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploadError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setUploadError("Choose a recording first.");
      return;
    }
    formData.set("dealId", dealId);
    setUploading(true);
    try {
      const res = await fetch("/api/meetings", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      form.reset();
      router.refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleJoin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setJoinError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const meetingUrl = String(formData.get("meetingUrl") || "").trim();
    const title = String(formData.get("title") || "").trim();
    if (!meetingUrl) {
      setJoinError("Paste a meeting link first.");
      return;
    }
    setJoining(true);
    try {
      const res = await fetch("/api/meetings/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl, title, dealId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't send Anchor to that meeting");
      }
      form.reset();
      router.refresh();
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Couldn't send Anchor to that meeting");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <form onSubmit={handleJoin} className="rounded-lg border border-slate-200 p-4">
        <p className="text-sm font-medium text-slate-900">Send Anchor to a live meeting</p>
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            name="title"
            placeholder="Title (optional)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            type="text"
            name="meetingUrl"
            placeholder="https://zoom.us/j/..."
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={joining}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {joining ? "Sending…" : "Join meeting"}
          </button>
        </div>
        {joinError && <p className="mt-2 text-xs text-red-600">{joinError}</p>}
      </form>

      <form onSubmit={handleUpload} className="rounded-lg border border-slate-200 p-4">
        <p className="text-sm font-medium text-slate-900">Upload a recording</p>
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            name="title"
            placeholder="Title (optional)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            type="file"
            name="file"
            accept="audio/*,video/*"
            required
            className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            type="submit"
            disabled={uploading}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        {uploadError && <p className="mt-2 text-xs text-red-600">{uploadError}</p>}
      </form>

      <MicRecorder dealId={dealId} onUploaded={() => router.refresh()} />
    </div>
  );
}

function BeforePanel({
  dealId,
  memory,
  latestReady,
}: {
  dealId: string;
  memory: string | null;
  latestReady: DealMeeting | undefined;
}) {
  const goingIn = memory || latestReady?.summary?.continuityNote || null;
  return (
    <div className="flex flex-col gap-6">
      {goingIn ? (
        <div className="rounded-lg border border-accent/40 bg-accent/5 px-5 py-4">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-accent">
            GOING IN, REMEMBER
          </p>
          <p className="mt-1 text-sm text-slate-700">{goingIn}</p>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          No prior meetings on this deal yet — the first one starts the record.
        </p>
      )}
      <NewMeetingForms dealId={dealId} />
    </div>
  );
}

type DealProfile = {
  id: string;
  name: string;
  stage: string;
  primaryContactName: string | null;
  primaryContactRole: string | null;
  primaryContactEmail: string | null;
};

function DealProfileCard({ deal }: { deal: DealProfile }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState(deal.stage);
  const [contactName, setContactName] = useState(deal.primaryContactName || "");
  const [contactRole, setContactRole] = useState(deal.primaryContactRole || "");
  const [contactEmail, setContactEmail] = useState(deal.primaryContactEmail || "");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          primaryContactName: contactName,
          primaryContactRole: contactRole,
          primaryContactEmail: contactEmail,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save");
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Stage</label>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          >
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Primary contact</label>
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Their role</label>
          <input
            type="text"
            value={contactRole}
            onChange={(e) => setContactRole(e.target.value)}
            placeholder="e.g. VP Ops"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Their email</label>
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="name@company.com"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
          >
            Cancel
          </button>
        </div>
        {error && <p className="w-full text-xs text-red-600">{error}</p>}
      </form>
    );
  }

  const hasContact = deal.primaryContactName || deal.primaryContactRole || deal.primaryContactEmail;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
          {deal.stage}
        </span>
        {hasContact ? (
          <span className="text-sm text-slate-600">
            {deal.primaryContactName}
            {deal.primaryContactRole ? ` — ${deal.primaryContactRole}` : ""}
            {deal.primaryContactEmail ? (
              <span className="text-slate-400"> · {deal.primaryContactEmail}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-sm text-slate-400">No primary contact set</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs font-medium text-brand hover:underline"
      >
        Edit
      </button>
    </div>
  );
}

type ChatTurn = { role: "user" | "assistant"; content: string };

function AskAnchorPanel({ dealId }: { dealId: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleAsk(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = question.trim();
    if (!q || asking) return;
    setError(null);
    setQuestion("");
    const nextTurns: ChatTurn[] = [...turns, { role: "user", content: q }];
    setTurns(nextTurns);
    setAsking(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: turns }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Anchor couldn't answer that.");
      setTurns([...nextTurns, { role: "assistant", content: body.answer }]);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anchor couldn't answer that.");
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-3">
        <p className="text-sm font-medium text-slate-900">Ask Anchor</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Grounded in this deal&apos;s past meetings, action items, and files — ask for a
          quick answer or talking point mid-meeting.
        </p>
      </div>

      {turns.length > 0 && (
        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto px-5 py-4">
          {turns.map((t, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                t.role === "user"
                  ? "self-end bg-brand text-white"
                  : "self-start bg-slate-100 text-slate-800"
              }`}
            >
              {t.content}
            </div>
          ))}
          {asking && (
            <div className="self-start rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400">
              Thinking…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <form onSubmit={handleAsk} className="flex items-center gap-2 border-t border-slate-200 p-3">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What did they push back on last time?"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={asking || !question.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark disabled:opacity-50"
        >
          Ask
        </button>
      </form>
      {error && <p className="px-3 pb-3 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function DuringPanel({ dealId, inProgress }: { dealId: string; inProgress: DealMeeting[] }) {
  return (
    <div className="flex flex-col gap-6">
      {inProgress.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing live right now.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {inProgress.map((m) => (
            <Link
              key={m.id}
              href={`/dashboard/meetings/${m.id}`}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-4 hover:border-slate-300"
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-slate-900">{m.title}</span>
              </div>
              <span className="text-xs font-medium text-amber-600">{STATUS_LABEL[m.status]}</span>
            </Link>
          ))}
        </div>
      )}
      <AskAnchorPanel dealId={dealId} />
    </div>
  );
}

function AfterPanel({
  dealId,
  readyMeetings,
  files,
  teamSize,
}: {
  dealId: string;
  readyMeetings: DealMeeting[];
  files: DealFile[];
  teamSize: number;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  async function handleSend() {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/send-summary`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't send");
      setSendResult(`Sent to ${body.sentTo.length} team member${body.sentTo.length === 1 ? "" : "s"} ✓`);
    } catch (err) {
      setSendResult(err instanceof Error ? err.message : "Couldn't send");
    } finally {
      setSending(false);
    }
  }

  async function handleFileUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFileError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setFileError("Choose a file first.");
      return;
    }
    setUploadingFile(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/files`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      form.reset();
      router.refresh();
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingFile(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-4">
        {readyMeetings.length === 0 ? (
          <p className="text-sm text-slate-500">No finished meetings on this deal yet.</p>
        ) : (
          readyMeetings.map((m) => (
            <div key={m.id} className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between rounded-t-lg bg-brand px-5 py-3 text-white">
                <span className="text-sm font-semibold">{m.title}</span>
                <Link href={`/dashboard/meetings/${m.id}`} className="text-xs text-slate-300 hover:text-white">
                  Full transcript →
                </Link>
              </div>
              {m.summary && (
                <div className="space-y-3 px-5 py-4">
                  <p className="text-sm text-slate-700">{m.summary.overview}</p>
                  {m.summary.actionItems.length > 0 && (
                    <div className="divide-y divide-slate-100 text-sm">
                      {m.summary.actionItems.map((a, i) => (
                        <div key={i} className="flex items-center justify-between py-1.5">
                          <span className="text-slate-700">{a.text}</span>
                          {a.owner && <span className="text-slate-500">{a.owner}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-slate-200 px-5 py-5">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-accent">SHARE THIS RECAP</p>
          <p className="mt-2 text-sm text-slate-600">
            Send the latest recap to all {teamSize} team member{teamSize === 1 ? "" : "s"}.
          </p>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || readyMeetings.length === 0}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send summary to team"}
          </button>
          {sendResult && <p className="mt-2 text-xs text-slate-600">{sendResult}</p>}
        </div>

        <div className="rounded-lg border border-slate-200 px-5 py-5">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-accent">FILES</p>
          <ul className="mt-3 flex flex-col gap-2">
            {files.map((f) => (
              <li key={f.id}>
                <a
                  href={`/api/deals/${dealId}/files/${f.id}`}
                  className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  <span className="truncate">{f.fileName}</span>
                  <span className="ml-2 shrink-0 text-xs text-slate-400">
                    {f.fileSize ? `${Math.round(f.fileSize / 1024)}KB` : ""}
                  </span>
                </a>
              </li>
            ))}
            {files.length === 0 && <p className="text-sm text-slate-500">No files yet.</p>}
          </ul>
          <form onSubmit={handleFileUpload} className="mt-3 flex flex-col gap-2">
            <input
              type="file"
              name="file"
              required
              className="text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            <button
              type="submit"
              disabled={uploadingFile}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50"
            >
              {uploadingFile ? "Uploading…" : "Attach a file"}
            </button>
            {fileError && <p className="text-xs text-red-600">{fileError}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}

export function DealTabs({
  deal,
  meetings,
  files,
  teamSize,
}: {
  deal: DealProfile & { memory: string | null };
  meetings: DealMeeting[];
  files: DealFile[];
  teamSize: number;
}) {
  const inProgress = meetings.filter((m) => m.status !== "ready" && m.status !== "failed");
  const readyMeetings = meetings.filter((m) => m.status === "ready");
  const [tab, setTab] = useState<Tab>(inProgress.length > 0 ? "during" : "before");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{deal.name}</h1>
        <TabBar active={tab} onChange={setTab} duringCount={inProgress.length} />
      </div>
      <DealProfileCard deal={deal} />
      {tab === "before" && (
        <BeforePanel dealId={deal.id} memory={deal.memory} latestReady={readyMeetings[0]} />
      )}
      {tab === "during" && <DuringPanel dealId={deal.id} inProgress={inProgress} />}
      {tab === "after" && (
        <AfterPanel dealId={deal.id} readyMeetings={readyMeetings} files={files} teamSize={teamSize} />
      )}
    </div>
  );
}
