import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Privacy Policy — Anchor",
};

const EFFECTIVE_DATE = "September 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

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
            This Privacy Policy explains what information Anchor collects when you use the Service,
            how it&apos;s used, and the choices you have. &quot;Anchor,&quot; &quot;we,&quot; or
            &quot;us&quot; refers to the team operating the Anchor application.
          </p>
        </Section>

        <Section title="2. Information we collect">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium text-slate-900">Account information</span> — your name,
              email address, and, if you sign in that way, a linked Google or LinkedIn identity.
            </li>
            <li>
              <span className="font-medium text-slate-900">Meeting content</span> — audio
              recordings, transcripts, and AI-generated summaries, action items, and signals from
              meetings you record or upload through Anchor.
            </li>
            <li>
              <span className="font-medium text-slate-900">Deal and contact data</span> — names,
              roles, notes, and other information you or your team enter about contacts and deals,
              including AI-generated relationship summaries built from meeting history.
            </li>
            <li>
              <span className="font-medium text-slate-900">Connected-service data</span> — if you
              choose to connect a third-party account (e.g. Google, Microsoft, Slack, or a CRM like
              Salesforce), the data you authorize Anchor to access from that account.
            </li>
            <li>
              <span className="font-medium text-slate-900">Usage data</span> — basic technical
              information like log data, needed to operate and secure the Service.
            </li>
          </ul>
        </Section>

        <Section title="3. How we use it">
          <p>We use this information to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Transcribe and summarize your meetings, and extract action items and deal signals;</li>
            <li>Build and maintain the rolling memory Anchor keeps about your deals and contacts;</li>
            <li>Let your team share deal context, handoffs, and follow-ups;</li>
            <li>Operate, secure, and improve the Service;</li>
            <li>Communicate with you about your account.</li>
          </ul>
        </Section>

        <Section title="4. AI processing and third-party providers">
          <p>
            Producing transcripts, summaries, and AI-generated insights requires sending meeting
            content to third-party AI and infrastructure providers (for example, speech-to-text and
            large language model providers) strictly to process that request. We choose providers
            whose terms state that business/API data like this isn&apos;t used to train their
            general-purpose models. We also use a third-party service to send account emails (like
            sign-in links). If you connect a third-party account (Google, Microsoft, Slack,
            Salesforce, etc.), the data you authorize is used only to power the features you
            connected it for.
          </p>
        </Section>

        <Section title="5. What we don't do">
          <p>
            We don&apos;t sell your personal information or your meeting content. We don&apos;t
            share it with advertisers. We don&apos;t use your meeting recordings or transcripts to
            train AI models beyond what&apos;s needed to generate your own summaries and insights.
          </p>
        </Section>

        <Section title="6. Data retention and deletion">
          <p>
            We retain your account data, recordings, and derived content for as long as your
            account is active, or as needed to provide the Service. You can delete individual
            meetings from within Anchor, and you can delete your own account at any time from
            Profile → Delete account — this signs you out everywhere and removes your personal
            information immediately. If you&apos;re the sole member of your team, your team&apos;s
            deals and data are deleted along with it; if others are still on your team, we&apos;ll
            help move ownership first. You can also reach out to us directly for a data request.
          </p>
        </Section>

        <Section title="7. Your choices">
          <ul className="list-disc space-y-1 pl-5">
            <li>You can disconnect a third-party integration at any time from the Integrations page.</li>
            <li>You can delete individual meetings or contacts from within Anchor at any time.</li>
            <li>You can delete your own account at any time from Profile → Delete account.</li>
            <li>You control what gets recorded — Anchor only joins or records calls you set it up for.</li>
          </ul>
        </Section>

        <Section title="8. Changes to this policy">
          <p>
            We may update this Privacy Policy as the Service evolves. If we make material changes,
            we&apos;ll make a reasonable effort to let you know.
          </p>
        </Section>

        <Section title="9. Contact">
          <p>
            Questions about this policy, or a data request? Reach out at{" "}
            <a href="mailto:lucia.malinak@gmail.com" className="text-brand hover:underline">
              lucia.malinak@gmail.com
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  );
}
