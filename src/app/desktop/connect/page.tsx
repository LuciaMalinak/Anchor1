import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Logo } from "@/components/Logo";
import { DesktopConnectClient } from "./DesktopConnectClient";

// Where Anchor Desktop's "Sign in to Anchor" button opens the browser (see
// startSignIn in desktop/src/main.ts). Not signed in yet: go through the
// normal sign-in page (email link, Google, LinkedIn or password) and come
// back here. Signed in: DesktopConnectClient creates a desktop token and
// hands it straight to the app, so nobody copies or pastes anything.
//
// `state` is a one-time value the app generated; it only accepts a token
// silently when the same value comes back with it. `device` is the
// computer's name, used to label the token on the Integrations page.
export default async function DesktopConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; device?: string }>;
}) {
  const { state: rawState, device: rawDevice } = await searchParams;
  const state = rawState && /^[A-Za-z0-9_-]{16,128}$/.test(rawState) ? rawState : null;
  const device = (rawDevice ?? "").replace(/[^\p{L}\p{N} ._'’-]/gu, "").trim().slice(0, 60) || null;

  const session = await auth();
  if (!session?.user?.id) {
    const params = new URLSearchParams();
    if (state) params.set("state", state);
    if (device) params.set("device", device);
    const here = `/desktop/connect${params.size ? `?${params}` : ""}`;
    redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo size="md" />
      <DesktopConnectClient state={state} device={device} email={session.user.email ?? ""} />
    </main>
  );
}
