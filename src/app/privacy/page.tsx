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

      <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-5 text-sm leading-relaxed text-amber-900">
        <p className="text-base font-semibold text-amber-900">Before you test Anchor, please read this</p>
        <p>
          Anchor is an early-stage prototype, provided &quot;as is&quot; for testing and
          evaluation — it hasn&apos;t yet been hardened with all the privacy, security, and
          data-protection safeguards a production product would have. See{" "}
          <a href="#prototype-disclaimer" className="font-medium underline underline-offset-2">
            the full prototype disclaimer below
          </a>{" "}
          for details.
        </p>
        <p className="font-semibold">
          Please don&apos;t upload your most confidential, sensitive, or regulated information at
          this stage. Test Anchor with meetings, documents, and accounts you&apos;d be comfortable
          with if something went wrong — not your most sensitive deals or data.
        </p>
      </div>

      <div className="flex flex-col gap-8">
        <Section title="1. What this covers">
          <p>
            This Privacy Policy explains what information Anchor collects when you use the Service,
            how it&apos;s used, and the choices you have. &quot;Anchor,&quot; &quot;we,&quot; or
            &quot;us&quot; refers to the team operating the Anchor application.
          </p>
        </Section>

        <section id="prototype-disclaimer" className="flex scroll-mt-8 flex-col gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            2. Prototype / beta-testing disclaimer
          </h2>
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-600">
            <p>
              <span className="font-medium text-slate-900">Early-stage product.</span> Anchor is an
              early-stage prototype provided solely for testing, evaluation, development, and
              demonstration purposes. It is not a production-ready product and may contain errors,
              interruptions, inaccuracies, incomplete functionality, or other defects.
            </p>
            <p>
              <span className="font-medium text-slate-900">Live data.</span> The prototype may
              access, receive, process, analyze, or display live or real-world data, including
              meeting recordings, transcripts, and information about your contacts and deals. By
              providing or authorizing access to any data, you represent that you have all rights,
              permissions, consents, and authority necessary to permit its use for testing and
              evaluation purposes.
            </p>
            <p>
              <span className="font-medium text-slate-900">Privacy and security.</span> The
              prototype does not yet incorporate all the privacy, cybersecurity, data-protection,
              retention, access-control, or other safeguards that may be built into a future
              commercial product.{" "}
              <span className="font-semibold text-slate-900">
                Please don&apos;t provide confidential, sensitive, regulated, or personally
                identifiable information unless its use has been expressly authorized for the
                prototype
              </span>
              . If you&apos;re testing Anchor with real meetings or accounts, use ones you&apos;d be
              comfortable with if something leaked or went wrong — not your most sensitive deals,
              clients, or documents.
            </p>
            <p>
              <span className="font-medium text-slate-900">No reliance.</span> Information,
              analyses, recommendations, predictions, or other outputs generated by the prototype
              may be incomplete, inaccurate, or incorrect, and shouldn&apos;t be relied on for
              financial, legal, operational, employment, medical, safety-critical, or other material
              decisions without independent verification.
            </p>
            <p>
              <span className="font-medium text-slate-900">Confidentiality and intellectual property.</span>{" "}
              The prototype — including its concepts, functionality, workflows, designs,
              algorithms, interfaces, documentation, and other non-public information — is
              confidential and proprietary to Anchor. Access to the prototype doesn&apos;t grant you
              any ownership interest or license except the limited right to evaluate it as expressly
              authorized by Anchor. You may not copy, reproduce, reverse engineer, disclose,
              distribute, or use the prototype or this confidential information to develop or assist
              in developing a competing product, except to the extent such restrictions are
              prohibited by applicable law.
            </p>
            <p className="font-semibold text-slate-900">
              No warranty. The prototype is provided &quot;as is&quot; and &quot;as available,&quot;
              without representations or warranties of any kind, express or implied, including
              warranties of accuracy, reliability, availability, merchantability, fitness for a
              particular purpose, title, or non-infringement.
            </p>
            <p className="font-semibold text-slate-900">
              Limitation of liability. To the fullest extent permitted by applicable law, Anchor and
              its founders, officers, employees, contractors, affiliates, and agents will not be
              liable for any indirect, incidental, special, consequential, exemplary, or punitive
              damages, or for any loss of profits, revenue, business opportunity, goodwill, or data,
              arising out of or related to access to or use of the prototype.
            </p>
            <p>
              <span className="font-medium text-slate-900">Assumption of risk.</span> By using the
              prototype, you acknowledge its experimental nature and voluntarily assume the risks
              inherent in evaluating and using pre-release technology, subject to any rights or
              liabilities that can&apos;t lawfully be waived or limited.
            </p>
            <p>
              <span className="font-medium text-slate-900">No commercial commitment.</span> Access to
              the prototype doesn&apos;t constitute a commitment that Anchor will commercially
              release the product, or any particular feature, functionality, integration, or
              service.
            </p>
            <p>
              By accessing or using the prototype, you acknowledge that you&apos;ve read and
              understood this notice and agree to these terms.
            </p>
          </div>
        </section>

        <Section title="3. Information we collect">
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

        <Section title="4. How we use it">
          <p>We use this information to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Transcribe and summarize your meetings, and extract action items and deal signals;</li>
            <li>Build and maintain the rolling memory Anchor keeps about your deals and contacts;</li>
            <li>Let your team share deal context, handoffs, and follow-ups;</li>
            <li>Operate, secure, and improve the Service;</li>
            <li>Communicate with you about your account.</li>
          </ul>
        </Section>

        <Section title="5. AI processing and third-party providers">
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

        <Section title="6. What we don't do">
          <p>
            We don&apos;t sell your personal information or your meeting content. We don&apos;t
            share it with advertisers. We don&apos;t use your meeting recordings or transcripts to
            train AI models beyond what&apos;s needed to generate your own summaries and insights.
          </p>
        </Section>

        <Section title="7. How Anchor is administered">
          <p>
            A small number of authorized Anchor staff can access account data — including deal,
            meeting, and transcript content — for support, security, fraud-prevention, and
            product-improvement purposes, such as investigating a reported problem or understanding
            how the Service is being used. This access doesn&apos;t generate a real-time notification
            to your account, but every instance of it is logged internally (who, which account, and
            when) and reviewed for appropriate use. This access is never used to read your data for
            any purpose unrelated to operating, securing, or improving the Service, and is never sold
            or shared with advertisers.
          </p>
        </Section>

        <Section title="8. Data retention and deletion">
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

        <Section title="9. Your choices">
          <ul className="list-disc space-y-1 pl-5">
            <li>You can disconnect a third-party integration at any time from the Integrations page.</li>
            <li>You can delete individual meetings or contacts from within Anchor at any time.</li>
            <li>You can delete your own account at any time from Profile → Delete account.</li>
            <li>You control what gets recorded — Anchor only joins or records calls you set it up for.</li>
          </ul>
        </Section>

        <Section title="10. Changes to this policy">
          <p>
            We may update this Privacy Policy as the Service evolves. If we make material changes,
            we&apos;ll make a reasonable effort to let you know.
          </p>
        </Section>

        <Section title="11. Contact">
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
