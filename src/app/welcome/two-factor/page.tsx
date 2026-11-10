import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Logo } from "@/components/Logo";
import { TwoFactorSettings } from "@/components/TwoFactorSettings";

// Where src/proxy.ts sends someone whose team requires two-step
// verification before they've turned it on.
export default async function RequiredTwoFactorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <Logo size="md" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Turn on two-step verification</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your team requires it to keep client data safe. It takes a minute: you&apos;ll need an
            authenticator app on your phone, such as Microsoft Authenticator or Google Authenticator.
          </p>
        </div>
      </div>
      <TwoFactorSettings required />
    </main>
  );
}
