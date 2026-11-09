import Link from "next/link";
import { requireAppOwnerPage } from "@/lib/adminAccess";
import { DataSafetyClient } from "./DataSafetyClient";

// Owner only: where anyone's deals are, putting people back on their team,
// restoring deleted deals, and the nightly backup.
export default async function DataSafetyPage() {
  await requireAppOwnerPage();
  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/dashboard/admin" className="text-xs font-medium text-slate-400 hover:text-brand">
          ← Admin
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Data safety</h1>
        <p className="mt-1 text-sm text-slate-500">
          Nothing is erased: deleted deals wait here to be restored, deleted calls, files and contacts are kept in the change
          log, and the whole database is backed up every night.
        </p>
      </div>
      <DataSafetyClient />
    </div>
  );
}
