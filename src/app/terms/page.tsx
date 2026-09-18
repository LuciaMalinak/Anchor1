import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Terms of Service — Anchor",
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
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of Anchor
            (the &quot;Service&quot;), a meeting-intelligence application that records, transcribes,
            and summarizes meetings and helps teams track deals and contacts. By creating an
            account or using the Service, you agree to these Terms on behalf of yourself and, if
            applicable, the organization you represent.
          </p>
        </Section>

        <Section title="2. Recording meetings — your responsibility">
          <p>
            Anchor can join calls, record audio, and generate transcripts and summaries. Laws on
            recording conversations vary by location — many require that some or all participants
            be notified, or affirmatively consent, before a call is recorded. You are solely
            responsible for knowing and following the recording-consent laws that apply to you and
            the people you meet with, including giving any notice or obtaining any consent
            required before using Anchor to record a call. Anchor is not responsible for how you
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
          <p>You agree not to use Anchor to:</p>
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
            Anchor uses third-party providers to operate — for example, to transcribe audio,
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

        <Section title="7. Service &quot;as is&quot;">
          <p>
            Anchor is an early-stage product under active development. The Service, including any
            AI-generated summaries, signals, or insights, is provided &quot;as is&quot; without
            warranties of any kind. AI-generated content can be incomplete or inaccurate — you
            should use judgment before relying on it for decisions that matter.
          </p>
        </Section>

        <Section title="8. Limitation of liability">
          <p>
            To the fullest extent permitted by law, Anchor and its team won&apos;t be liable for
            indirect, incidental, or consequential damages arising from your use of the Service,
            including reliance on AI-generated content or issues arising from how you use the
            recording features.
          </p>
        </Section>

        <Section title="9. Changes">
          <p>
            We may update these Terms as the Service evolves. If we make material changes,
            we&apos;ll make a reasonable effort to let you know. Continuing to use Anchor after a
            change means you accept the updated Terms.
          </p>
        </Section>

        <Section title="10. Governing law">
          <p>
            These Terms are governed by the laws of the State of Delaware, without regard to its
            conflict-of-law principles. Any dispute arising out of or relating to these Terms or
            the Service will be brought exclusively in the state or federal courts located in
            Delaware, and you consent to the personal jurisdiction of those courts.
          </p>
        </Section>

        <Section title="11. Contact">
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
