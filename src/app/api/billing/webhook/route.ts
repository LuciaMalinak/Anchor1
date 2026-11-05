import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, syncSubscription } from "@/lib/billing";

// Stripe tells Anchor about every change to a subscription here: started,
// trial ending, renewed, card declined, cancelled. Each event is checked
// against STRIPE_WEBHOOK_SECRET, then the subscription is copied onto
// its team (billing.ts). Point Stripe at /api/billing/webhook.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "Not configured" }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch (err) {
    console.error("[billing] webhook signature check failed:", err);
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }
  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        await syncSubscription(event.data.object);
        break;
      case "checkout.session.completed": {
        const id = event.data.object.subscription;
        if (id) await syncSubscription(await stripe().subscriptions.retrieve(typeof id === "string" ? id : id.id));
        break;
      }
      case "invoice.payment_failed":
      case "invoice.paid": {
        const sub = event.data.object.parent?.subscription_details?.subscription;
        if (sub) await syncSubscription(await stripe().subscriptions.retrieve(typeof sub === "string" ? sub : sub.id));
        break;
      }
    }
  } catch (err) {
    console.error(`[billing] handling ${event.type} failed:`, err);
    // Stripe retries on errors, which is what we want here.
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
