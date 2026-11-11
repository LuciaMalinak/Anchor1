import { Suspense } from "react";
import { auth } from "@/auth";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PROVIDERS, isProviderConfigured, hasScopes } from "@/lib/integrations/config";
import { hasDriveAccess } from "@/lib/integrations/drive";
import { IntegrationsClient } from "./IntegrationsClient";

export default async function IntegrationsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const rows = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.userId, session.user.id));
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  const providerCards = Object.values(PROVIDERS).map((p) => {
    const connection = byProvider.get(p.key);
    return {
      key: p.key,
      name: p.name,
      description: p.description,
      configured: isProviderConfigured(p.key),
      connected: Boolean(connection),
      connectedLabel: connection?.externalAccountEmail ?? null,
      connectedAt: connection?.connectedAt ? connection.connectedAt.toISOString() : null,
      // A connection made before Anchor.AI asked for everything it uses up
      // front (e.g. Google before calendar events and Gmail drafts were
      // added): one click to approve the rest.
      // Google only: other providers report granted scopes in their own
      // formats, so a mismatch there wouldn't mean anything is missing.
      ...(p.key === "google" && connection && !hasScopes(connection.scope, p.scopes.filter((sc) => sc.startsWith("https://")).join(" "))
        ? { updateHref: `/api/integrations/${p.key}/connect?returnTo=${encodeURIComponent(`/dashboard/integrations?connected=${p.key}`)}` }
        : {}),
    };
  });

  // Google Drive isn't a separate connection: it adds read-only Drive
  // access to the Google one (GOOGLE_EXTRA_SCOPES.drive_read), and the
  // connect round trip comes straight back to this page.
  const google = byProvider.get("google");
  const driveCard = {
    key: "google_drive",
    name: "Google Drive",
    description:
      "Find the decks, proposals and notes about a deal in your Google Drive, so Ask Anchor and briefings can draw on them.",
    configured: isProviderConfigured("google"),
    connected: Boolean(google && hasDriveAccess(google.scope)),
    connectedLabel: google?.externalAccountEmail ?? null,
    connectedAt: google?.updatedAt ? google.updatedAt.toISOString() : null,
    connectHref: `/api/integrations/google/connect?add=drive_read&returnTo=${encodeURIComponent("/dashboard/integrations?connected=google_drive")}`,
    disconnectable: false,
    connectedNote: "Uses your Google connection. Disconnect Google to remove it.",
  };
  // Meeting requests in Slack DMs: the person's own Slack user token on
  // top of the Slack connection (SLACK_USER_SCOPES), so Anchor can spot
  // "let's find time" and offer to set the meeting up (meetingProposals.ts).
  const slack = byProvider.get("slack");
  const slackDmsCard = {
    key: "slack_dms",
    name: "Meeting requests in Slack",
    description:
      "Anchor.AI reads your Slack direct messages for people asking to meet, and offers to set the meeting up for you: Zoom, Teams, Google Meet or in person, with everyone invited.",
    configured: isProviderConfigured("slack"),
    connected: Boolean(slack?.userAccessToken),
    connectedLabel: slack?.externalAccountEmail ?? null,
    connectedAt: slack?.updatedAt ? slack.updatedAt.toISOString() : null,
    connectHref: `/api/integrations/slack/connect?add=read_dms&returnTo=${encodeURIComponent("/dashboard/integrations?connected=slack_dms")}`,
    disconnectable: false,
    connectedNote: "Uses your Slack connection. Disconnect Slack to remove it.",
  };
  const providers = providerCards.flatMap((card) =>
    card.key === "google" ? [card, driveCard] : card.key === "slack" ? [card, slackDmsCard] : [card]
  );

  return (
    <Suspense fallback={null}>
      <IntegrationsClient providers={providers} />
    </Suspense>
  );
}
