// Real, working Salesforce sync — pulls Contacts and Opportunities from
// the connected Salesforce org into Anchor's own contacts/deals tables.
// One-way (Salesforce -> Anchor) by design for now: writing back to a
// prospect's live production CRM from an early-stage tool carries real
// risk (a bad write could corrupt a customer's real data), whereas a
// read-only pull is safe to run repeatedly and is what makes the "see
// your real CRM data enriched with meeting intelligence" demo work.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, contacts, deals } from "@/db/schema";
import { getOrCreateTeamId } from "@/lib/team";

const API_VERSION = "v59.0";
const RECORD_LIMIT = 200;

type Connection = typeof integrationConnections.$inferSelect;

async function getConnection(userId: string): Promise<Connection> {
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, "salesforce")))
    .limit(1);
  if (!connection) {
    throw new Error("Salesforce isn't connected yet — connect it first from the Integrations page.");
  }
  if (!connection.instanceUrl) {
    throw new Error("This Salesforce connection is missing its instance URL — try disconnecting and reconnecting.");
  }
  return connection;
}

async function refreshAccessToken(connection: Connection): Promise<string> {
  const clientId = process.env.SALESFORCE_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_INTEGRATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Salesforce isn't configured (missing client credentials).");
  }
  if (!connection.refreshToken) {
    throw new Error("This Salesforce connection has no refresh token — reconnect it.");
  }
  const res = await fetch("https://login.salesforce.com/services/oauth2/token", {
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
    console.error("Salesforce token refresh failed:", body);
    throw new Error("Couldn't refresh the Salesforce connection — try reconnecting it.");
  }
  await db
    .update(integrationConnections)
    .set({ accessToken: body.access_token, updatedAt: new Date() })
    .where(eq(integrationConnections.id, connection.id));
  return body.access_token;
}

// Runs one SOQL query, transparently refreshing the access token and
// retrying once if Salesforce reports it as expired/invalid.
async function soqlQuery(
  connection: Connection,
  accessToken: string,
  soql: string
): Promise<{ records: Record<string, unknown>[]; accessToken: string }> {
  const path = `${connection.instanceUrl}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  let token = accessToken;
  let res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = await refreshAccessToken(connection);
    res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Salesforce query failed (${res.status}): ${bodyText.slice(0, 300)}`);
  }
  const body = await res.json();
  return { records: Array.isArray(body.records) ? body.records : [], accessToken: token };
}

type SFAccount = { Name?: string; Website?: string } | null;

export async function syncSalesforceData(
  userId: string
): Promise<{ contactsSynced: number; dealsSynced: number }> {
  const connection = await getConnection(userId);
  let accessToken = connection.accessToken;

  // --- Contacts -------------------------------------------------------
  const contactsQuery = await soqlQuery(
    connection,
    accessToken,
    "SELECT Id, Name, Email, Title, Account.Name FROM Contact WHERE Email != null ORDER BY LastModifiedDate DESC LIMIT " +
      RECORD_LIMIT
  );
  accessToken = contactsQuery.accessToken;

  let contactsSynced = 0;
  for (const rec of contactsQuery.records) {
    const sfId = String(rec.Id);
    const name = typeof rec.Name === "string" && rec.Name ? rec.Name : "Unknown";
    const email = typeof rec.Email === "string" ? rec.Email : null;
    const role = typeof rec.Title === "string" ? rec.Title : null;
    const account = rec.Account as SFAccount;
    const company = account?.Name ?? null;

    const [bySfId] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.salesforceContactId, sfId)))
      .limit(1);

    if (bySfId) {
      await db
        .update(contacts)
        .set({ name, email, company, role, updatedAt: new Date() })
        .where(eq(contacts.id, bySfId.id));
    } else {
      // Match an existing contact by email first, so a sync doesn't
      // create a duplicate of someone Anchor already knows from a
      // meeting — it links the Salesforce id onto that same row instead.
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
          .set({ salesforceContactId: sfId, company, role, updatedAt: new Date() })
          .where(eq(contacts.id, existingByEmail[0].id));
      } else {
        await db.insert(contacts).values({
          userId,
          name,
          email,
          company,
          role,
          salesforceContactId: sfId,
        });
      }
    }
    contactsSynced++;
  }

  // --- Opportunities (-> deals) ----------------------------------------
  const oppsQuery = await soqlQuery(
    connection,
    accessToken,
    "SELECT Id, Name, StageName, Account.Name, Account.Website FROM Opportunity ORDER BY LastModifiedDate DESC LIMIT " +
      RECORD_LIMIT
  );

  const teamId = await getOrCreateTeamId(userId);
  let dealsSynced = 0;
  for (const rec of oppsQuery.records) {
    const sfId = String(rec.Id);
    const name = typeof rec.Name === "string" && rec.Name ? rec.Name : "Unnamed opportunity";
    const stage = typeof rec.StageName === "string" && rec.StageName ? rec.StageName : "Prospecting";
    const account = rec.Account as SFAccount;
    const companyWebsite = account?.Website ?? null;

    const [existing] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(eq(deals.teamId, teamId), eq(deals.salesforceOpportunityId, sfId)))
      .limit(1);

    if (existing) {
      await db
        .update(deals)
        .set({ name, stage, companyWebsite, updatedAt: new Date() })
        .where(eq(deals.id, existing.id));
    } else {
      await db.insert(deals).values({
        teamId,
        createdByUserId: userId,
        name,
        stage,
        companyWebsite,
        salesforceOpportunityId: sfId,
      });
    }
    dealsSynced++;
  }

  return { contactsSynced, dealsSynced };
}
