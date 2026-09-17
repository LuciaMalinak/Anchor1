import { Logo } from "@/components/Logo";

// Why this page exists: Gmail (and several corporate mail scanners, e.g.
// Outlook Safe Links) automatically open links found in incoming email to
// check them for phishing/malware BEFORE the person ever sees the inbox.
// Auth.js's email sign-in link is single-use — if we email that link
// directly, the scanner's automated visit consumes it, and the person's
// own click a moment later fails with "this link has expired," even
// though they never actually got to use it. See the custom
// sendVerificationRequest in src/auth.ts, which now emails a link to
// THIS page instead of the real callback URL.
//
// Scanners fetch a page but don't click buttons on it, so the real,
// token-consuming callback URL only ever gets hit once a human actually
// clicks "Finish signing in" below.
export default async function VerifySignInPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string }>;
}) {
  const { url } = await searchParams;
  const trustedUrl = getTrustedCallbackUrl(url);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo size="md" />
      {trustedUrl ? (
        <>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Confirm it&rsquo;s you
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Some email apps (Gmail included) automatically preview links before you
              open them, which can use up a sign-in link before you click it. This extra
              click makes sure it&rsquo;s really you.
            </p>
          </div>
          <a
            href={trustedUrl}
            className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-dark"
          >
            Finish signing in
          </a>
        </>
      ) : (
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Link not recognized
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            This sign-in link looks invalid, or it&rsquo;s already been used. Request a
            fresh one from the sign-in page.
          </p>
          <a
            href="/sign-in"
            className="mt-4 inline-block text-sm font-medium text-brand hover:underline"
          >
            Back to sign in
          </a>
        </div>
      )}
    </main>
  );
}

// Only ever forward to our own Auth.js email callback — never an
// arbitrary URL a query param happens to contain — so this page can't be
// turned into an open redirect.
function getTrustedCallbackUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (!base) return null;
  try {
    const parsed = new URL(raw);
    const trustedOrigin = new URL(base).origin;
    if (parsed.origin !== trustedOrigin) return null;
    if (!parsed.pathname.startsWith("/api/auth/callback/")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
