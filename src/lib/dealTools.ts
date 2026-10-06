import Anthropic from "@anthropic-ai/sdk";
import { meteredFetch } from "./aiUsage";
import { createWithForcedTool } from "./forcedTool";

// Model calls behind the deal tools: the "Draft a nudge" email for a
// deal going quiet, the pre-call brief, and the CRM update proposal after
// a call. Same model and structured-output pattern as summarize.ts.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local"
    );
  }
  return new Anthropic({ apiKey, fetch: meteredFetch("deal_tools") });
}

async function callTool<T>(params: {
  system: string;
  prompt: string;
  tool: Anthropic.Tool;
  maxTokens: number;
}): Promise<T> {
  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: params.maxTokens,
    system: params.system,
    tools: [params.tool],
    tool_choice: { type: "tool", name: params.tool.name },
    messages: [{ role: "user", content: params.prompt }],
  });
  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("The model didn't return a structured answer.");
  }
  return toolUse.input as T;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
}

// ---------------------------------------------------------------------------
// Draft a nudge — a short, specific check-in for a deal that's gone quiet.

export type NudgeDraft = { subject: string; body: string };

const NUDGE_TOOL: Anthropic.Tool = {
  name: "record_nudge_email",
  description: "Record a short check-in email to restart a deal that has gone quiet.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Short, specific subject line that refers to something real from the deal." },
      body: {
        type: "string",
        description:
          "Plain-text email body: greeting, 2-4 short sentences, sign-off with the sender's first name. Refer to the last real conversation or an open item, offer one concrete next step. No guilt-tripping, no 'just checking in', no invented facts.",
      },
    },
    required: ["subject", "body"],
  },
};

export async function draftNudgeEmail(params: {
  dealName: string;
  daysQuiet: number;
  senderName: string;
  recipientName: string | null;
  context: string;
}): Promise<NudgeDraft> {
  const out = await callTool<{ subject?: unknown; body?: unknown }>({
    system:
      "You write short, warm, specific follow-up emails that restart stalled business conversations, in the sender's own voice. Use only the facts you're given; never invent commitments, prices or dates.",
    prompt: `${params.senderName} hasn't heard from ${params.recipientName ?? "the other side"} on "${params.dealName}" in ${params.daysQuiet} days. Write the nudge email.\n\nWhat Anchor knows about this deal:\n${params.context}`,
    tool: NUDGE_TOOL,
    maxTokens: 600,
  });
  const draft = { subject: str(out.subject, 200), body: str(out.body, 5000) };
  if (!draft.subject || !draft.body) throw new Error("The model returned an empty email.");
  return draft;
}

// ---------------------------------------------------------------------------
// Pre-call brief — what to know walking into the next call on a deal.

export type PreCallBrief = {
  summary: string;
  people: { name: string; note: string }[];
  openItems: string[];
  questions: string[];
  watchOut: string[];
};

const BRIEF_TOOL: Anthropic.Tool = {
  name: "record_pre_call_brief",
  description: "Record a short brief to read before the next call on a deal.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "2-3 sentences: where the deal stands and what this next call needs to achieve." },
      people: {
        type: "array",
        description: "Up to 5 people likely to matter on the call, with one line each on their role and what they care about.",
        items: {
          type: "object",
          properties: { name: { type: "string" }, note: { type: "string" } },
          required: ["name", "note"],
        },
      },
      openItems: { type: "array", items: { type: "string" }, description: "Promises and action items still open on either side (up to 6)." },
      questions: { type: "array", items: { type: "string" }, description: "3-5 specific questions worth asking on this call." },
      watchOut: { type: "array", items: { type: "string" }, description: "Risks, objections or sensitivities to be ready for (up to 4). Empty if none." },
    },
    required: ["summary", "people", "openItems", "questions", "watchOut"],
  },
};

