// Validation for after-call CRM updates (see crmWrite.ts). Kept free of
// database imports so scripts/test-next-steps.ts can run it.
export type CrmProvider = "salesforce" | "hubspot";

export type CrmSnapshot = {
  provider: CrmProvider;
  recordId: string;
  recordName: string | null;
  recordUrl: string | null;
  stage: string | null; // the CRM's stage value (Salesforce picklist value / HubSpot stage id)
  stageOptions: { value: string; label: string }[];
  closeDate: string | null; // YYYY-MM-DD
  amount: number | null;
  nextStep: string | null;
};

export type CrmChanges = {
  stage?: string;
  closeDate?: string;
  amount?: number;
  nextStep?: string;
};

// "2026-02-31" parses in JavaScript (it rolls over to March), so check
// the date survives a round trip unchanged.
export function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Checks every requested change against the record as it is right now
// (stage must be one of its current options, dates real, amount sane,
// next step within Salesforce's 255 characters) and drops no-ops.
export function validateChanges(snapshot: CrmSnapshot, raw: unknown): CrmChanges | string {
  if (!raw || typeof raw !== "object") return "Nothing to update.";
  const r = raw as Record<string, unknown>;
  const out: CrmChanges = {};
  if (r.stage !== undefined) {
    if (typeof r.stage !== "string" || !snapshot.stageOptions.some((o) => o.value === r.stage)) {
      return "That stage isn't one of this record's stages.";
    }
    if (r.stage !== snapshot.stage) out.stage = r.stage;
  }
  if (r.closeDate !== undefined) {
    if (!isRealDate(r.closeDate)) {
      return "Close date must be a real date.";
    }
    if (r.closeDate !== snapshot.closeDate) out.closeDate = r.closeDate;
  }
  if (r.amount !== undefined) {
    if (typeof r.amount !== "number" || !Number.isFinite(r.amount) || r.amount < 0 || r.amount > 1e12) {
      return "Amount must be a positive number.";
    }
    const amount = Math.round(r.amount * 100) / 100;
    if (amount !== snapshot.amount) out.amount = amount;
  }
  if (r.nextStep !== undefined) {
    if (typeof r.nextStep !== "string" || !r.nextStep.trim()) return "Next step can't be empty.";
    const nextStep = r.nextStep.trim().slice(0, 255);
    if (nextStep !== snapshot.nextStep) out.nextStep = nextStep;
  }
  return Object.keys(out).length ? out : "Nothing changed.";
}

