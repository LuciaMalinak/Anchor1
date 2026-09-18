"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useMicRecorder, MicRecorderView, RecordingBanner, type MicRecorderState } from "@/components/MicRecorder";
import { DEAL_STAGES } from "@/lib/dealStages";
import { getCompanyLogoUrl } from "@/lib/companyLogo";
import { HEALTH_LABEL, HEALTH_BADGE_CLASSES, HEALTH_DOT_CLASSES, type DealHealth } from "@/lib/dealHealth";
import { LiveMeetingPanel } from "@/components/LiveMeetingPanel";

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
  scheduledAt: string | null;
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
  readableByAI: boolean;
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

type Tab = "before" | "during" | "after" | "chat";

// Each tab gets its own active-state color so Before/During/After/Chat
// read as distinct stages/areas at a glance.
const TAB_ACTIVE_CLASSES: Record<Tab, string> = {
  before: "bg-brand text-white",
  during: "bg-emerald-600 text-white",
  after: "bg-accent text-white",
  chat: "bg-indigo-600 text-white",
};

function TabBar({
  active,
  onChange,
  duringCount,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  duringCount: number;
}) {
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "before", label: "Before" },
    { key: "during", label: "During", badge: duringCount || undefined },
    { key: "after", label: "After" },
    { key: "chat", label: "Chat" },
  ];
  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`relative rounded-lg px-6 py-2.5 text-sm font-semibold tracking-[0.1em] transition ${
            active === t.key
              ? TAB_ACTIVE_CLASSES[t.key]
              : "border border-slate-300 text-slate-500 hover:border-slate-400"
          }`}
        >
          {t.label.toUpperCase()}
          {t.badge ? (
            <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold text-white">
              {t.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function NewMeetingForms({
  dealId,
  mic,
  onJoinedNow,
}: {
  dealId: string;
  mic: MicRecorderState;
  onJoinedNow: () => void;
}) {
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
    const scheduledAtLocal = String(formData.get("scheduledAt") || "").trim();
    if (!meetingUrl) {
      setJoinError("Paste a meeting link first.");
      return;
    }
    // The <input type="datetime-local"> value has no timezone — treat it
    // as the browser's own local time, same as any calendar app would.
    const scheduledAt = scheduledAtLocal ? new Date(scheduledAtLocal).toISOString() : undefined;
    setJoining(true);
    try {
      const res = await fetch("/api/meetings/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl, title, dealId, scheduledAt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't send Anchor to that meeting");
      }
      form.reset();
      router.refresh();
      // Only jump straight to During for an immediate join — a
      // scheduled-for-later one shows up as "upcoming" on Before instead,
      // and the tab switches on its own once that time arrives.
      if (!scheduledAt) onJoinedNow();
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Couldn't send Anchor to that meeting");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <form onSubmit={handleJoin} className="rounded-xl border border-slate-200 border-l-4 border-l-brand bg-white p-6 shadow-sm">
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
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">
              Join at (optional — leave blank to join right now)
            </span>
            <input
              type="datetime-local"
              name="scheduledAt"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
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

      <form onSubmit={handleUpload} className="rounded-xl border border-slate-200 border-l-4 border-l-accent bg-white p-6 shadow-sm">
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

      <MicRecorderView {...mic} />
    </div>
  );
}

function BeforePanel({
  dealId,
  dealName,
  memory,
  latestReady,
  decisionBoundaries,
  mic,
  upcoming,
  onJoinedNow,
}: {
  dealId: string;
  dealName: string;
  memory: string | null;
  latestReady: DealMeeting | undefined;
  decisionBoundaries: string | null;
  mic: MicRecorderState;
  upcoming: DealMeeting[];
  onJoinedNow: () => void;
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
      {upcoming.map((m) => (
        <div
          key={m.id}
          className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3"
        >
          <span className="h-2 w-2 rounded-full bg-brand" />
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-900">{m.title}</span> — Anchor will join
            automatically at{" "}
            {new Date(m.scheduledAt!).toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
            . This tab will switch to During on its own once it starts — nothing to come back and
            click.
          </p>
        </div>
      ))}
      <HandoffPanel dealId={dealId} dealName={dealName} initialDecisionBoundaries={decisionBoundaries} />
      <NewMeetingForms dealId={dealId} mic={mic} onJoinedNow={onJoinedNow} />
    </div>
  );
}

function HandoffPanel({
  dealId,
  dealName,
  initialDecisionBoundaries,
}: {
  dealId: string;
  dealName: string;
  initialDecisionBoundaries: string | null;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [boundaries, setBoundaries] = useState(initialDecisionBoundaries || "");
  const [editingBoundaries, setEditingBoundaries] = useState(false);
  const [savingBoundaries, setSavingBoundaries] = useState(false);
  const [boundariesError, setBoundariesError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<HandoffBriefing | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSaveBoundaries() {
    setSavingBoundaries(true);
    setBoundariesError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisionBoundaries: boundaries }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save");
      }
      setEditingBoundaries(false);
      router.refresh();
    } catch (err) {
      setBoundariesError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSavingBoundaries(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/deals/${dealId}/handoff`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't generate a briefing");
      setBriefing(body.briefing);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Couldn't generate a briefing");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!briefing) return;
    const text = `Handoff briefing — ${dealName}

WHAT'S BEEN DECIDED
${briefing.whatWasDecided}

WHAT TO PUSH ON
${briefing.whatToPushOn}

WHAT TO FOCUS ON
${briefing.focusAreas}

PERSONAL TOUCHES
${briefing.personalTouches}

WHAT THEY CAN DECIDE ON THEIR OWN
${boundaries || "Nothing set yet — check with the deal owner before committing to anything specific."}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail depending on context — non-fatal, the
      // text is still fully visible on screen to select and copy by hand.
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="self-start rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-slate-400"
      >
        Prepping someone else to run this meeting?
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-900">Handoff briefing</p>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          Close
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-slate-500">
            What they&apos;re allowed to decide on their own
          </label>
          {!editingBoundaries && (
            <button
              type="button"
              onClick={() => setEditingBoundaries(true)}
              className="text-xs font-medium text-brand hover:underline"
            >
              {boundaries ? "Edit" : "Set boundaries"}
            </button>
          )}
        </div>
        {editingBoundaries ? (
          <>
            <textarea
              value={boundaries}
              onChange={(e) => setBoundaries(e.target.value)}
              placeholder="e.g. Can offer up to 10% discount, can confirm the standard timeline. Can't commit to custom features or sign anything — bring that back to me."
              rows={3}
              autoFocus
              className="resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="mt-1 flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveBoundaries}
                disabled={savingBoundaries}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {savingBoundaries ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingBoundaries(false);
                  setBoundaries(initialDecisionBoundaries || "");
                }}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
            </div>
            {boundariesError && <p className="text-xs text-red-600">{boundariesError}</p>}
          </>
        ) : (
          <p className="text-sm text-slate-700">
            {boundaries || (
              <span className="text-slate-400">
                Not set — this is reused every time you generate a briefing for this deal.
              </span>
            )}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating}
        className="self-start rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
      >
        {generating ? "Generating…" : briefing ? "Regenerate briefing" : "Generate handoff briefing"}
      </button>
      {genError && <p className="text-xs text-red-600">{genError}</p>}

      {briefing && (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.15em] text-slate-500">
              WHAT&apos;S BEEN DECIDED
            </p>
            <p className="mt-1 text-sm text-slate-700">{briefing.whatWasDecided}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.15em] text-slate-500">WHAT TO PUSH ON</p>
            <p className="mt-1 text-sm text-slate-700">{briefing.whatToPushOn}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.15em] text-slate-500">
              WHAT TO FOCUS ON
            </p>
            <p className="mt-1 text-sm text-slate-700">{briefing.focusAreas}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.15em] text-slate-500">
              PERSONAL TOUCHES
            </p>
            <p className="mt-1 text-sm text-slate-700">{briefing.personalTouches}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-[0.15em] text-brand">
              WHAT THEY CAN DECIDE ON THEIR OWN
            </p>
            <p className="mt-1 text-sm text-slate-700">
              {boundaries || "Nothing set yet — check with the deal owner before committing to anything specific."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="self-start rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
          >
            {copied ? "Copied ✓" : "Copy to share"}
          </button>
        </div>
      )}
    </div>
  );
}

