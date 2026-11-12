import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { signOut } from "@/auth";
import { users } from "@/db/schema";
import { Logo } from "@/components/Logo";
import { ContactSalesForm } from "@/components/ContactSalesForm";
import { billingConfigured, hasAccess, monthlyPrice, syncCheckoutSession, teamMemberCount } from "@/lib/billing";
import { billingContext } from "@/lib/billingRequest";
import { BillingPlans, ManageBillingButton, SubscriptionControls } from "./BillingClient";

export const metadata = { title: "Billing — Anchor.AI" };

function day(d: Date | null): string {
  return d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
}

// Where everyone without an active subscription lands (the dashboard
// sends them here): pick a plan, use a promo code, or contact sales. Also
// where the owner manages an existing subscription.
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string; promo?: string }>;
}) {
  let ctx = await billingContext();
  if (!ctx) redirect("/sign-in?next=/billing");
  const { checkout, session_id, promo } = await searchParams;
  // A promo code from the free-trial link (/try) or ?promo=, applied for
  // them on the plans below.
  const cookieStore = await cookies();
  const startingPromo = (promo || cookieStore.get("anchor_promo")?.value || "").slice(0, 40);

  // Back from Stripe: record the subscription now rather than waiting for
  // the webhook, so they can go straight in.
  if (checkout === "done" && session_id && billingConfigured()) {
    try {
      await syncCheckoutSession(session_id, ctx.team.id);
      ctx = (await billingContext())!;
    } catch (err) {
      console.error("[billing] syncing the checkout failed:", err);
    }
  }

  const { team, user, canManage } = ctx;
  const access = hasAccess(team, user.email);
  const seats = await teamMemberCount(team.id);
  const [owner] = team.ownerUserId
    ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, team.ownerUserId))
    : [];
  const subscribed = Boolean(team.stripeSubscriptionId) && ["active", "trialing", "past_due"].includes(team.billingStatus ?? "");

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <header className="bg-brand">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href={access ? "/dashboard" : "/billing"}>
            <Logo size="lg" tone="light" />
          </Link>
          {access ? (
            <Link href="/dashboard" className="text-sm font-medium text-slate-300 hover:text-white">
              Go to Anchor.AI →
            </Link>
          ) : (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" className="text-sm font-medium text-slate-300 hover:text-white">
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
        {checkout === "done" && access && (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            You&apos;re all set. Welcome to Anchor!{" "}
            <Link href="/dashboard" className="font-medium underline">
              Open Anchor.AI
            </Link>
          </p>
        )}
        {checkout === "cancelled" && (
          <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">Payment wasn&apos;t completed. Pick a plan whenever you&apos;re ready.</p>
        )}
        {team.billingStatus === "past_due" && (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Your last payment didn&apos;t go through. Please update your card under Manage billing to keep access.
          </p>
        )}

        {subscribed ? (
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Your subscription</h1>
            <p className="text-sm text-slate-600">
              <b>{team.billingPlan === "pro" ? "Pro" : "Team"}</b> for {team.billingSeats ?? seats}{" "}
              {(team.billingSeats ?? seats) === 1 ? "person" : "people"} ·{" "}
              ${monthlyPrice(team.billingPlan === "pro" ? "pro" : "team", team.billingSeats ?? seats)}/month
            </p>
            {team.billingStatus === "trialing" && team.trialEndsAt && (
              <p className="text-sm text-slate-600">
                Free until <b>{day(team.trialEndsAt)}</b>, then billed monthly. Cancel any time before then and you won&apos;t be charged.
              </p>
            )}
            {team.billingStatus !== "trialing" && team.currentPeriodEnd && !team.billingCancelAt && !team.billingPausedAt && (
              <p className="text-sm text-slate-600">Next bill: {day(team.currentPeriodEnd)}</p>
            )}
            <p className="text-xs text-slate-500">Adding or removing a teammate updates the bill automatically.</p>
            {!canManage && team.billingPausedAt && (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Your team&apos;s subscription is paused, so Anchor.AI is locked for now. Your data is kept.{" "}
                {owner?.name || owner?.email || "Your team's owner"} can resume it from this page.
              </p>
            )}
            {canManage && (
              <SubscriptionControls
                plan={team.billingPlan === "pro" ? "pro" : "team"}
                seats={team.billingSeats ?? seats}
                cancelAt={team.billingCancelAt?.toISOString() ?? null}
                pausedAt={team.billingPausedAt?.toISOString() ?? null}
                resumesAt={team.billingResumesAt?.toISOString() ?? null}
                trialing={team.billingStatus === "trialing"}
              />
            )}
            {canManage && <ManageBillingButton />}
          </div>
        ) : access ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Your account has free access</h1>
            <p className="mt-2 text-sm text-slate-600">There&apos;s nothing to pay. Enjoy Anchor.AI!</p>
            <Link href="/dashboard" className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              Open Anchor.AI
            </Link>
          </div>
        ) : canManage ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Choose your plan</h1>
              <p className="mt-1 text-sm text-slate-500">
                Your team has {seats} {seats === 1 ? "person" : "people"}. The price follows your team size, and you can cancel any time.
              </p>
            </div>
            {billingConfigured() ? (
              <BillingPlans seats={seats} initialPromo={startingPromo} />
            ) : (
              <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">
                Online payment is being set up. Contact sales below and we&apos;ll get you started.
              </p>
            )}
          </>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Your team&apos;s subscription isn&apos;t active</h1>
            <p className="mt-2 text-sm text-slate-600">
              {owner?.name || owner?.email || "Your team's owner"} manages billing for your team. Once they choose a plan, you&apos;ll
              have full access right away.
            </p>
          </div>
        )}

        <div id="contact" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Talk to sales</h2>
          <p className="mb-4 mt-1 text-sm text-slate-500">
            Larger team, custom terms, or want a walkthrough first? We reply within one business day.
          </p>
          <ContactSalesForm defaultName={user.name ?? ""} defaultEmail={user.email} />
        </div>
      </section>
    </main>
  );
}
