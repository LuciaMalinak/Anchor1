import Link from "next/link";
import Image from "next/image";
import { auth, signOut } from "@/auth";
import { Logo } from "@/components/Logo";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/dashboard">
            <Logo size="md" />
          </Link>
          <nav className="flex items-center gap-5 text-sm font-medium text-slate-600">
            <Link href="/dashboard/deals" className="hover:text-brand">
              Deals
            </Link>
            <Link href="/dashboard/insights" className="hover:text-brand">
              Insights
            </Link>
            <Link href="/dashboard/contacts" className="hover:text-brand">
              Contacts
            </Link>
            <Link href="/dashboard/team" className="hover:text-brand">
              Team
            </Link>
          </nav>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <Link href="/dashboard/profile" className="flex items-center gap-2 hover:text-brand">
              {session?.user?.image ? (
                <Image
                  src={session.user.image}
                  alt=""
                  width={24}
                  height={24}
                  unoptimized
                  className="h-6 w-6 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white">
                  {(session?.user?.name || session?.user?.email || "?")[0]?.toUpperCase()}
                </span>
              )}
              <span>{session?.user?.name || session?.user?.email}</span>
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" className="hover:text-slate-900">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  );
}
