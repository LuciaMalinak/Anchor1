import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

function InitialsAvatar({ label, size = 40 }: { label: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {label[0]?.toUpperCase() || "?"}
    </span>
  );
}

export default async function ContactsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, session.user.id))
    .orderBy(desc(contacts.lastMeetingAt));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Contacts</h1>
        <p className="text-sm text-slate-500">
          Everyone Anchor has recognized across your meetings, with what it&apos;s learned about each.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No one yet — Anchor builds this automatically as it recognizes speakers in your meetings.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/contacts/${c.id}`}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300"
            >
              <InitialsAvatar label={c.name} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{c.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {[c.role, c.company].filter(Boolean).join(" · ") || "No details yet"}
                </p>
                {c.relationshipSummary && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-slate-600">{c.relationshipSummary}</p>
                )}
                <p className="mt-1.5 text-[11px] text-slate-400">
                  {c.meetingCount} meeting{c.meetingCount === 1 ? "" : "s"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