type DealProfile = {
  id: string;
  name: string;
  stage: string;
  health: DealHealth;
  primaryContactName: string | null;
  primaryContactRole: string | null;
  primaryContactEmail: string | null;
  companyWebsite: string | null;
  notes: string | null;
  companyResearch: string | null;
  companyResearchUpdatedAt: string | null;
  newsHeadline: string | null;
  decisionBoundaries: string | null;
  leadUserId: string | null;
  backupUserId: string | null;
};

type HandoffBriefing = {
  whatWasDecided: string;
  whatToPushOn: string;
  focusAreas: string;
  personalTouches: string;
};

// A company's own public logo — from their domain, never a photo of a
// person. Falls back to an initial in a colored circle when there's no
// domain to guess from, or the logo lookup 404s.
function CompanyMark({ deal, size = 48 }: { deal: DealProfile; size?: number }) {
  const [failed, setFailed] = useState(false);
  const logoUrl = getCompanyLogoUrl(deal.companyWebsite, deal.primaryContactEmail);

  if (logoUrl && !failed) {
    return (
      <Image
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        unoptimized
        onError={() => setFailed(true)}
        className="rounded-lg border border-slate-200 bg-white object-contain p-1.5"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg bg-brand text-white font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {deal.name[0]?.toUpperCase() || "?"}
    </div>
  );
}

function DealHeaderCard({ deal }: { deal: DealProfile }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState(deal.stage);
  const [contactName, setContactName] = useState(deal.primaryContactName || "");
  const [contactRole, setContactRole] = useState(deal.primaryContactRole || "");
  const [contactEmail, setContactEmail] = useState(deal.primaryContactEmail || "");
  const [website, setWebsite] = useState(deal.companyWebsite || "");
  const [notes, setNotes] = useState(deal.notes || "");

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
          companyWebsite: website,
          notes,
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
        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:flex-wrap sm:items-end"
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
          <label className="text-xs font-medium text-slate-500">Company website</label>
          <input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="acme.com"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
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
        <div className="flex w-full flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Your notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything you want Anchor to remember that didn't come from a meeting — background, context, a heads up for your team…"
            rows={3}
            className="resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <CompanyMark deal={deal} />
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
                {deal.stage}
              </span>
              <span
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${HEALTH_BADGE_CLASSES[deal.health]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT_CLASSES[deal.health]}`} aria-hidden="true" />
                {HEALTH_LABEL[deal.health]}
              </span>
              {deal.companyWebsite && (
                <a
                  href={deal.companyWebsite.startsWith("http") ? deal.companyWebsite : `https://${deal.companyWebsite}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-slate-400 hover:text-brand hover:underline"
                >
                  {deal.companyWebsite.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
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
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-brand hover:underline"
        >
          Edit
        </button>
      </div>

      {deal.notes && (
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-3">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-slate-400">YOUR NOTES</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{deal.notes}</p>
        </div>
      )}
    </div>
  );
}

// A small pulsing dot to give the sidebar a "this is live" feel, next to
// each section's refresh control.
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

// Persistent right-hand sidebar — always visible on every tab, including
// During, so whoever's in the room (and Ask Anchor) has this deal's news
// in view throughout the meeting, not just before/after it. Deal-specific
// only — the general, team-wide briefing lives in the main dashboard
// layout's sidebar (GeneralNewsSidebar) instead, so this one tab doesn't
// mix "what's happening at Acme" with "what's happening in the world."
function NewsSidebar({
  dealName,
  companyResearch,
  researchUpdatedAt,
  newsHeadline,
  researching,
  researchError,
  onResearch,
}: {
  dealName: string;
  companyResearch: string | null;
  researchUpdatedAt: string | null;
  newsHeadline: string | null;
  researching: boolean;
  researchError: string | null;
  onResearch: () => void;
}) {
  return (
    <aside className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">
      <div className="flex items-center gap-2 px-1">
        <LiveDot />
        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold tracking-[0.15em] text-accent">
          NEWS
        </span>
      </div>

      {newsHeadline && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-amber-700">
            {dealName.toUpperCase()}
          </p>
          <p className="mt-1 text-sm text-amber-900">{newsHeadline}</p>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 border-l-4 border-l-brand bg-white px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-brand">
            {dealName.toUpperCase()}
          </p>
          <button
            type="button"
            onClick={onResearch}
            disabled={researching}
            className="shrink-0 text-xs font-medium text-brand hover:underline disabled:opacity-50"
          >
            {researching ? "…" : companyResearch ? "Refresh" : "Research"}
          </button>
        </div>
        {companyResearch ? (
          <>
            <p className="mt-1 text-sm text-slate-700">{companyResearch}</p>
            {researchUpdatedAt && (
              <p className="mt-1 text-[11px] text-slate-400">
                {new Date(researchUpdatedAt).toLocaleDateString()}
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-400">
            Have Anchor search the web for public info about this company.
          </p>
        )}
        {researchError && <p className="mt-1 text-xs text-red-600">{researchError}</p>}
      </div>

      <p className="px-1 text-[11px] text-slate-400">
        Updates automatically once a day, or hit Refresh any time. Ask Anchor also uses this during
        the meeting so its answers can factor in recent news.
      </p>
    </aside>
  );
}

type ChatMessage = {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string | null; email: string; image: string | null };
};

function ChatPanel({
  dealId,
  currentUserId,
  initialMessages,
}: {
  dealId: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't send that");
      setMessages((prev) => [...prev, body.message]);
      setDraft("");
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-sm font-medium text-slate-900">Team chat</p>
        <p className="text-xs text-slate-500">Just for this deal — anyone on your team with access can read and post here.</p>
      </div>

      <div className="flex max-h-[28rem] min-h-[10rem] flex-col gap-3 overflow-y-auto rounded-lg bg-slate-50 p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">No messages yet — say something about this deal.</p>
        ) : (
          messages.map((m) => {
            const isYou = m.author.id === currentUserId;
            const label = m.author.name || m.author.email;
            return (
              <div key={m.id} className={`flex flex-col ${isYou ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-2">
                  {!isYou &&
                    (m.author.image ? (
                      <Image
                        src={m.author.image}
                        alt=""
                        width={20}
                        height={20}
                        unoptimized
                        className="h-5 w-5 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[9px] font-semibold text-white">
                        {label[0]?.toUpperCase()}
                      </span>
                    ))}
                  <span className="text-xs font-medium text-slate-500">{isYou ? "You" : label}</span>
                  <span className="text-[11px] text-slate-400">
                    {new Date(m.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div
                  className={`mt-1 max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    isYou ? "bg-brand text-white" : "border border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend(e);
            }
          }}
          placeholder="Message your team about this deal…"
          rows={2}
          className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

type DealContact = {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  relationshipSummary: string | null;
  meetingCount: number;
};

type TeamMember = {
  id: string;
  name: string | null;
  email: string;
  title: string | null;
  image: string | null;
};

function InitialsAvatar({ label, size = 36 }: { label: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {label[0]?.toUpperCase() || "?"}
    </span>
  );
}

function PeopleAndTeam({
  dealId,
  people,
  team,
  leadUserId: initialLeadUserId,
  backupUserId: initialBackupUserId,
}: {
  dealId: string;
  people: DealContact[];
  team: TeamMember[];
  leadUserId: string | null;
  backupUserId: string | null;
}) {
  const router = useRouter();
  const [leadUserId, setLeadUserId] = useState(initialLeadUserId);
  const [backupUserId, setBackupUserId] = useState(initialBackupUserId);
  const [saving, setSaving] = useState<"lead" | "backup" | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  async function handleRoleChange(field: "leadUserId" | "backupUserId", value: string) {
    const newValue = value || null;
    if (field === "leadUserId") setLeadUserId(newValue);
    else setBackupUserId(newValue);
    setSaving(field === "leadUserId" ? "lead" : "backup");
    setRoleError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: newValue }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save");
      }
      router.refresh();
    } catch (err) {
      setRoleError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-slate-900">People involved</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Who Anchor has recognized speaking in this deal&apos;s meetings.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {people.length === 0 ? (
            <p className="text-sm text-slate-400">No one resolved yet — this fills in after a meeting.</p>
          ) : (
            people.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/contacts/${p.id}`}
                className="flex items-start gap-3 rounded-lg px-1 py-1 hover:bg-slate-50"
              >
                <InitialsAvatar label={p.name} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{p.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[p.role, p.company].filter(Boolean).join(" · ") || "No details yet"}
                  </p>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-slate-900">Your team</p>
        <p className="mt-0.5 text-xs text-slate-500">Everyone with access to this deal.</p>

        <div className="mt-3 flex flex-col gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <label className="w-28 shrink-0 text-xs font-medium text-slate-500">Deal lead</label>
            <select
              value={leadUserId ?? ""}
              onChange={(e) => handleRoleChange("leadUserId", e.target.value)}
              disabled={saving === "lead"}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50"
            >
              <option value="">Not set</option>
              {team.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.email}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-28 shrink-0 text-xs font-medium text-slate-500">Backup / stepping in</label>
            <select
              value={backupUserId ?? ""}
              onChange={(e) => handleRoleChange("backupUserId", e.target.value)}
              disabled={saving === "backup"}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50"
            >
              <option value="">Not set</option>
              {team.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.email}
                </option>
              ))}
            </select>
          </div>
          {roleError && <p className="text-xs text-red-600">{roleError}</p>}
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {team.map((t) => (
            <div key={t.id} className="flex items-center gap-3">
              {t.image ? (
                <Image
                  src={t.image}
                  alt=""
                  width={36}
                  height={36}
                  unoptimized
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                <InitialsAvatar label={t.name || t.email} />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                  <span className="truncate">{t.name || t.email}</span>
                  {t.id === leadUserId && (
                    <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                      Lead
                    </span>
                  )}
                  {t.id === backupUserId && (
                    <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      Backup
                    </span>
                  )}
                </p>
                {t.title && <p className="truncate text-xs text-slate-500">{t.title}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type ChatTurn = { role: "user" | "assistant"; content: string };

function AskAnchorPanel({ dealId }: { dealId: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  // The answer as it streams in, word by word, before it's a finished
  // turn — shown as its own bubble so the first words appear almost
  // immediately instead of everyone staring at "Thinking…" for a few
  // seconds while the full answer is generated.
  const [streamingAnswer, setStreamingAnswer] = useState("");
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
    setStreamingAnswer("");
    try {
      const res = await fetch(`/api/deals/${dealId}/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: turns }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Anchor couldn't answer that.");
      }
      if (!res.body) throw new Error("Anchor couldn't answer that.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setStreamingAnswer(answer);
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
      if (!answer.trim()) throw new Error("Anchor couldn't answer that.");
      setTurns([...nextTurns, { role: "assistant", content: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anchor couldn't answer that.");
    } finally {
      setAsking(false);
      setStreamingAnswer("");
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
            <div className="max-w-[85%] self-start rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">
              {streamingAnswer || <span className="text-slate-400">Thinking…</span>}
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

function DuringPanel({
  dealId,
  inProgress,
  newsHeadline,
  files,
  mic,
}: {
  dealId: string;
  inProgress: DealMeeting[];
  newsHeadline: string | null;
  files: DealFile[];
  mic: MicRecorderState;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-6">
        {newsHeadline && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <LiveDot />
            <p className="text-sm text-amber-900">
              <span className="font-semibold">In the news right now:</span> {newsHeadline}
            </p>
          </div>
        )}
        {inProgress.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing live right now — Anchor isn&apos;t in a call for this deal. If you&apos;re in
            the room, record it from here instead:
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {inProgress.map((m) =>
              m.status === "joining" || m.status === "recording" ? (
                // A bot Anchor sent into a Zoom/Meet/Teams call — show the
                // live transcript + coaching panel instead of just a link,
                // since there's something to actually watch while it runs.
                <LiveMeetingPanel key={m.id} meetingId={m.id} title={m.title} />
              ) : (
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
              )
            )}
          </div>
        )}
        {/* The mic-recording control previously lived only on the Before
            tab, so there was no way to start an in-person recording once
            you'd actually moved to During — the tab meant to represent
            "a meeting is happening now". Show it here too; MicRecorderView
            is stateless and driven by the same lifted `mic` hook, so
            starting it here (or on Before) and switching tabs never stops
            it, and it already shows "Stop" here if a recording (started
            from either tab) is in progress. */}
        <MicRecorderView {...mic} />
        <AskAnchorPanel dealId={dealId} />
      </div>
      <div className="flex flex-col gap-4">
        <FilesSection dealId={dealId} files={files} />
      </div>
    </div>
  );
}

function FilesSection({ dealId, files }: { dealId: string; files: DealFile[] }) {
  const router = useRouter();
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

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
    <div className="rounded-lg border border-slate-200 px-5 py-5">
      <p className="text-[11px] font-semibold tracking-[0.15em] text-accent">FILES</p>
      <p className="mt-1 text-xs text-slate-500">
        Text files, PDFs, and Word docs are readable by Ask Anchor — attach contracts, notes,
        or specs and Anchor can answer questions using what&apos;s in them.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {files.map((f) => (
          <li key={f.id}>
            <a
              href={`/api/deals/${dealId}/files/${f.id}`}
              className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{f.fileName}</span>
                {f.readableByAI && (
                  <span
                    className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent"
                    title="Anchor can read this file's contents"
                  >
                    AI-readable
                  </span>
                )}
              </span>
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
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);

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

        <FilesSection dealId={dealId} files={files} />
      </div>
    </div>
  );
}

export function DealTabs({
  deal,
  meetings,
  files,
  teamSize,
  people,
  team,
  messages,
  currentUserId,
}: {
  deal: DealProfile & { memory: string | null };
  meetings: DealMeeting[];
  files: DealFile[];
  teamSize: number;
  people: DealContact[];
  team: TeamMember[];
  messages: ChatMessage[];
  currentUserId: string;
}) {
  // "Now", as state rather than a bare Date.now() call during render —
  // starts null (so the initial/SSR render and first client render
  // agree there's nothing "upcoming" yet) and gets set client-side by
  // the effect below, which also re-ticks it periodically.
  const [nowMs, setNowMs] = useState<number | null>(null);

  // A meeting scheduled for a future time (see NewMeetingForms' "Join
  // at" field) sits in "upcoming" — shown on the Before tab as
  // something queued up — until that time arrives, rather than
  // cluttering the During tab/badge with something that isn't live yet.
  // Before nowMs is known (the very first render, pre-mount), treat any
  // joining+scheduled meeting as upcoming rather than as already live —
  // otherwise the very first render (which is also what the initial tab
  // below is picked from) would briefly count a meeting scheduled hours
  // out as "in progress" and jump straight to During before the mount
  // effect below gets a chance to compute the real answer.
  const upcoming = meetings.filter(
    (m) =>
      m.status === "joining" &&
      m.scheduledAt &&
      (nowMs === null || new Date(m.scheduledAt).getTime() > nowMs)
  );
  const upcomingIds = new Set(upcoming.map((m) => m.id));
  const inProgress = meetings.filter(
    (m) => m.status !== "ready" && m.status !== "failed" && !upcomingIds.has(m.id)
  );
  const readyMeetings = meetings.filter((m) => m.status === "ready");
  // A bot Anchor actually confirmed is in the call (as opposed to still
  // "joining") — used to show the live panel alongside whichever tab is
  // active, for when you're running late and still want prep visible.
  const liveMeetings = meetings.filter((m) => m.status === "recording");
  const [tab, setTab] = useState<Tab>(inProgress.length > 0 ? "during" : "before");
  const router = useRouter();
  // Owned here, at the top of the tab switcher, so starting an in-person
  // recording and then clicking to a different tab doesn't unmount it and
  // kill the recording — only BeforePanel/DuringPanel below get unmounted
  // when the tab changes, this component does not.
  const mic = useMicRecorder({ dealId: deal.id, onUploaded: () => router.refresh() });

  // Ticks nowMs (so a scheduled meeting's card and inProgress status
  // stay current), and — once per meeting, tracked in firedRef so a
  // stalled bot that never flips out of "joining" doesn't yank the tab
  // back to During forever — refreshes and jumps to During right when a
  // scheduled meeting's time arrives, so there's nothing to come back
  // and click.
  const firedRef = useRef(new Set<string>());
  useEffect(() => {
    function tick() {
      const now = Date.now();
      setNowMs(now);
      const justDue = meetings.find(
        (m) =>
          m.status === "joining" &&
          m.scheduledAt &&
          new Date(m.scheduledAt).getTime() <= now &&
          !firedRef.current.has(m.id)
      );
      if (justDue) {
        firedRef.current.add(justDue.id);
        router.refresh();
        setTab("during");
      }
    }
    tick();
    const interval = setInterval(tick, 20_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings.map((m) => `${m.id}:${m.status}:${m.scheduledAt}`).join(",")]);

  // Company research + news lives here (not inside DealHeaderCard) so both
  // the News tab's badge and its content can share it.
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [companyResearch, setCompanyResearch] = useState(deal.companyResearch);
  const [researchUpdatedAt, setResearchUpdatedAt] = useState(deal.companyResearchUpdatedAt);
  const [newsHeadline, setNewsHeadline] = useState(deal.newsHeadline);

  async function handleResearch() {
    setResearching(true);
    setResearchError(null);
    try {
      const res = await fetch(`/api/deals/${deal.id}/research`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't research this company");
      setCompanyResearch(body.companyResearch);
      setResearchUpdatedAt(body.companyResearchUpdatedAt);
      setNewsHeadline(body.newsHeadline);
    } catch (err) {
      setResearchError(err instanceof Error ? err.message : "Couldn't research this company");
    } finally {
      setResearching(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold text-brand">{deal.name}</h1>
          <TabBar active={tab} onChange={setTab} duringCount={inProgress.length} />
        </div>
        <RecordingBanner {...mic} />
        <DealHeaderCard deal={deal} />
        <PeopleAndTeam
          dealId={deal.id}
          people={people}
          team={team}
          leadUserId={deal.leadUserId}
          backupUserId={deal.backupUserId}
        />
        {/* Running late and still on Before (or After/Chat)? Don't make
            switching tabs the only way to see a call that's already
            live — show it right here too. */}
        {tab !== "during" &&
          liveMeetings.map((m) => <LiveMeetingPanel key={m.id} meetingId={m.id} title={m.title} />)}
        {tab === "before" && (
          <BeforePanel
            dealId={deal.id}
            dealName={deal.name}
            memory={deal.memory}
            latestReady={readyMeetings[0]}
            decisionBoundaries={deal.decisionBoundaries}
            mic={mic}
            upcoming={upcoming}
            onJoinedNow={() => {
              router.refresh();
              setTab("during");
            }}
          />
        )}
        {tab === "during" && (
          <DuringPanel
            dealId={deal.id}
            inProgress={inProgress}
            newsHeadline={newsHeadline}
            files={files}
            mic={mic}
          />
        )}
        {tab === "after" && (
          <AfterPanel dealId={deal.id} readyMeetings={readyMeetings} files={files} teamSize={teamSize} />
        )}
        {tab === "chat" && (
          <ChatPanel dealId={deal.id} currentUserId={currentUserId} initialMessages={messages} />
        )}
      </div>
      {/* Always visible — including during a live meeting — so whoever's
          in the room can glance at recent news, and so it stays consistent
          with what Ask Anchor is grounded in. */}
      <NewsSidebar
        dealName={deal.name}
        companyResearch={companyResearch}
        researchUpdatedAt={researchUpdatedAt}
        newsHeadline={newsHeadline}
        researching={researching}
        researchError={researchError}
        onResearch={handleResearch}
      />
    </div>
  );
}
