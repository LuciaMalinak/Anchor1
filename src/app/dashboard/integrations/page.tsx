import { Suspense } from "react";
import { auth } from "@/auth";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PROVIDERS, isProviderConfigured } from "@/lib/integrations/config";
import { IntegrationsClient } from "./IntegrationsClient";

export default async function IntegrationsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const rows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.userId, session.user.id));
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  const providers = Object.values(PROVIDERS).map((p) => {
    const connection = byProvider.get(p.key);
    return {
      key: p.key,
      name: p.name,
      description: p.description,
      configured: isProviderConfigured(p.key),
      connected: Boolean(connection),
      connectedLabel: connection?.externalAccountEmail ?? null,
      connectedAt: connection?.connectedAt ? connection.connectedAt.toISOString() : null,
    };
  });

  return (
    <Suspense fallback={null}>
      <IntegrationsClient providers={providers} />
    </Suspense>
  );
}
