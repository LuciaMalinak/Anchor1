"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { INDUSTRIES, INDUSTRY_BY_KEY, isIndustryKey } from "@/lib/industries";

type Member = { id: string; name: string | null; email: string; title: string | null; image: string | null };
type Invite = { id: string; email: string };
type Deal = { id: string; name: string };
type JoinRequest = {
  id: string;
  name: string;
  email: string;
  dealName: string;
  createdAt: string;
  deals: Deal[];
  teamName?: string;
};

export function TeamClient({
  teamId,
  teamName,
  members,
  invites,
  pendingRequests,
  otherTeamRequests,
  currentUserId,
  industry,
  isOwner,
}: {
  teamId: string;
  teamName: string;
  members: Member[];
  invites: Invite[];
  pendingRequests: JoinRequest[];
  otherTeamRequests: JoinRequest[];
  currentUserId: string;
  industry: string | null;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [savingIndustry, setSavingIndustry] = useState(false);
  const [industryError, setIndustryError] = useState<string | null>(null);
  // Once a team has an industry (almost always set automatically the
  // moment someone signs up through an industry link — see /sign-up and
  // /dashboard's setIndustry handling), the full button-grid picker is
  // more clutter than it's worth on every visit to this page. Collapse it
  // to a small confirmation line instead, and only expand back into the
  // picker if the owner explicitly asks to change it.
  const [showIndustryPicker, setShowIndustryPicker] = useState(!industry);

  async function handleIndustryChange(key: string | null) {
    setSavingIndustry(true);
    setIndustryError(null);
    try {
      const res = await fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry: key }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save that");
      }
      router.refresh();
    } catch (err) {
      setIndustryError(err instanceof Error ? err.message : "Couldn't save that");
    } finally {
      setSavingIndustry(false);
    }
  }

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});

  async function handleRemoveMember(member: Member) {
    if (
      !window.confirm(
        `Remove ${member.name || member.email} from the team? They'll lose access to every deal here — anything they already added (meetings, notes, chat messages) stays in place for the rest of the team.`
      )
    ) {
      return;
    }
    setRemovingId(member.id);
    setRemoveErrors((e) => ({ ...e, [member.id]: "" }));
    try {
      const res = await fetch(`/api/team/members/${member.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't remove them");
      }
      router.refresh();
    } catch (err) {
      setRemoveErrors((e) => ({
        ...e,
        [member.id]: err instanceof Error ? err.message : "Couldn't remove them",
      }));
    } finally {
      setRemovingId(null);
    }
  }

  const [joinUrl, setJoinUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // window.location only exists client-side, so this has to run in an
    // effect rather than during render (which also runs on the server).
    setJoinUrl(`${window.location.origin}/join/${teamId}`);
  }, [teamId]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't send the invite");
      setEmail("");
      setNotice(
        body.emailWarning
          ? `Added — but ${body.emailWarning}. They can still sign in with this email to join.`
          : "Invited — they'll join the team automatically the first time they sign in."
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the invite");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-brand">{teamName}</h1>
        <p className="text-sm text-slate-500">Everyone here shares deals, files, and recaps.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-900">Industry</h2>
        {industry && isIndustryKey(industry) && !showIndustryPicker ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: INDUSTRY_BY_KEY[industry].accent }}
                aria-hidden="true"
              />
              {INDUSTRY_BY_KEY[industry].label} — set when your team signed up.
            </p>
            {isOwner && (
              <button
                type="button"
                onClick={() => setShowIndustryPicker(true)}
                className="shrink-0 text-xs font-medium text-brand hover:underline"
              >
                Change
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">
              {isOwner
                ? "Pick the closest match — it gives the dashboard a small accent to match, and it's what future industry-specific Anchor features will build on."
                : "Set by your team owner — gives the dashboard a small accent to match."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!isOwner || savingIndustry}
                onClick={() => {
                  handleIndustryChange(null);
                  setShowIndustryPicker(true);
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-default ${
                  !industry
                    ? "border-brand bg-brand text-white"
                    : "border-slate-300 text-slate-600 hover:border-slate-400"
                } ${!isOwner ? "cursor-default opacity-70" : ""}`}
              >
                General
              </button>
              {INDUSTRIES.map((ind) => (
                <button
                  key={ind.key}
                  type="button"
                  disabled={!isOwner || savingIndustry}
                  onClick={() => {
                    handleIndustryChange(ind.key);
                    setShowIndustryPicker(false);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-default ${
                    industry === ind.key
                      ? "text-white"
                      : "border-slate-300 text-slate-600 hover:border-slate-400"
                  } ${!isOwner ? "cursor-default opacity-70" : ""}`}
                  style={
                    industry === ind.key
                      ? { backgroundColor: ind.accent, borderColor: ind.accent }
                      : undefined
                  }
                >
                  {ind.label}
                </button>
              ))}
            </div>
          </>
        )}
        {industryError && <p className="mt-2 text-sm text-red-600">{industryError}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 border-l-4 border-l-brand bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-900">Invite a teammate</h2>
        <form onSubmit={handleInvite} className="mt-3 flex flex-col gap-3 sm:flex-row sm:max-w-xl">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={sending}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
          >
            {sending ? "Sending…" : "Invite"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {notice && <p className="mt-2 text-sm text-slate-600">{notice}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-900">Let people request to join</h2>
        <p className="mt-1 text-sm text-slate-500">
          Share this link — anyone who fills it in shows up below as a pending request. Nothing
          happens until you approve them, and you pick which deal they get access to.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:max-w-xl sm:flex-row">
          <input
            readOnly
            value={joinUrl}
            onClick={(e) => e.currentTarget.select()}
            className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 outline-none"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(joinUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                // Clipboard access can fail quietly (permissions, non-secure
                // context) — the link's still selectable in the field above.
              }
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </section>

      {pendingRequests.length > 0 && (
        <PendingRequests
          title={`Requests to join (${pendingRequests.length})`}
          requests={pendingRequests}
          onDecided={() => router.refresh()}
        />
      )}

      {otherTeamRequests.length > 0 && (
        <PendingRequests
          title={`All requests across Anchor (${otherTeamRequests.length})`}
          description="Pending requests for every other team, since you're set up as the app owner."
          requests={otherTeamRequests}
          showTeamName
          onDecided={() => router.refresh()}
        />
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-900">Members ({members.length})</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {members.map((m) => {
            const isYou = m.id === currentUserId;
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                {isYou ? (
                  <Link href="/dashboard/profile" className="group relative shrink-0" title="Edit your photo">
                    {m.image ? (
                      <Image
                        src={m.image}
                        alt=""
                        width={44}
                        height={44}
                        unoptimized
                        className="h-11 w-11 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-base font-semibold text-white">
                        {(m.name || m.email)[0]?.toUpperCase()}
                      </span>
                    )}
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </span>
                  </Link>
                ) : m.image ? (
                  <Image
                    src={m.image}
                    alt=""
                    width={44}
                    height={44}
                    unoptimized
                    className="h-11 w-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-base font-semibold text-white">
                    {(m.name || m.email)[0]?.toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {m.name || m.email}
                    {isYou && <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>}
                  </p>
                  {m.title && <p className="truncate text-xs text-slate-500">{m.title}</p>}
                  <p className="truncate text-xs text-slate-400">{m.email}</p>
                </div>
                {isYou && (
                  <Link
                    href="/dashboard/profile"
                    className="shrink-0 text-xs font-medium text-brand hover:underline"
                  >
                    Edit
                  </Link>
                )}
                {isOwner && !isYou && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(m)}
                      disabled={removingId === m.id}
                      className="text-xs font-medium text-red-500 hover:underline disabled:opacity-50"
                    >
                      {removingId === m.id ? "Removing…" : "Remove"}
                    </button>
                    {removeErrors[m.id] && (
                      <p className="text-right text-[11px] text-red-600">{removeErrors[m.id]}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {invites.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-slate-900">Pending invites</h2>
          <ul className="flex flex-col gap-2">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3"
              >
                <span className="text-sm text-slate-600">{i.email}</span>
                <span className="text-xs text-slate-400">Waiting to sign in</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PendingRequests({
  title,
  description,
  requests,
  showTeamName,
  onDecided,
}: {
  title: string;
  description?: string;
  requests: JoinRequest[];
  showTeamName?: boolean;
  onDecided: () => void;
}) {
  const [selectedDeal, setSelectedDeal] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function decide(id: string, action: "approve" | "decline") {
    setErrors((e) => ({ ...e, [id]: "" }));
    if (action === "approve" && !selectedDeal[id]) {
      setErrors((e) => ({ ...e, [id]: "Pick which deal to grant them" }));
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/join-requests/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "approve" ? JSON.stringify({ dealId: selectedDeal[id] }) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Something went wrong");
      onDecided();
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-medium text-slate-900">{title}</h2>
      {description && <p className="mb-3 text-xs text-slate-500">{description}</p>}
      <div className={`flex flex-col gap-3 ${description ? "" : "mt-3"}`}>
        {requests.map((r) => (
          <div
            key={r.id}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 border-l-4 border-l-accent bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                {r.name} <span className="font-normal text-slate-400">· {r.email}</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Asking to join for <span className="font-medium text-slate-700">{r.dealName}</span>
                {showTeamName && r.teamName && (
                  <>
                    {" "}
                    <span className="text-slate-400">on</span>{" "}
                    <span className="font-medium text-slate-700">{r.teamName}</span>
                  </>
                )}
              </p>
              {errors[r.id] && <p className="mt-1 text-xs text-red-600">{errors[r.id]}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <select
                value={selectedDeal[r.id] || ""}
                onChange={(e) => setSelectedDeal((s) => ({ ...s, [r.id]: e.target.value }))}
                className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-brand"
              >
                <option value="">Grant access to…</option>
                {r.deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => decide(r.id, "approve")}
                className="rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => decide(r.id, "decline")}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
