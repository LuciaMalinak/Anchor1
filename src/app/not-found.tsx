import Link from "next/link";

// Friendly 404 for any unmatched route (a stale link, a typo, a deleted
// deal) — otherwise Next's bare default "404" text page, which reads as
// unfinished rather than intentional.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
      <span className="text-2xl" aria-hidden="true">
        ⚓
      </span>
      <h1 className="text-lg font-semibold text-slate-900">Page not found</h1>
      <p className="max-w-sm text-sm text-slate-500">
        This page doesn&apos;t exist, or you may not have access to it.
      </p>
      <Link
        href="/dashboard"
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
