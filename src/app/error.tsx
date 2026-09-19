"use client";

import Link from "next/link";
import { useEffect } from "react";

// Site-wide safety net: without this, any uncaught error in a page or
// server action (a slow AI call failing, a provider that isn't
// configured, anything unexpected) rendered Next's raw default error
// page instead — fine mid-development, not what a first-time visitor
// (or an investor) should ever see. This catches anything not already
// handled closer to where it happened.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
      <span className="text-2xl" aria-hidden="true">
        ⚓
      </span>
      <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
      <p className="max-w-sm text-sm text-slate-500">
        That&apos;s on us, not you — the page hit an unexpected error. Give it another try, or head
        back to your dashboard.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
