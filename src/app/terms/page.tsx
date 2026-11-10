import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Terms of Service — Anchor.AI",
};

const EFFECTIVE_DATE = "November 10, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-14 sm:px-8">
      <div className="flex items-center justify-between">
        <Link href="/">
          <Logo size="md" />
        </Link>
        <Link href="/privacy" className="text-sm font-medium text-brand hover:underline">
          Privacy Policy
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Terms of Service</h1>
        <p className="mt-1 text-sm text-slate-400">Effective {EFFECTIVE_DATE}</p>
      </div>

      <div className="flex flex-col gap-8">
        <Section title="1. Who this agreement is with">
          <p>
            These Terms of Service (&quot;Terms&quot;) are an agreement between you and Anchor.AI
            (&quot;Anchor,&quot; &quot;we,&quot; or &quot;us&quot;) and govern your access to and use of
            Anchor (the &quot;Service&quot;), a meeting-intelligence application that records, transcribes,
            and summarizes meetings and helps teams track deals and contacts. By creating an
            account or using the Service, you agree to these Terms on behalf of yourself and, if
            applicable, the organization you represent.
          </p>
        </Section>

        <Section title="2. Recording meetings — your responsibility">
          <p>
            Anchor.AI can join calls, record audio, and generate transcripts and summaries. Laws on
            recording conversations vary by location — many require that some or all participants
            be notified, or affirmatively consent, before a call is recorded. You are solely
            responsible for knowing and following the recording-consent laws that apply to you and
            the people you meet with, including giving any notice or obtaining any consent
            required before using Anchor.AI to record a call. Anchor.AI is not responsible for how you
            use the recording features.
          </p>
        </Section>

        <Section title="3. Your account">
          <p>
            You&apos;re responsible for the activity that happens under your account, for keeping
            your sign-in access secure, and for the accuracy of information you provide. You must
            be authorized to act on behalf of any organization or team you connect to the Service.
          </p>
        </Section>

        <Section title="4. Acceptable use">
          <p>You agree not to use Anchor.AI to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Record or process a call without the notice or consent required by law;</li>
            <li>Upload content you don&apos;t have the right to share;</li>
            <li>Attempt to access another user&apos;s or team&apos;s data without authorization;</li>
            <li>Reverse-engineer, resell, or use the Service to build a competing product;</li>
            <li>Use the Service in a way that violates any applicable law or third party&apos;s rights.</li>
          </ul>
        </Section>

        <Section title="5. Third-party services and AI processing">
          <p>
            Anchor.AI uses third-party providers to operate — for example, to transcribe audio,
            generate AI summaries, send email, and (where you choose to connect them) sync data
            from services like Google, Microsoft, Slack, or Salesforce. Meeting content and related
            data you provide may be processed by these providers, and by AI models, in order to
            produce transcripts, summaries, and insights. We select providers that are expected not
            to use your content to train their own general-purpose models, but you should review
            our <Link href="/privacy" className="text-brand hover:underline">Privacy Policy</Link>{" "}
            for details on what&apos;s shared and with whom.
          </p>
        </Section>

        <Section title="6. Your content">
          <p>
            You retain ownership of the meeting recordings, transcripts, notes, and other content
            you or your team put into Anchor (&quot;Your Content&quot;). You grant Anchor a
            license to host, process, and analyze Your Content solely to provide and improve the
            Service for you and your team. We don&apos;t claim ownership of Your Content, and we
            don&apos;t sell it.
          </p>
        </Section>

        <Section title="7. Plans, billing, and free trials">
          <p>
            Paid plans are billed monthly in advance, per user, at the prices shown on our{" "}
            <Link href="/pricing" className="text-brand hover:underline">pricing page</Link> when you
            subscribe. Subscriptions renew automatically each month until cancelled. Adding or
            removing teammates changes the number of paid seats, and the charge is adjusted
            proportionally.
          </p>
          <p>
            A free trial needs a payment card. You won&apos;t be charged during the trial; when it
            ends, your subscription starts and your card is charged unless you cancel before then.
            Payments are processed by Stripe. Fees don&apos;t include taxes, which are added where
            required. If a payment fails, we may limit access until it&apos;s resolved.
          </p>
          <p>
            You can cancel at any time from the Billing page. Cancellation takes effect at the end of
            the current billing month, and you keep access until then. Fees already paid aren&apos;t
            refunded except where the law requires. We&apos;ll give at least 30 days&apos; notice
            before changing the price of your plan.
          </p>
        </Section>

        <Section title="8. Security and confidentiality">
          <p>
            We protect Your Content with reasonable administrative, technical, and physical
            safeguards, described in our{" "}
            <Link href="/privacy#security" className="text-brand hover:underline">Privacy Policy</Link>,
            and we treat it as confidential. We access it only to provide the Service, to give
            support you ask for, to keep the Service secure, or when required by law. If a security
            incident affects Your Content, we&apos;ll notify you without undue delay.
          </p>
        </Section>

        <Section title="9. Ending the agreement and your data">
          <p>
            You can stop using Anchor.AI and cancel at any time. We may suspend or end access for
            serious or repeated violations of these Terms, or non-payment, and will give notice where
            reasonable. After an account closes, you can ask us for an export of Your Content within
            30 days; after that, we delete it as described in our Privacy Policy.
          </p>
        </Section>

        <Section title="10. AI output and warranties">
          <p>
            We work to keep Anchor.AI available and accurate, but the Service, including AI-generated
            summaries, signals, and answers, is provided &quot;as is&quot; and &quot;as
            available,&quot; without warranties of any kind, to the extent the law allows. AI output
            can be incomplete or wrong, so check it before relying on it for decisions that matter.
          </p>
        </Section>

        <Section title="11. Limitation of liability">
          <p>
            To the fullest extent permitted by law, neither party will be liable for indirect,
            incidental, special, or consequential damages, or for lost profits or revenue, arising
            from these Terms or the Service. Each party&apos;s total liability is limited to the fees
            you paid Anchor in the 12 months before the claim. These limits don&apos;t apply to your
            payment obligations or to liability that can&apos;t be limited by law.
          </p>
        </Section>

        <Section title="12. Changes">
          <p>
            We may update these Terms as the Service evolves. If we make material changes,
            we&apos;ll make a reasonable effort to let you know. Continuing to use Anchor after a
            change means you accept the updated Terms.
          </p>
        </Section>

        <Section title="13. Governing law">
          <p>
            These Terms are governed by the laws of the State of Delaware, without regard to its
            conflict-of-law principles. Any dispute arising out of or relating to these Terms or
            the Service will be brought exclusively in the state or federal courts located in
            Delaware, and you consent to the personal jurisdiction of those courts.
          </p>
        </Section>

        <Section title="14. Contact">
          <p>
            Questions about these Terms? Reach out at{" "}
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
