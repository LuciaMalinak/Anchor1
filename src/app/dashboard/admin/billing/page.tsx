import Link from "next/link";
import { requireAppOwnerPage } from "@/lib/adminAccess";
import { AdminBillingClient } from "./AdminBillingClient";

// Owner only: promo codes for chosen clients, which accounts use Anchor
// for free, everyone's subscription, and "Contact sales" requests.
export default async function AdminBillingPage() {
  await requireAppOwnerPage();
  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/dashboard/admin" className="text-xs font-medium text-slate-400 hover:text-brand">
          ← Admin
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Billing</h1>
        <p className="mt-1 text-sm text-slate-500">Promo codes, free accounts, subscriptions and sales requests.</p>
      </div>
      <AdminBillingClient />
    </div>
  );
}