export async function writePreCallBrief(params: { dealName: string; context: string }): Promise<PreCallBrief> {
  const out = await callTool<Record<string, unknown>>({
    system:
      "You prepare busy salespeople and account managers for their next call. Be specific and brief. Use only the facts you're given; if something isn't known, leave it out rather than guessing.",
    prompt: `Write the pre-call brief for the next call on "${params.dealName}".\n\nWhat Anchor knows:\n${params.context}`,
    tool: BRIEF_TOOL,
    maxTokens: 1200,
  });
  const people = Array.isArray(out.people)
    ? out.people
        .map((p) => (p && typeof p === "object" ? { name: str((p as { name?: unknown }).name, 80), note: str((p as { note?: unknown }).note, 240) } : null))
        .filter((p): p is { name: string; note: string } => Boolean(p?.name))
        .slice(0, 5)
    : [];
  const brief: PreCallBrief = {
    summary: str(out.summary, 800),
    people,
    openItems: strList(out.openItems, 6, 240),
    questions: strList(out.questions, 5, 240),
    watchOut: strList(out.watchOut, 4, 240),
  };
  if (!brief.summary) throw new Error("The model returned an empty brief.");
  return brief;
}

// ---------------------------------------------------------------------------
// CRM update proposal — which deal fields a call changed. The caller
// validates every value again before anything is written.

export type CrmProposal = {
  stage: { value: string; reason: string } | null;
  closeDate: { value: string; reason: string } | null;
  amount: { value: number; reason: string } | null;
  nextStep: { value: string; reason: string } | null;
};

const CRM_TOOL: Anthropic.Tool = {
  name: "record_crm_update",
  description:
    "Record the CRM field changes this call justifies. Leave out any field the call gives no clear reason to change.",
  input_schema: {
    type: "object",
    properties: {
      stage: {
        type: "object",
        description: "New stage, only if the call clearly moved the deal. Must be exactly one of the allowed stages.",
        properties: { value: { type: "string" }, reason: { type: "string" } },
        required: ["value", "reason"],
      },
      closeDate: {
        type: "object",
        description: "New expected close date (YYYY-MM-DD), only if a timeline was discussed.",
        properties: { value: { type: "string" }, reason: { type: "string" } },
        required: ["value", "reason"],
      },
      amount: {
        type: "object",
        description: "New deal amount (a number, no currency symbol), only if a size or price was agreed or clearly stated.",
        properties: { value: { type: "number" }, reason: { type: "string" } },
        required: ["value", "reason"],
      },
      nextStep: {
        type: "object",
        description: "The concrete next step agreed in the call, under 200 characters.",
        properties: { value: { type: "string" }, reason: { type: "string" } },
        required: ["value", "reason"],
      },
    },
    required: [],
  },
};

// "2026-02-31" parses in JavaScript (it rolls over), so require a round trip.
function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function field<T>(v: unknown, parse: (x: unknown) => T | null): { value: T; reason: string } | null {
  if (!v || typeof v !== "object") return null;
  const value = parse((v as { value?: unknown }).value);
  if (value === null) return null;
  return { value, reason: str((v as { reason?: unknown }).reason, 300) };
}

export async function proposeCrmUpdate(params: {
  crmName: string;
  allowedStages: string[];
  current: { stage: string | null; closeDate: string | null; amount: number | null; nextStep: string | null };
  meetingDate: string;
  context: string;
}): Promise<CrmProposal> {
  const out = await callTool<Record<string, unknown>>({
    system:
      "You keep a sales CRM accurate after each call. Only propose a change when the call clearly supports it, and give the reason in a few words, quoting the call where you can. Never invent amounts or dates.",
    prompt: `The call happened on ${params.meetingDate}. Current ${params.crmName} values:\n- Stage: ${params.current.stage ?? "(empty)"}\n- Close date: ${params.current.closeDate ?? "(empty)"}\n- Amount: ${params.current.amount ?? "(empty)"}\n- Next step: ${params.current.nextStep ?? "(empty)"}\n\nAllowed stages (use the exact text): ${params.allowedStages.join(" | ") || "(none — leave stage null)"}\n\nThe call:\n${params.context}`,
    tool: CRM_TOOL,
    maxTokens: 800,
  });
  const stages = new Set(params.allowedStages);
  return {
    stage: field(out.stage, (x) => (typeof x === "string" && stages.has(x.trim()) && x.trim() !== params.current.stage ? x.trim() : null)),
    closeDate: field(out.closeDate, (x) => (isRealDate(x) && x !== params.current.closeDate ? x : null)),
    amount: field(out.amount, (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x !== params.current.amount ? Math.round(x * 100) / 100 : null)),
    nextStep: field(out.nextStep, (x) => (typeof x === "string" && x.trim() && x.trim() !== params.current.nextStep ? x.trim().slice(0, 255) : null)),
  };
}
