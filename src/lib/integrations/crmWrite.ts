// After-call CRM updates (see /api/meetings/[id]/crm-update and
// CrmUpdateCard.tsx). Unlike the one-way syncs in salesforce.ts and
// hubspot.ts, this writes to the customer's CRM, so it only ever touches
// four fields on the one linked record (stage, close date, amount, next
// step), and only with values the user has reviewed and approved. Every
// value is validated again here against the CRM's own current options
// before it is written.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import {
  getSalesforceConnection,
  refreshSalesforceAccessToken,
  SALESFORCE_API_VERSION,
} from "./salesforce";
import { getHubspotConnection, refreshHubspotAccessToken, HUBSPOT_API_BASE } from "./hubspot";
import { isProviderConfigured } from "./config";

import type { CrmChanges, CrmProvider, CrmSnapshot } from "./crmValidate";

export type { CrmChanges, CrmProvider, CrmSnapshot } from "./crmValidate";
export { validateChanges, isRealDate } from "./crmValidate";

export const CRM_NAME: Record<CrmProvider, string> = { salesforce: "Salesforce", hubspot: "HubSpot" };

// Thrown when HubSpot needs the deals-write permission the default
// connection doesn't ask for; the route turns it into a reconnect link.
export class NeedsCrmPermissionError extends Error {
  constructor(public provider: CrmProvider) {
    super(`${CRM_NAME[provider]} needs write permission`);
  }
}

// Which CRM this deal can be updated in by this user: the deal must be
// linked to a record (set by the sync), and this user must have that CRM
// connected themselves, since writes go out under their own account.
export async function crmTargetFor(
  userId: string,
  deal: { salesforceOpportunityId: string | null; hubspotDealId: string | null }
): Promise<
  | { provider: CrmProvider; recordId: string }
  | { provider: null; reason: "not_linked" | "not_connected"; linkedTo: CrmProvider | null }
> {
  const links: { provider: CrmProvider; recordId: string | null }[] = [
    { provider: "salesforce", recordId: deal.salesforceOpportunityId },
    { provider: "hubspot", recordId: deal.hubspotDealId },
  ];
  const linked = links.filter((l): l is { provider: CrmProvider; recordId: string } => Boolean(l.recordId));
  if (linked.length === 0) return { provider: null, reason: "not_linked", linkedTo: null };
  for (const l of linked) {
    if (!isProviderConfigured(l.provider)) continue;
    const [connection] = await db
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, l.provider)))
      .limit(1);
    if (connection) return l;
  }
  return { provider: null, reason: "not_connected", linkedTo: linked[0].provider };
}

// ---------------------------------------------------------------------------
// Salesforce

async function salesforceRequest(
  userId: string,
  method: "GET" | "PATCH",
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> | null; instanceUrl: string }> {
  const connection = await getSalesforceConnection(userId);
  const url = `${connection.instanceUrl}/services/data/${SALESFORCE_API_VERSION}${path}`;
  const send = (token: string) =>
    fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  let res = await send(connection.accessToken);
  if (res.status === 401) res = await send(await refreshSalesforceAccessToken(connection));
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Salesforce request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = res.status === 204 ? null : ((await res.json().catch(() => null)) as Record<string, unknown> | null);
  return { status: res.status, json, instanceUrl: connection.instanceUrl! };
}

async function readSalesforce(userId: string, opportunityId: string): Promise<CrmSnapshot> {
  const id = encodeURIComponent(opportunityId);
  const [record, describe] = await Promise.all([
    salesforceRequest(userId, "GET", `/sobjects/Opportunity/${id}?fields=Name,StageName,CloseDate,Amount,NextStep`),
    salesforceRequest(userId, "GET", "/sobjects/Opportunity/describe"),
  ]);
  const r = record.json ?? {};
  const fields = Array.isArray(describe.json?.fields) ? (describe.json!.fields as Record<string, unknown>[]) : [];
  const stageField = fields.find((f) => f.name === "StageName");
  const picklist = Array.isArray(stageField?.picklistValues) ? (stageField!.picklistValues as Record<string, unknown>[]) : [];
  return {
    provider: "salesforce",
    recordId: opportunityId,
    recordName: typeof r.Name === "string" ? r.Name : null,
    recordUrl: `${record.instanceUrl}/lightning/r/Opportunity/${id}/view`,
    stage: typeof r.StageName === "string" ? r.StageName : null,
    stageOptions: picklist
      .filter((p) => p.active !== false && typeof p.value === "string")
      .map((p) => ({ value: p.value as string, label: typeof p.label === "string" ? p.label : (p.value as string) })),
    closeDate: typeof r.CloseDate === "string" ? r.CloseDate.slice(0, 10) : null,
    amount: typeof r.Amount === "number" ? r.Amount : null,
    nextStep: typeof r.NextStep === "string" ? r.NextStep : null,
  };
}

