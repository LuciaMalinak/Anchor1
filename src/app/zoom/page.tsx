import Link from "next/link";
import { Logo } from "@/components/Logo";

// Public help page for the Anchor Zoom app. Zoom Marketplace links to it as
// the app's "Documentation URL": it has to explain adding, using and
// removing the app.

export const metadata = {
  title: "Using Zoom with Anchor — Anchor",
  description: "How to add the Anchor app to Zoom, schedule Zoom meetings from Anchor, and remove the app.",
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-3">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="flex list-decimal flex-col gap-2 pl-5 marker:font-semibold marker:text-slate-400">{children}</ol>;
}

export default function ZoomGuidePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-14 sm:px-8">
      <div className="flex items-center justify-between">
        <Link href="/">
          <Logo size="md" />
        </Link>
        <Link href="/sign-in" className="text-sm font-medium text-brand hover:underline">
          Sign in
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Using Zoom with Anchor</h1>
        <p className="text-sm leading-relaxed text-slate-600">
          Anchor is a deal-management workspace for sales and business-development teams. The Anchor
          Zoom app lets Anchor create scheduled Zoom meetings on your Zoom account, so you can set up
          a client meeting, with the Zoom link in the invite, without leaving Anchor.
        </p>
        <nav className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href="#add" className="font-medium text-brand hover:underline">Adding the app</a>
          <a href="#use" className="font-medium text-brand hover:underline">Using the app</a>
          <a href="#remove" className="font-medium text-brand hover:underline">Removing the app</a>
          <a href="#data" className="font-medium text-brand hover:underline">Your data</a>
          <a href="#help" className="font-medium text-brand hover:underline">Help</a>
        </nav>
      </div>

      <div className="flex flex-col gap-10">
        <Section id="before" title="Before you start">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>An Anchor account. You can sign up at <Link href="/sign-up" className="text-brand hover:underline">Anchor&apos;s sign-up page</Link>.</li>
            <li>A Zoom account (any plan) that is allowed to schedule meetings.</li>
            <li>If your company manages Zoom centrally, your Zoom admin may need to approve the Anchor app first.</li>
          </ul>
        </Section>

        <Section id="add" title="Adding the app">
          <p>You can add the app from Anchor or from the Zoom App Marketplace. Both lead to the same Zoom approval screen.</p>
          <p className="font-medium text-slate-800">From Anchor</p>
          <Steps>
            <li>Sign in to Anchor.</li>
            <li>Open <span className="font-medium text-slate-800">Integrations</span> from the menu.</li>
            <li>Find <span className="font-medium text-slate-800">Zoom</span> and click <span className="font-medium text-slate-800">Connect</span>.</li>
            <li>Sign in to Zoom if asked, review the permissions Anchor is asking for, and click <span className="font-medium text-slate-800">Allow</span>.</li>
            <li>You&apos;re taken back to Anchor, and Zoom now shows <span className="font-medium text-slate-800">Connected</span>.</li>
          </Steps>
          <p className="font-medium text-slate-800">From the Zoom App Marketplace</p>
          <Steps>
            <li>Sign in to the Zoom App Marketplace and search for <span className="font-medium text-slate-800">Anchor</span>.</li>
            <li>Click <span className="font-medium text-slate-800">Add</span> and approve the permissions.</li>
            <li>Sign in to Anchor when asked. Zoom then shows as <span className="font-medium text-slate-800">Connected</span> on Anchor&apos;s Integrations page.</li>
          </Steps>
        </Section>

        <Section id="use" title="Using the app">
          <p>Once Zoom is connected, Anchor can create a Zoom meeting whenever you set up a meeting in Anchor.</p>
          <p className="font-medium text-slate-800">Schedule a Zoom meeting</p>
          <Steps>
            <li>
              When Anchor spots a request to meet (for example, an email or Slack message saying
              &quot;can we meet Thursday?&quot;), it shows a meeting suggestion. You can also schedule a
              meeting from a deal.
            </li>
            <li>Check the title, date, time and the people to invite.</li>
            <li>Under <span className="font-medium text-slate-800">How you&apos;ll meet</span>, choose <span className="font-medium text-slate-800">Zoom</span>.</li>
            <li>Click <span className="font-medium text-slate-800">Set it up</span>.</li>
          </Steps>
          <p>
            Anchor creates the scheduled meeting on your Zoom account, puts the Zoom join link in the
            calendar invitation, and sends it to the people you chose. The meeting also appears in
            your Zoom account under <span className="font-medium text-slate-800">Meetings</span>, where you can edit or cancel it as usual.
          </p>
          <p>
            Nothing is created until you click <span className="font-medium text-slate-800">Set it up</span>. If you decline a suggestion, nothing is set up.
          </p>
          <p className="font-medium text-slate-800">If something doesn&apos;t work</p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>
              <span className="font-medium text-slate-800">&quot;Connect Zoom to create Zoom meetings&quot;</span>: Zoom isn&apos;t connected, or the
              connection expired. Go to Integrations and click Connect on Zoom again.
            </li>
            <li>
              <span className="font-medium text-slate-800">Zoom isn&apos;t offered as an option</span>: check that Zoom shows Connected on the
              Integrations page.
            </li>
            <li>
              <span className="font-medium text-slate-800">The Zoom approval screen shows an error</span>: your Zoom admin may need to
              allow the Anchor app for your company&apos;s Zoom account.
            </li>
          </ul>
        </Section>

        <Section id="remove" title="Removing the app">
          <p>You can remove the app at any time, in either place:</p>
          <p className="font-medium text-slate-800">From Anchor</p>
          <Steps>
            <li>Sign in to Anchor and open <span className="font-medium text-slate-800">Integrations</span>.</li>
            <li>On Zoom, click <span className="font-medium text-slate-800">Disconnect</span> and confirm.</li>
          </Steps>
          <p className="font-medium text-slate-800">From Zoom</p>
          <Steps>
            <li>Sign in to the Zoom App Marketplace.</li>
            <li>Click <span className="font-medium text-slate-800">Manage</span>, then <span className="font-medium text-slate-800">Added Apps</span>.</li>
            <li>Find <span className="font-medium text-slate-800">Anchor</span> and click <span className="font-medium text-slate-800">Remove</span>.</li>
          </Steps>
          <p>
            Either way, Anchor deletes its stored Zoom access tokens and can no longer create meetings
            on your Zoom account. Meetings that were already created stay in your Zoom account until
            you delete them there. Removing the app doesn&apos;t affect anything else in your Anchor
            account.
          </p>
        </Section>

        <Section id="data" title="What Anchor can access">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>Anchor uses the Zoom connection only to read your basic Zoom profile (to identify the account) and to create scheduled meetings you ask for.</li>
            <li>Anchor does not read, change or delete your existing Zoom meetings, recordings, chats or contacts through this app.</li>
            <li>Anchor saves the details of meetings it creates (title, time, join link, invitees) on the related deal in your Anchor account.</li>
            <li>
              More detail is in our <Link href="/privacy" className="text-brand hover:underline">Privacy Policy</Link> and{" "}
              <Link href="/terms" className="text-brand hover:underline">Terms of Service</Link>.
            </li>
          </ul>
        </Section>

        <Section id="help" title="Help">
          <p>
            Questions or problems with the Zoom app? Email{" "}
            <a href="mailto:lucia.malinak@gmail.com" className="text-brand hover:underline">
              lucia.malinak@gmail.com
            </a>{" "}
            and we&apos;ll get back to you within one business day.
          </p>
        </Section>
      </div>
    </main>
  );
}
