import { Logo } from "@/components/Logo";

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo size="md" />
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Check your email</h1>
        <p className="mt-1 text-sm text-slate-500">
          We sent you a sign-in link. Open it on this device to continue.
        </p>
      </div>
    </main>
  );
}
