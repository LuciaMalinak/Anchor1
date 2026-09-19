// Real, working HubSpot sync — pulls Contacts and Deals from the
// connected HubSpot account into Anchor's own contacts/deals tables. Same
// shape and same one-way (HubSpot -> Anchor), read-only design as
// src/lib/integrations/salesforce.ts, for teams that run HubSpot instead
// of (or alongside) Salesforce — see that file's header comment for why
// this only ever reads, never writes back to the connected CRM.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, contacts, deals } from "@/db/schema";
import { getOrCreateTeamId } from "@/lib/team";

// HubSpot's CRM v3 API caps a single page at 100 records — good enough
// for a first sync/demo; paging through everything is future work, same
// simplification Salesforce's RECORD_LIMIT makes.
const PAGE_LIMIT = 100;
const API_BASE = "https://api.hubapi.com";

type Connection = typeof integrationConnections.$inferSelect;

async function getConnection(userId: string): Promise<Connection> {
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, "hubspot")))
    .limit(1);
  if (!connection) {
    throw new Error("HubSpot isn't connected yet — connect it first from the Integrations page.");
  }
  return connection;
}

// Unlike Salesforce, HubSpot's refresh-token call goes to the exact same
// URL as the original code exchange (see tokenUrl in config.ts) — just a
// different grant_type.
async function refreshAccessToken(connection: Connection): Promise<string> {
  const clientId = process.env.HUBSPOT_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_INTEGRATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("HubSpot isn't configured (missing client credentials).");
  }
  if (!connection.refreshToken) {
    throw new Error("This HubSpot connection has no refresh token — reconnect it.");
  }
  const res = await fetch(`${API_BASE}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.access_token !== "string") {
    console.error("HubSpot token refresh failed:", body);
    throw new Error("Couldn't refresh the HubSpot connection — try reconnecting it.");
  }
  await db
    .update(integrationConnections)
    .set({ accessToken: body.access_token, updatedAt: new Date() })
    .where(eq(integrationConnections.id, connection.id));
  return body.access_token;
}

// Runs one CRM v3 GET, transparently refreshing the access token and
// retrying once if HubSpot reports it as expired/invalid (same shape as
// salesforce.ts's soqlQuery).
async function hubspotGet(
  connection: Connection,
  accessToken: string,
  path: string
): Promise<{ body: { results?: Record<string, unknown>[] }; accessToken: string }> {
  let token = accessToken;
  let res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = await refreshAccessToken(connection);
    res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`HubSpot request failed (${res.status}): ${bodyText.slice(0, 300)}`);
  }
  const body = await res.json();
  return { body, accessToken: token };
}

type HSProperties = Record<string, string | null>;

export async function syncHubspotData(
  userId: string
): Promise<{ contactsSynced: number; dealsSynced: number }> {
  const connection = await getConnection(userId);
  let accessToken = connection.accessToken;

  // --- Contacts -------------------------------------------------------
  // "company" is a legacy but still-populated default HubSpot contact
  // property (free text, distinct from a real Company object association)
  // — reading it directly avoids a second associations lookup per contact,
  // same "keep the first sync simple" tradeoff as the deals side below.
  const contactsRes = await hubspotGet(
    connection,
    accessToken,
    `/crm/v3/objects/contacts?limit=${PAGE_LIMIT}&properties=email,firstname,lastname,jobtitle,company`
  );
  accessToken = contactsRes.accessToken;

  let contactsSynced = 0;
  for (const rec of contactsRes.body.results ?? []) {
    const hsId = String(rec.id);
    const props = (rec.properties as HSProperties) || {};
    const name = [props.firstname, props.lastname].filter(Boolean).join(" ").trim() || "Unknown";
    const email = props.email || null;
    const role = props.jobtitle || null;
    const company = props.company || null;

    const [byHsId] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.hubspotContactId, hsId)))
      .limit(1);

    if (byHsId) {
      await db
        .update(contacts)
        .set({ name, email, company, role, updatedAt: new Date() })
        .where(eq(contacts.id, byHsId.id));
    } else {
      // Match an existing contact by email first, so a sync doesn't
      // create a duplicate of someone Anchor already knows from a
      // meeting (or from Salesforce) — it links the HubSpot id onto
      // that same row instead.
      const existingByEmail = email
        ? await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(eq(contacts.userId, userId), eq(contacts.email, email)))
            .limit(1)
        : [];

      if (existingByEmail.length > 0) {
        await db
          .update(contacts)
          .set({ hubspotContactId: hsId, company, role, updatedAt: new Date() })
          .where(eq(contacts.id, existingByEmail[0].id));
      } else {
        await db.insert(contacts).values({
          userId,
          name,
          email,
          company,
          role,
          hubspotContactId: hsId,
        });
      }
    }
    contactsSynced++;
  }

  // --- Deals ------------------------------------------------------------
  // Company website isn't pulled here (unlike Salesforce's Account.Website)
  // — HubSpot needs a separate associations call per deal to reach the
  // company record, which is more than a first sync needs; deals still
  // get a name and stage, same as manually-created ones.
  const dealsRes = await hubspotGet(
    connection,
    accessToken,
    `/crm/v3/objects/deals?limit=${PAGE_LIMIT}&properties=dealname,dealstage`
  );

  const teamId = await getOrCreateTeamId(userId);
  let dealsSynced = 0;
  for (const rec of dealsRes.body.results ?? []) {
    const hsId = String(rec.id);
    const props = (rec.properties as HSProperties) || {};
    const name = props.dealname || "Unnamed deal";
    const stage = props.dealstage || "Prospecting";

    const [existing] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.teamId, teamId), eq(deals.hubspotDealId, hsId)))
      .limit(1);

    if (existing) {
      await db.update(deals).set({ name, stage, updatedAt: new Date() }).where(eq(deals.id, existing.id));
    } else {
      await db.insert(deals).values({
        teamId,
        createdByUserId: userId,
        name,
        stage,
        hubspotDealId: hsId,
      });
    }
    dealsSynced++;
  }

  return { contactsSynced, dealsSynced };
}
