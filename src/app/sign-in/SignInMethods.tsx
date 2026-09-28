"use client";

import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";

// Remembered per-browser so someone who signs in daily via Google/LinkedIn
// isn't forced to re-tick this on every visit — but a fresh browser (or
// private window) always starts unacknowledged, which is what matters:
// this box specifically guards the two paths (OAuth, magic-link) that can
// silently create a brand-new account, same as the required checkbox on
// /sign-up. See the comment on the password form below for why *that*
// form doesn't need this at all.
const ACK_STORAGE_KEY = "anchor-prototype-ack";

export function SignInMethods({
  googleConfigured,
  linkedInConfigured,
  error,
  errorCopy,
  onGoogle,
  onLinkedIn,
  onMagicLink,
  children,
}: {
  googleConfigured: boolean;
  linkedInConfigured: boolean;
  error?: string;
  errorCopy: string | null;
  onGoogle: () => Promise<void>;
  onLinkedIn: () => Promise<void>;
  onMagicLink: (formData: FormData) => Promise<void>;
  // The password sign-in form, rendered by the parent server component —
  // see the comment above its slot below for why it lives outside this
  // gate entirely rather than being passed as another bound action.
  children: ReactNode;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(ACK_STORAGE_KEY) === "1") {
        setAcknowledged(true);
      }
    } catch {
      // Private browsing / storage blocked — falls back to asking every
      // visit, which is a fine default (never silently skips it).
    }
  }, []);

  function handleAckChange(e: ChangeEvent<HTMLInputElement>) {
    const checked = e.target.checked;
    setAcknowledged(checked);
    try {
      if (checked) localStorage.setItem(ACK_STORAGE_KEY, "1");
      else localStorage.removeItem(ACK_STORAGE_KEY);
    } catch {
      // Ignore — worst case this just asks again next visit.
    }
  }

  return (
    <>
      <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={handleAckChange}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-amber-300"
        />
        <span>
          I understand Anchor is an early-stage prototype provided &quot;as is,&quot; and I
          won&apos;t use Google, LinkedIn, or a sign-in link to bring in my most confidential,
          sensitive, or regulated information. I&apos;ve read the{" "}
          <Link href="/terms" className="font-medium underline underline-offset-2">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy#prototype-disclaimer" className="font-medium underline underline-offset-2">
            prototype disclaimer
          </Link>
          .
        </span>
      </label>

      {(googleConfigured || linkedInConfigured) && (
        <>
          <div className="flex flex-col gap-2.5">
            {googleConfigured && (
              <form action={onGoogle}>
                <button
                  type="submit"
                  disabled={!acknowledged}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:shadow disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:shadow-sm"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.48a5.54 5.54 0 0 1-2.4 3.64v3h3.88c2.27-2.09 3.56-5.17 3.56-8.83z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.96-2.9l-3.88-3c-1.08.72-2.45 1.15-4.08 1.15-3.14 0-5.8-2.12-6.75-4.96H1.24v3.1A12 12 0 0 0 12 24z" />
                    <path fill="#FBBC05" d="M5.25 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.24a12 12 0 0 0 0 10.78l4.01-3.1z" />
                    <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.24 6.61l4.01 3.1C6.2 6.87 8.86 4.75 12 4.75z" />
                  </svg>
                  Continue with Google
                </button>
              </form>
            )}
            {linkedInConfigured && (
              <form action={onLinkedIn}>
                <button
                  type="submit"
                  disabled={!acknowledged}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0A66C2] px-3 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#004182] hover:shadow disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#0A66C2] disabled:hover:shadow-sm"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.15 1.45-2.15 2.94v5.67H9.34V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.11 20.45H3.56V9h3.55v11.45z" />
                  </svg>
                  Continue with LinkedIn
                </button>
              </form>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs font-medium text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            or
            <div className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-center text-xs text-red-600">
          {errorCopy ?? "Something went wrong — try again."}
        </p>
      )}

      {/* Password sign-in is deliberately left out of this gate: an
          account can only get a password in the first place via /sign-up,
          which already requires this same acknowledgment before it
          exists — so by definition nobody reaches this form for the
          first time without having already seen and agreed to it. */}
      {children}

      <div className="flex items-center gap-3 text-xs font-medium text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        no password yet, or forgot it?
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <form action={onMagicLink} className="flex flex-col gap-3">
        <input
          type="email"
          name="email"
          required
          placeholder="you@company.com"
          className="rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10"
        />
        <button
          type="submit"
          disabled={!acknowledged}
          className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-transparent"
        >
          Email me a sign-in link
        </button>
      </form>
    </>
  );
}
