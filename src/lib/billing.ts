import Stripe from "stripe";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { promoCodes, teams, users } from "@/db/schema";
import { isAppOwner } from "@/lib/appOwner";

// Paying for Anchor. The team owner subscribes once through Stripe and
// the whole team is covered:
//  - Team: $49 per person per month.
//  - Pro:  $149 for the leader (the owner) + $59 per other teammate.
// The bill follows the team: seats are re-synced as people join or leave
// (syncSeats). A promo code (Admin → Billing) starts the subscription
// with a free trial of 7 or 14 days; the card is taken up front and
// charged when the trial ends.
//
// Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. The prices are
// created in Stripe automatically the first time they're needed (found
// again by their lookup keys), so nothing has to be set up there by hand.

export type Plan = "team" | "pro";
export type Team = typeof teams.$inferSelect;

export const PLANS: Record<Plan, { name: string; tagline: string; features: string[] }> = {
  team: {
    name: "Team",
    tagline: "$49 per person / month",
    features: ["Meeting recording, transcripts and summaries", "Action tracking and recaps", "Deal and contact tracking"],
  },
  pro: {
    name: "Pro",
    tagline: "$149 for you + $59 per teammate / month",
    features: [
      "Everything in Team",
      "Pre-meeting briefs from your history",
      "Live assist for delegates, in a call or in person",
      "Style profile, position bank and process scoring",
    ],
  },
};

const PRICES = {
  team_seat: { lookupKey: "anchor_team_seat_monthly", cents: 4900, name: "Anchor.AI Team (per person)" },
  pro_leader: { lookupKey: "anchor_pro_leader_monthly", cents: 14900, name: "Anchor.AI Pro (leader seat)" },
  pro_delegate: { lookupKey: "anchor_pro_delegate_monthly", cents: 5900, name: "Anchor.AI Pro (delegate seat)" },
} as const;
type PriceKey = keyof typeof PRICES;

// Statuses that keep the team in. past_due: Stripe is still retrying the
// card, so don't lock people out mid-week over a declined renewal.
const OPEN_STATUSES = new Set(["active", "trialing", "past_due"]);

export function billingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let stripeClient: Stripe | null = null;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Payments aren't set up yet (STRIPE_SECRET_KEY is missing).");
  stripeClient ??= new Stripe(key);
  return stripeClient;
}

export function hasAccess(
  team: Pick<Team, "billingExempt" | "billingStatus"> & Partial<Pick<Team, "billingPausedAt">> | null | undefined,
  email?: string | null,
): boolean {
  if (isAppOwner(email)) return true;
  if (!team) return false;
  if (team.billingExempt) return true;
  // Paused: nothing is charged and nobody gets in until it resumes. The
  // team's data is kept.
  if (team.billingPausedAt) return false;
  return OPEN_STATUSES.has(team.billingStatus ?? "");
}

export async function teamMemberCount(teamId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.teamId, teamId), sql`${users.email} NOT LIKE 'deleted-%@anchor.invalid'`));
  return Math.max(1, Number(row?.n ?? 1));
}

// Monthly price in dollars for a plan at a team size.
export function monthlyPrice(plan: Plan, seats: number): number {
  return plan === "team" ? 49 * seats : 149 + 59 * Math.max(0, seats - 1);
}

const priceIds = new Map<PriceKey, string>();

// The Stripe price for a seat type, created the first time if missing.
async function priceId(key: PriceKey): Promise<string> {
  const cached = priceIds.get(key);
  if (cached) return cached;
  const def = PRICES[key];
  const s = stripe();
  const found = await s.prices.list({ lookup_keys: [def.lookupKey], active: true, limit: 1 });
  let id = found.data[0]?.id;
  if (!id) {
    const price = await s.prices.create({
      currency: "usd",
      unit_amount: def.cents,
      recurring: { interval: "month" },
      lookup_key: def.lookupKey,
      product_data: { name: def.name },
    });
    id = price.id;
  }
  priceIds.set(key, id);
  return id;
}

// The subscription's line items for a plan and team size.
async function lineItems(plan: Plan, seats: number): Promise<{ price: string; quantity: number }[]> {
  if (plan === "team") return [{ price: await priceId("team_seat"), quantity: seats }];
  const items = [{ price: await priceId("pro_leader"), quantity: 1 }];
  if (seats > 1) items.push({ price: await priceId("pro_delegate"), quantity: seats - 1 });
  return items;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export type PromoCheck = { ok: true; code: string; trialDays: number } | { ok: false; error: string };

// Whether a promo code can be used by this team right now.
export async function checkPromo(rawCode: string, team: Pick<Team, "promoCodeUsed" | "trialEndsAt">): Promise<PromoCheck> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: "Enter a promo code." };
  const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code));
  if (!promo || !promo.active) return { ok: false, error: "That promo code isn't valid." };
  if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) return { ok: false, error: "That promo code has expired." };
  if (promo.maxUses !== null && promo.uses >= promo.maxUses) return { ok: false, error: "That promo code has already been used." };
  if (team.promoCodeUsed || team.trialEndsAt) return { ok: false, error: "Your team has already had a free trial." };
  return { ok: true, code, trialDays: promo.trialDays };
}

