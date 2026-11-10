import Link from "next/link";
import { Logo } from "@/components/Logo";

// Public trust page for clients' IT, security and legal teams: how
// Anchor.AI protects client data, in plain language, and how to get the
// full security pack (policies, DPA, questionnaire answers). Keep in step
// with the Privacy Policy and the Security and Data Protection Policies.

export const metadata = {
  title: "Security and privacy — Anchor.AI",
  description: "How Anchor.AI protects client data: encryption, sign-in protection, separation between companies, backups, and the services that process data.",
};

const CONTACT = "lucia@anchortechnolgies.com";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

const PROVIDERS: [string, string][] = [
  ["Render", "Hosting and database (US)"],
  ["Cloudflare R2", "File storage and encrypted backups (US)"],
  ["Anthropic", "AI processing; doesn't train on your data (US)"],
  ["AssemblyAI", "Transcription; its copy is deleted after processing (US)"],
  ["Recall.ai", "Recording; its copy is deleted after processing (US)"],
  ["Stripe", "Payments (PCI DSS Level 1)"],
  ["SendGrid", "Email delivery"],
  ["Twilio", "Text messages, only if you turn them on"],
];

export default function SecurityPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-14 sm:px-8">
      <div className="flex items-center justify-between">
        <Link href="/">
          <Logo size="md" />
        </Link>
        <Link href="/sign-in" className="text-sm font-medium text-brand hover:underline">
          Sign in
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Security and privacy</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
          Your calls, deals and client relationships are your business. Here&apos;s how Anchor.AI keeps
          them safe and private. For the full security pack (our written policies, a Data Processing
          Agreement and answers to your security questionnaire), email{" "}
          <a href={`mailto:${CONTACT}?subject=Security%20pack%20request`} className="text-brand hover:underline">{CONTACT}</a>.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Your data is never sold or used for training">
          <p>We don&apos;t sell or share your data, and we don&apos;t use your calls, transcripts or deals to train AI models. Our AI provider works under terms that don&apos;t allow training on it either.</p>
        </Card>
        <Card title="Encrypted everywhere">
          <p>All traffic uses HTTPS (TLS 1.2+), enforced by the browser. Data is encrypted at rest, and sign-in tokens for your connected tools (Google, Microsoft, Zoom and others) get an extra layer of AES-256 encryption in our database.</p>
        </Card>
        <Card title="Companies kept separate">
          <p>Every request is checked against the signed-in person&apos;s team, so one company can never see another&apos;s data. Inside your team, leaders choose who can see which deals.</p>
        </Card>
        <Card title="Sign-in protection">
          <p>Two-step verification with an authenticator app, which a team owner can require for everyone. Sign in with your company Microsoft or Google account. Repeated wrong passwords lock sign-in for 15 minutes.</p>
        </Card>
        <Card title="You stay in control">
          <p>Your team owner can download all of your company&apos;s data at any time, see who has which tools connected, sign anyone out everywhere, and remove people. You can ask us to permanently delete your data at any time.</p>
        </Card>
        <Card title="Never lost">
          <p>Daily encrypted backups are stored separately from the live service. Deleted deals go to a recoverable trash. If you cancel, your data is kept, so you can pick up where you left off.</p>
        </Card>
        <Card title="Recording done openly">
          <p>When Anchor.AI&apos;s notetaker joins a call, it tells everyone in the meeting chat that the call is being recorded. Recording copies held by our recording and transcription providers are deleted once Anchor.AI has saved its own.</p>
        </Card>
        <Card title="How we run it">
          <p>All code changes are reviewed and automatically checked. Dependencies are scanned for vulnerabilities on every change and weekly. Every administrative account uses multi-factor authentication. Security incidents are handled under a written plan, and affected customers are told within 72 hours.</p>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">Services that process data for Anchor.AI</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <tbody>
              {PROVIDERS.map(([name, purpose]) => (
                <tr key={name} className="border-b border-slate-100 last:border-0">
                  <td className="w-40 px-4 py-2 font-medium text-slate-800">{name}</td>
                  <td className="px-4 py-2 text-slate-600">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          All data is processed in the United States. Anchor.AI doesn&apos;t yet hold a SOC 2 or ISO 27001
          certification; our controls are based on those frameworks, and our main providers hold their own.
        </p>
      </section>

      <section className="flex flex-col gap-2 text-sm text-slate-600">
        <h2 className="text-base font-semibold text-slate-900">Report a security issue</h2>
        <p>
          Found a vulnerability or have a concern? Email{" "}
          <a href={`mailto:${CONTACT}?subject=Security`} className="text-brand hover:underline">{CONTACT}</a>. We reply
          within one business day. More detail is in our{" "}
          <Link href="/privacy" className="text-brand hover:underline">Privacy Policy</Link> and{" "}
          <Link href="/terms" className="text-brand hover:underline">Terms of Service</Link>.
        </p>
      </section>
    </main>
  );
}