async function writeSalesforce(userId: string, opportunityId: string, changes: CrmChanges): Promise<void> {
  const body: Record<string, unknown> = {};
  if (changes.stage !== undefined) body.StageName = changes.stage;
  if (changes.closeDate !== undefined) body.CloseDate = changes.closeDate;
  if (changes.amount !== undefined) body.Amount = changes.amount;
  if (changes.nextStep !== undefined) body.NextStep = changes.nextStep;
  await salesforceRequest(userId, "PATCH", `/sobjects/Opportunity/${encodeURIComponent(opportunityId)}`, body);
}

// ---------------------------------------------------------------------------
// HubSpot

async function hubspotRequest(
  userId: string,
  method: "GET" | "PATCH",
  path: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const connection = await getHubspotConnection(userId);
  const send = (token: string) =>
    fetch(`${HUBSPOT_API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  let res = await send(connection.accessToken);
  if (res.status === 401) res = await send(await refreshHubspotAccessToken(connection));
  if (res.status === 403 && method === "PATCH") throw new NeedsCrmPermissionError("hubspot");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return ((await res.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
}

async function readHubspot(userId: string, dealId: string): Promise<CrmSnapshot> {
  const id = encodeURIComponent(dealId);
  const record = await hubspotRequest(
    userId,
    "GET",
    `/crm/v3/objects/deals/${id}?properties=dealname,dealstage,closedate,amount,hs_next_step,pipeline`
  );
  const p = (record.properties ?? {}) as Record<string, string | null>;
  const pipeline = p.pipeline || "default";
  const pipelineInfo = await hubspotRequest(userId, "GET", `/crm/v3/pipelines/deals/${encodeURIComponent(pipeline)}`);
  const stages = Array.isArray(pipelineInfo.stages) ? (pipelineInfo.stages as Record<string, unknown>[]) : [];
  const amount = p.amount != null && p.amount !== "" ? Number(p.amount) : null;
  return {
    provider: "hubspot",
    recordId: dealId,
    recordName: p.dealname ?? null,
    recordUrl: null,
    stage: p.dealstage ?? null,
    stageOptions: stages
      .filter((s) => s.archived !== true && typeof s.id === "string")
      .sort((a, b) => Number(a.displayOrder ?? 0) - Number(b.displayOrder ?? 0))
      .map((s) => ({ value: s.id as string, label: typeof s.label === "string" ? s.label : (s.id as string) })),
    closeDate: p.closedate ? p.closedate.slice(0, 10) : null,
    amount: amount !== null && Number.isFinite(amount) ? amount : null,
    nextStep: p.hs_next_step ?? null,
  };
}

async function writeHubspot(userId: string, dealId: string, changes: CrmChanges): Promise<void> {
  const properties: Record<string, string> = {};
  if (changes.stage !== undefined) properties.dealstage = changes.stage;
  // Noon UTC so the date reads the same in any US or European time zone.
  if (changes.closeDate !== undefined) properties.closedate = `${changes.closeDate}T12:00:00.000Z`;
  if (changes.amount !== undefined) properties.amount = String(changes.amount);
  if (changes.nextStep !== undefined) properties.hs_next_step = changes.nextStep;
  await hubspotRequest(userId, "PATCH", `/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, { properties });
}

// ---------------------------------------------------------------------------

export function readCrm(userId: string, provider: CrmProvider, recordId: string): Promise<CrmSnapshot> {
  return provider === "salesforce" ? readSalesforce(userId, recordId) : readHubspot(userId, recordId);
}

export function writeCrm(userId: string, provider: CrmProvider, recordId: string, changes: CrmChanges): Promise<void> {
  return provider === "salesforce" ? writeSalesforce(userId, recordId, changes) : writeHubspot(userId, recordId, changes);
}
