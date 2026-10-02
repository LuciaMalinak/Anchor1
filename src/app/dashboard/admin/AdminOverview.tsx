import Link from "next/link";
import type { AdminOverview as Overview } from "@/lib/adminStats";
import { TREND_DAYS } from "@/lib/adminStats";
import { AdminMeetingActions } from "./AdminMeetingActions";

// The admin Overview: growth and activity across every account, then
// recordings that failed or got stuck. Data comes from loadAdminOverview
// (src/lib/adminStats.ts). Server-rendered; the charts are plain HTML bars
// with a native hover tooltip per day, nothing to load.

function fmtDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function timeAgo(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
        {value.toLocaleString()}
      </p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

// One series per chart, so no legend — the title names it. Bars are
// anchored to the baseline with rounded tops and a 2px gap; each day has
// a full-height hover target with its exact count.
function DailyBars({
  title,
  unit,
  days,
}: {
  title: string;
  unit: string;
  days: { day: string; count: number }[];
}) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">
          {total.toLocaleString()} in the last {TREND_DAYS} days
        </p>
      </div>
      <div className="relative mt-4 h-32">
        <span className="absolute -top-1 left-0 text-[10px] tabular-nums text-slate-400">
          {max}
        </span>
        <div className="absolute inset-x-0 bottom-0 border-t border-slate-200" />
        <div className="absolute inset-0 flex items-end gap-[2px] pl-5">
          {days.map((d) => (
            <div
              key={d.day}
              title={`${fmtDay(d.day)}: ${d.count} ${d.count === 1 ? unit : `${unit}s`}`}
              className="group flex h-full flex-1 items-end"
            >
              <div
                className="w-full rounded-t-[4px] bg-brand/80 transition-colors group-hover:bg-brand"
                style={{
                  height: d.count
                    ? `${Math.max(4, (d.count / max) * 100)}%`
                    : "0%",
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between pl-5 text-[10px] text-slate-400">
        <span>{fmtDay(days[0].day)}</span>
        <span>{fmtDay(days[days.length - 1].day)}</span>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      {source}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  joining: "Joining",
  recording: "Recording",
  uploaded: "Uploaded",
  transcribing: "Transcribing",
  summarizing: "Summarizing",
};

export function AdminOverview({ data }: { data: Overview }) {
  const healthy = data.failed.length === 0 && data.stuck.length === 0;
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-slate-900">
          Growth &amp; activity
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="People signed up"
            value={data.users.total}
            detail={`+${data.users.new7} this week · +${data.users.new30} in 30 days`}
          />
          <Stat
            label="Active this week"
            value={data.users.active7}
            detail={`${data.users.active30} active in 30 days`}
          />
          <Stat label="Teams" value={data.teams} />
          <Stat
            label="Meetings this week"
            value={data.meetings.week}
            detail={`${data.meetings.readyWeek} ready · ${data.meetings.failedWeek} failed · ${data.meetings.total.toLocaleString()} all time`}
          />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <DailyBars
            title="Sign-ups per day"
            unit="sign-up"
            days={data.signupsByDay}
          />
          <DailyBars
            title="Meetings per day"
            unit="meeting"
            days={data.meetingsByDay}
          />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white">
            <p className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">
              Most active teams{" "}
              <span className="font-normal text-slate-500">· last 30 days</span>
            </p>
            {data.topTeams.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-400">
                No meetings in the last 30 days.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.topTeams.map((t) => (
                  <li
                    key={t.teamId}
                    className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                  >
                    <Link
                      href={`/dashboard/admin/teams/${t.teamId}`}
                      className="min-w-0 truncate font-medium text-slate-900 hover:text-brand"
                    >
                      {t.name}
                    </Link>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {t.meetings} meetings · {t.people}{" "}
                      {t.people === 1 ? "person" : "people"} · last{" "}
                      {timeAgo(t.lastMeetingAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white">
            <p className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">
              Newest sign-ups
            </p>
            <ul className="divide-y divide-slate-100">
              {data.recentSignups.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-slate-900">
                      {u.name || u.email}
                    </span>
                    {u.name && (
                      <span className="text-slate-500"> · {u.email}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {u.teamId && u.teamName ? (
                      <Link
                        href={`/dashboard/admin/teams/${u.teamId}`}
                        className="hover:text-brand"
                      >
                        {u.teamName}
                      </Link>
                    ) : (
                      "No team"
                    )}{" "}
                    · {timeAgo(u.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-slate-900">
            Health &amp; errors
          </h2>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              healthy
                ? "bg-emerald-50 text-emerald-700"
                : "bg-rose-50 text-rose-700"
            }`}
          >
            {healthy
              ? "✓ All recordings healthy"
              : `⚠ ${data.failed.length} failed · ${data.stuck.length} stuck`}
          </span>
        </div>

        {data.commonErrors.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-semibold text-slate-900">
              Most common failures{" "}
              <span className="font-normal text-slate-500">· last 30 days</span>
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {data.commonErrors.map((e) => (
                <li key={e.message} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 w-8 shrink-0 text-right font-semibold tabular-nums text-rose-700">
                    {e.count}×
                  </span>
                  <span className="text-slate-700">{e.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ProblemTable
          title="Failed recordings"
          subtitle="last 14 days"
          empty="No failed recordings in the last 14 days."
          rows={data.failed.map((m) => ({
            id: m.id,
            title: m.title,
            when: timeAgo(m.updatedAt),
            teamId: m.teamId,
            teamName: m.teamName,
            userEmail: m.userEmail,
            source: m.source,
            detail: m.errorMessage || "(no error message)",
            tone: "error",
            canStop: false,
          }))}
        />
        <ProblemTable
          title="Stuck meetings"
          subtitle="live for over 4 hours, or processing for over an hour"
          empty="Nothing stuck right now."
          rows={data.stuck.map((m) => ({
            id: m.id,
            title: m.title,
            when: timeAgo(
              m.status === "joining" || m.status === "recording"
                ? m.createdAt
                : m.updatedAt,
            ),
            teamId: m.teamId,
            teamName: m.teamName,
            userEmail: m.userEmail,
            source: m.source,
            detail: `Still "${STATUS_LABEL[m.status] ?? m.status}"`,
            tone: "warning",
            canStop: true,
          }))}
        />
      </section>
    </div>
  );
}

function ProblemTable({
  title,
  subtitle,
  empty,
  rows,
}: {
  title: string;
  subtitle: string;
  empty: string;
  rows: {
    id: string;
    title: string;
    when: string;
    teamId: string | null;
    teamName: string | null;
    userEmail: string;
    source: string;
    detail: string;
    tone: "error" | "warning";
    canStop: boolean;
  }[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <p className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-900">
        {title} <span className="font-normal text-slate-500">· {subtitle}</span>
      </p>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-start sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/admin/meetings/${r.id}`}
                    className="font-medium text-slate-900 hover:text-brand"
                  >
                    {r.title}
                  </Link>
                  <SourceBadge source={r.source} />
                </div>
                <p
                  className={
                    r.tone === "error" ? "text-rose-700" : "text-amber-700"
                  }
                >
                  {r.detail}
                </p>
              </div>
              <div className="shrink-0 text-xs text-slate-500 sm:text-right">
                <p>{r.when}</p>
                <p>
                  {r.teamId && r.teamName ? (
                    <Link
                      href={`/dashboard/admin/teams/${r.teamId}`}
                      className="hover:text-brand"
                    >
                      {r.teamName}
                    </Link>
                  ) : (
                    "No team"
                  )}{" "}
                  · {r.userEmail}
                </p>
                <div className="mt-2">
                  <AdminMeetingActions
                    meetingId={r.id}
                    title={r.title}
                    canStop={r.canStop}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