// Counts one use of a promo code, unless it's already used up.
async function countPromoUse(code: string): Promise<void> {
  await db
    .update(promoCodes)
    .set({ uses: sql`${promoCodes.uses} + 1` })
    .where(and(eq(promoCodes.code, code), or(isNull(promoCodes.maxUses), lt(promoCodes.uses, promoCodes.maxUses))));
}

async function customerFor(team: Team, email: string, name: string | null): Promise<string> {
  if (team.stripeCustomerId) return team.stripeCustomerId;
  const customer = await stripe().customers.create({
    email,
    name: name ?? undefined,
    metadata: { teamId: team.id, teamName: team.name },
  });
  await db.update(teams).set({ stripeCustomerId: customer.id }).where(eq(teams.id, team.id));
  return customer.id;
}

// A Stripe Checkout page for the team owner to subscribe.
export async function createCheckout(params: {
  team: Team;
  plan: Plan;
  email: string;
  name: string | null;
  promo: { code: string; trialDays: number } | null;
  baseUrl: string;
}): Promise<string> {
  const { team, plan, promo, baseUrl } = params;
  const seats = await teamMemberCount(team.id);
  const customer = await customerFor(team, params.email, params.name);
  const metadata = { teamId: team.id, plan, promo: promo?.code ?? "" };
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: team.id,
    line_items: await lineItems(plan, seats),
    payment_method_collection: "always",
    subscription_data: {
      metadata,
      ...(promo ? { trial_period_days: promo.trialDays } : {}),
    },
    metadata,
    success_url: `${baseUrl}/billing?checkout=done&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout page.");
  return session.url;
}

// Stripe's billing page for the owner: card, invoices, cancel.
export async function createPortal(team: Team, baseUrl: string): Promise<string> {
  if (!team.stripeCustomerId) throw new Error("This team has no billing account yet.");
  const session = await stripe().billingPortal.sessions.create({
    customer: team.stripeCustomerId,
    return_url: `${baseUrl}/billing`,
  });
  return session.url;
}

function toDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null;
}

// Copies a subscription's state onto its team. Called from the webhook
// and when the owner comes back from Checkout.
export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const teamId = sub.metadata?.teamId;
  if (!teamId) return;
  const plan = (sub.metadata?.plan === "pro" ? "pro" : "team") as Plan;
  const seats = sub.items.data.reduce((n, item) => n + (item.quantity ?? 0), 0);
  const periodEnd = Math.max(0, ...sub.items.data.map((i) => i.current_period_end ?? 0));
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) return;
  // A team's newer subscription wins over an older one ending.
  if (team.stripeSubscriptionId && team.stripeSubscriptionId !== sub.id && sub.status === "canceled") return;
  const promo = sub.metadata?.promo || null;
  const firstTimePromo = Boolean(promo && sub.trial_end && !team.promoCodeUsed);
  await db
    .update(teams)
    .set({
      billingStatus: sub.status,
      billingPlan: plan,
      billingSeats: seats,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      trialEndsAt: toDate(sub.trial_end),
      currentPeriodEnd: toDate(periodEnd),
      billingCancelAt: sub.status === "canceled" ? null : sub.cancel_at_period_end ? toDate(periodEnd) : toDate(sub.cancel_at),
      billingPausedAt: sub.pause_collection && sub.status !== "canceled" ? (team.billingPausedAt ?? new Date()) : null,
      billingResumesAt: sub.pause_collection && sub.status !== "canceled" ? toDate(sub.pause_collection.resumes_at) : null,
      ...(firstTimePromo ? { promoCodeUsed: promo } : {}),
    })
    .where(eq(teams.id, teamId));
  if (firstTimePromo && promo) await countPromoUse(promo);
}

export async function syncCheckoutSession(sessionId: string, teamId: string): Promise<void> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  if (session.client_reference_id !== teamId) return;
  const sub = session.subscription;
  if (sub && typeof sub !== "string") await syncSubscription(sub);
}

// Keeps the subscription's seats in step with the team's size: adding
// or removing someone updates the bill (prorated by Stripe). Cheap when
// nothing changed, so it's safe to call on page loads.
export async function syncSeats(teamId: string): Promise<void> {
  if (!billingConfigured()) return;
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team?.stripeSubscriptionId || !team.billingPlan || !OPEN_STATUSES.has(team.billingStatus ?? "")) return;
  const seats = await teamMemberCount(teamId);
  if (seats === team.billingSeats) return;
  const s = stripe();
  const sub = await s.subscriptions.retrieve(team.stripeSubscriptionId);
  const plan = team.billingPlan as Plan;
  const wanted = await lineItems(plan, seats);
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  for (const w of wanted) {
    const existing = sub.items.data.find((i) => i.price.id === w.price);
    items.push(existing ? { id: existing.id, quantity: w.quantity } : { price: w.price, quantity: w.quantity });
  }
  // A delegate line that's no longer needed (back to one person on Pro).
  for (const i of sub.items.data) {
    if (!wanted.some((w) => w.price === i.price.id)) items.push({ id: i.id, deleted: true });
  }
  const updated = await s.subscriptions.update(sub.id, { items, proration_behavior: "create_prorations" });
  await syncSubscription(updated);
}

export type SubscriptionAction =
  | { action: "change-plan"; plan: Plan }
  | { action: "cancel" } // at the end of the paid period; can be undone
  | { action: "cancel-now" } // straight away (Admin only)
  | { action: "keep" } // undo a cancellation scheduled for the period end
  | { action: "pause"; months: number | null } // null = until resumed by hand
  | { action: "resume" };

// Changes a team's subscription from inside Anchor: switch between Team
// and Pro (prorated), cancel or undo a cancellation, pause or resume
// billing. Used by the owner's Billing page and by Admin → Billing for
// any client. Stripe is the source of truth: the team row is updated
// from Stripe's answer, the same way the webhook does.
export async function manageSubscription(team: Team, change: SubscriptionAction): Promise<void> {
  if (!team.stripeSubscriptionId) throw new Error("This team has no subscription.");
  const s = stripe();
  const sub = await s.subscriptions.retrieve(team.stripeSubscriptionId);
  if (sub.status === "canceled") throw new Error("This subscription has already ended. Subscribe again from the Billing page.");
  let updated: Stripe.Subscription;
  switch (change.action) {
    case "change-plan": {
      const current = (sub.metadata?.plan === "pro" ? "pro" : "team") as Plan;
      if (change.plan === current) return;
      const seats = await teamMemberCount(team.id);
      const wanted = await lineItems(change.plan, seats);
      const items: Stripe.SubscriptionUpdateParams.Item[] = [
        ...sub.items.data.filter((i) => !wanted.some((w) => w.price === i.price.id)).map((i) => ({ id: i.id, deleted: true })),
        ...wanted.map((w) => {
          const existing = sub.items.data.find((i) => i.price.id === w.price);
          return existing ? { id: existing.id, quantity: w.quantity } : { price: w.price, quantity: w.quantity };
        }),
      ];
      updated = await s.subscriptions.update(sub.id, {
        items,
        metadata: { ...sub.metadata, plan: change.plan },
        proration_behavior: "create_prorations",
      });
      break;
    }
    case "cancel":
      updated = await s.subscriptions.update(sub.id, { cancel_at_period_end: true });
      break;
    case "keep":
      updated = await s.subscriptions.update(sub.id, { cancel_at_period_end: false });
      break;
    case "cancel-now":
      updated = await s.subscriptions.cancel(sub.id);
      break;
    case "pause": {
      const months = change.months;
      if (months !== null && (!Number.isInteger(months) || months < 1 || months > 12)) throw new Error("Pause for 1 to 12 months.");
      const resumesAt = months ? Math.floor(new Date().setMonth(new Date().getMonth() + months) / 1000) : undefined;
      updated = await s.subscriptions.update(sub.id, {
        pause_collection: { behavior: "void", ...(resumesAt ? { resumes_at: resumesAt } : {}) },
      });
      break;
    }
    case "resume":
      updated = await s.subscriptions.update(sub.id, { pause_collection: "" });
      break;
  }
  await syncSubscription(updated);
}

export function parseSubscriptionAction(body: Record<string, unknown>): SubscriptionAction | null {
  switch (body.action) {
    case "change-plan":
      return body.plan === "pro" || body.plan === "team" ? { action: "change-plan", plan: body.plan } : null;
    case "cancel":
    case "cancel-now":
    case "keep":
    case "resume":
      return { action: body.action };
    case "pause":
      return { action: "pause", months: body.months === null || body.months === undefined ? null : Number(body.months) };
  }
  return null;
}
