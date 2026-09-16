"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Provider = {
  key: "google" | "microsoft" | "slack";
  name: string;
  description: string;
  configured: boolean;
  connected: boolean;
  connectedLabel: string | null;
  connectedAt: string | null;
};

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "This one still needs API credentials added to the environment before it can connect.",
  denied: "The connection was cancelled before it finished.",
  missing_code: "That didn't come back from the provider the way it should have — try connecting again.",
  state_mismatch: "That connection attempt didn't match this session — try again.",
  token_exchange: "The provider didn't accept the connection — double-check the client ID/secret.",
  callback_failed: "Something went wrong finishing that connection.",
  unknown_provider: "That's not a provider Anchor knows about.",
};

function BadgeDot({ color }: { color: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export function IntegrationsClient({ providers }: { providers: Provider[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const connectedParam = searchParams.get("connected");
  const errorParam = searchParams.get("error");
  const errorProvider = searchParams.get("provider");

  async function handleDisconnect(key: string, name: string) {
    if (!window.confirm(`Disconnect ${name}? Anchor will stop being able to use it until you reconnect.`)) {
      return;
    }
    setDisconnecting(key);
    setLocalError(null);
    try {
      const res = await fetch(`/api/integrations/${key}/disconnect`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't disconnect");
      }
      router.refresh();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Couldn't disconnect");
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-brand">Integrations</h1>
        <p className="text-sm text-slate-500">
          Connect the tools your team already uses so Anchor sees more than just recorded meetings.
        </p>
      </div>

      {connectedParam && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Connected. Anchor will start using this the next time it&apos;s relevant.
        </div>
      )}
      {errorParam && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ERROR_MESSAGES[errorParam] || "Something went wrong connecting that."}
          {errorProvider ? ` (${errorProvider})` : ""}
        </div>
      )}
      {localError && <p className="text-sm text-red-600">{localError}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {providers.map((p) => (
          <div
            key={p.key}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div>
              <p className="text-sm font-medium text-slate-900">{p.name}</p>
              <p className="mt-1 text-xs text-slate-500">{p.description}</p>
            </div>

            <div className="flex items-center gap-2 text-xs">
              {p.connected ? (
                <>
                  <BadgeDot color="bg-emerald-500" />
                  <span className="text-emerald-700">
                    Connected{p.connectedLabel ? ` as ${p.connectedLabel}` : ""}
                  </span>
                </>
              ) : p.configured ? (
                <>
                  <BadgeDot color="bg-slate-300" />
                  <span className="text-slate-500">Not connected</span>
                </>
              ) : (
                <>
                  <BadgeDot color="bg-amber-400" />
                  <span className="text-amber-700">Needs setup</span>
                </>
              )}
            </div>

            {p.connected ? (
              <button
                type="button"
                onClick={() => handleDisconnect(p.key, p.name)}
                disabled={disconnecting === p.key}
                className="mt-1 self-start rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                {disconnecting === p.key ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : p.configured ? (
              <a
                href={`/api/integrations/${p.key}/connect`}
                className="mt-1 self-start rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-dark"
              >
                Connect
              </a>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400">
                Add API credentials to the environment to turn this on.
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400">
        Connecting sets up secure access — Anchor pulling this data into deal context (so Ask Anchor and
        handoff briefings can use it) is the next step once a connection is live.
      </p>
    </div>
  );
}
