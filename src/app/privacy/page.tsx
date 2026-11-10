import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Privacy Policy — Anchor.AI",
};

const EFFECTIVE_DATE = "November 10, 2026";
const CONTACT_EMAIL = "lucia.malinak@gmail.com";

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-2">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-slate-800">{children}</span>;
}

// Service providers that process customer data on Anchor's behalf. Keep in
// step with the integrations in src/lib (AI, transcription, meeting bot,
// email, SMS, payments, hosting, storage).
const PROVIDERS: [string, string][] = [
  ["Anthropic", "AI processing (summaries, answers, insights)"],
  ["AssemblyAI", "Speech-to-text transcription"],
  ["Recall.ai", "Meeting bot that joins calls you send Anchor.AI to"],
  ["Render", "Application hosting and database"],
  ["Cloudflare (R2)", "File storage and encrypted backups"],
  ["Stripe", "Subscription billing and payments"],
  ["SendGrid", "Account and notification emails"],
  ["Twilio", "Text-message notifications, if you turn them on"],
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-14 sm:px-8">
      <div className="flex items-center justify-between">
        <Link href="/">
          <Logo size="md" />
        </Link>
        <Link href="/terms" className="text-sm font-medium text-brand hover:underline">
          Terms of Service
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Privacy Policy</h1>
        <p className="mt-1 text-sm text-slate-400">Effective {EFFECTIVE_DATE}</p>
      </div>

      <div className="flex flex-col gap-8">
        <Section title="1. What this covers">
          <p>
            This Privacy Policy explains what information Anchor.AI (&quot;Anchor,&quot;
            &quot;we,&quot; or &quot;us&quot;) collects when you use the Anchor web and desktop
            apps (the &quot;Service&quot;), how we use and protect it, and the choices you have.
          </p>
          <p>
            When a company signs up for Anchor, that company (our &quot;customer&quot;) decides what
            data goes into its workspace and who on its team can see it. For that data, we act as a
            service provider (processor) on the customer&apos;s behalf.
          </p>
        </Section>

        <Section title="2. Information we collect">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>
              <B>Account information</B>: your name, email address, phone number if you add one,
              team, and role. If you sign in with Google or LinkedIn, the basic profile that service
              shares.
            </li>
            <li>
              <B>Meeting content</B>: audio recordings, transcripts, and AI-generated summaries,
              action items, and signals from meetings you record or upload through Anchor.AI.
            </li>
            <li>
              <B>Deal and contact data</B>: names, roles, notes, files, and other information you
              or your team enter about contacts and deals.
            </li>
            <li>
              <B>Connected-service data</B>: if you connect another account (for example Google,
              Microsoft, Slack, Zoom, HubSpot, Salesforce, or Dropbox), the data you authorize
              Anchor.AI to access from it, used only for the features you connected it for.
            </li>
            <li>
              <B>Billing information</B>: plan, number of seats, and billing status. Card details
              are entered on Stripe&apos;s secure page and stored by Stripe. Anchor never receives
              or stores your full card number.
            </li>
            <li>
              <B>Usage data</B>: technical information such as log data, device and app version,
              and the questions you ask Anchor.AI, used to run, secure, and support the Service.
            </li>
          </ul>
        </Section>

        <Section title="3. How we use it">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>To transcribe and summarize your meetings, and pull out action items and deal signals;</li>
            <li>To keep the memory Anchor.AI builds about your deals and contacts, and answer your questions about them;</li>
            <li>To let your team share deal context, handoffs, and follow-ups;</li>
            <li>To schedule meetings and send invites you ask for;</li>
            <li>To bill your subscription and send account messages;</li>
            <li>To keep the Service secure, fix problems, and provide support.</li>
          </ul>
        </Section>

        <Section title="4. What we don't do">
          <p>
            We don&apos;t sell your personal information or your content, and we don&apos;t share it
            with advertisers. We don&apos;t use your meetings, transcripts, or deal data to train AI
            models. The AI providers we use process your content only to produce your results, under
            terms that don&apos;t allow them to train their models on it.
          </p>
        </Section>

        <Section title="5. Service providers">
          <p>
            We use the following providers to run Anchor.AI. Each receives only the data needed for
            its part of the Service and is bound by its own data-protection terms.
          </p>
          <div className="overflow-hidden rounded-xl border border-slate-200">
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
          <p>
            Services you choose to connect (such as Google, Microsoft, Slack, or Zoom) receive the
            requests needed for the features you use, under your agreement with them. We may update
            this list as the Service changes.
          </p>
        </Section>

        <Section id="security" title="6. How we protect your data">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>
              <B>Encryption</B>: all traffic to Anchor.AI uses HTTPS (TLS). Sign-in tokens for
              connected services are encrypted in our database (AES-256), and our hosting and storage
              providers encrypt data at rest.
            </li>
            <li>
              <B>Separation between companies</B>: each company&apos;s workspace is kept separate,
              and every request is checked against the signed-in person&apos;s team.
            </li>
            <li>
              <B>Access inside your team</B>: team leaders choose who can see which deals.
            </li>
            <li>
              <B>Protection against loss</B>: deleted deals go to a recoverable trash rather than
              being erased right away, changes that remove data are logged, and the database is
              backed up every night.
            </li>
            <li>
              <B>Payments</B>: card payments are handled by Stripe, which is certified to PCI DSS
              Level 1.
            </li>
          </ul>
          <p>
            No system is perfectly secure. If we learn of a security incident affecting your data,
            we&apos;ll notify affected customers without undue delay and tell them what happened
            and what we&apos;re doing about it.
          </p>
        </Section>

        <Section title="7. Who at Anchor.AI can see your data">
          <p>
            A small number of authorized Anchor.AI staff can access account data only when needed for
            support, security, billing, or to fix a problem, for example when you ask us to recover
            something or investigate an issue. We don&apos;t look at your content for any other
            reason.
          </p>
        </Section>

        <Section title="8. Recording meetings">
          <p>
            Anchor.AI only records calls you set it up to record. Recording laws differ by location,
            and some require everyone on a call to agree to being recorded. You&apos;re responsible
            for telling participants and getting any consent the law requires (see our{" "}
            <Link href="/terms" className="text-brand hover:underline">Terms of Service</Link>).
          </p>
        </Section>

        <Section title="9. Keeping and deleting data">
          <p>
            We keep your data while your company&apos;s account is active, so your team&apos;s deals
            and history are never lost by accident. When you delete a deal, meeting, file, or
            contact, it&apos;s removed from your workspace but kept in a recoverable copy, so a
            mistake can be undone. We also make a full backup every day and keep backups long-term,
            stored separately from the live service, so your data can always be recreated if
            something goes wrong.
          </p>
          <p>
            To have data permanently erased, email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand hover:underline">{CONTACT_EMAIL}</a>.
            We&apos;ll remove it from the service and its recoverable copies within 30 days, apart from
            anything we must keep by law (for example billing records). Backups are only ever used to
            recover lost data; if we ever restore one, we apply your erasure again before anything
            is used. When a company closes its account, we keep its data so it can be restored if it
            comes back, unless it asks us to delete it or to export it first.
          </p>
        </Section>

        <Section title="10. Your rights and choices">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>You can see and correct your account information in your profile.</li>
            <li>You can disconnect any connected service at any time from the Integrations page.</li>
            <li>You can delete meetings, contacts, and deals, or your account, from within Anchor.AI.</li>
            <li>
              You can ask us for a copy of your data, or for it to be corrected or deleted, by
              emailing us. Depending on where you live (for example under the GDPR or California
              law), you may have further rights, and we&apos;ll honor them.
            </li>
            <li>
              If your account belongs to a company, we may pass your request to that company, since
              it controls its workspace.
            </li>
          </ul>
        </Section>

        <Section title="11. International transfers">
          <p>
            Anchor.AI and its providers are based in the United States, and your data is processed
            there. Where the law requires, we rely on appropriate safeguards such as the European
            Commission&apos;s standard contractual clauses.
          </p>
        </Section>

        <Section title="12. Children">
          <p>Anchor.AI is a business product and isn&apos;t meant for anyone under 16.</p>
        </Section>

        <Section title="13. Changes to this policy">
          <p>
            We may update this policy as the Service changes. If we make material changes, we&apos;ll
            let account owners know by email or in the app before they take effect.
          </p>
        </Section>

        <Section title="14. Contact">
          <p>
            Questions about this policy, or a data request? Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand hover:underline">{CONTACT_EMAIL}</a>.
          </p>
        </Section>
      </div>
    </main>
  );
}
