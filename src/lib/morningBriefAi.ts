import Anthropic from "@anthropic-ai/sdk";
import { meteredFetch } from "./aiUsage";
import { createWithForcedTool } from "./forcedTool";

// Model calls behind the Morning brief: deciding which emails really need
// a reply (with a one-line summary each), and drafting a reply in the
// person's own voice. Same model and structured-output pattern as the
// other background features.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local");
  }
  return new Anthropic({ apiKey, fetch: meteredFetch("morning_brief") });
}

export type TriageInput = {
  id: number;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  deal: string | null;
  waitingDays: number;
  addressedToMe: boolean;
};
export type TriageResult = { id: number; needsReply: boolean; summary: string; priority: 1 | 2 | 3 };

const TRIAGE_TOOL: Anthropic.Tool = {
  name: "record_triage",
  description: "Record, for each email, whether it needs this person's reply and a one-line summary.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            needsReply: {
              type: "boolean",
              description:
                "True only if a person is clearly waiting on them: a question, a request, a decision, a scheduling ask. False for FYIs, thank-yous, confirmations, automated or marketing mail, and threads they're only copied on with nothing asked of them.",
            },
            summary: {
              type: "string",
              description:
                "What they want, at most 70 characters, without the sender's name (shown separately), e.g. 'wants 50-seat pricing by Monday' or 'asks if Thursday 10am works'.",
            },
            priority: {
              type: "integer",
              enum: [1, 2, 3],
              description: "1 = a customer, a deal contact, or time-sensitive; 2 = a colleague's request; 3 = anything else.",
            },
          },
          required: ["id", "needsReply", "summary", "priority"],
        },
      },
    },
    required: ["items"],
  },
};

export async function triageEmails(personName: string, emails: TriageInput[]): Promise<TriageResult[]> {
  if (emails.length === 0) return [];
  const list = emails
    .map(
      (e) =>
        `[${e.id}] From: ${e.fromName} <${e.fromEmail}>${e.deal ? ` (on deal: ${e.deal})` : ""}${e.addressedToMe ? "" : " (they were copied)"}\nSubject: ${e.subject}\nWaiting: ${e.waitingDays} day(s)\nLatest message: ${e.snippet}`
    )
    .join("\n\n");
  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 2000,
    system:
      "You triage a busy salesperson's inbox for a short morning text. Be strict about what needs a reply, and write summaries a person can read in two seconds.",
    tools: [TRIAGE_TOOL],
    tool_choice: { type: "tool", name: TRIAGE_TOOL.name },
    messages: [{ role: "user", content: `These are ${personName}'s unanswered emails. Triage every one.\n\n${list}` }],
  });
  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("The model didn't return a triage.");
  const items = (toolUse.input as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const ids = new Set(emails.map((e) => e.id));
  return items
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const id = Number(r.id);
      const priority = r.priority === 1 || r.priority === 2 || r.priority === 3 ? r.priority : 3;
      return {
        id,
        needsReply: r.needsReply === true,
        summary: typeof r.summary === "string" ? r.summary.trim().slice(0, 90) : "",
        priority: priority as 1 | 2 | 3,
      };
    })
    .filter((r) => ids.has(r.id));
}

const REPLY_TOOL: Anthropic.Tool = {
  name: "record_reply",
  description: "Record how to handle the email and a draft reply to it.",
  input_schema: {
    type: "object",
    properties: {
      approach: {
        type: "string",
        description:
          "How to handle this one in their situation, in one line of at most 110 characters, leading with the move — e.g. 'They want 20% off: hold at the 10% you can give and offer annual billing instead' or 'Confirm Thursday and send the security pack they asked for last call'.",
      },
      body: {
        type: "string",
        description:
          "Plain-text reply body, professional and warm, ready to send: a short greeting by first name, 2-5 sentences that answer exactly what they asked (using the real facts given) and move the deal forward with a clear next step, and a sign-off with the sender's first name. Never invent prices, dates, features, commitments or facts that aren't given; where something must come from the sender, leave a clear [placeholder]. Never agree to anything the deal's decision boundaries say the sender can't decide — say you'll confirm and come back instead.",
      },
    },
    required: ["approach", "body"],
  },
};

export type DraftedReply = { body: string; approach: string };

export async function draftReply(params: {
  senderName: string;
  style: string | null;
  fromName: string;
  subject: string;
  messageText: string;
  dealContext: string | null;
  // Replies they really sent (newest first), to match how they write.
  examples?: { to: string; subject: string; text: string }[];
  // Anchor's earlier suggestions next to what they actually sent instead.
  corrections?: { suggested: string; sent: string }[];
}): Promise<DraftedReply> {
  const examples = (params.examples ?? []).slice(0, 4);
  const corrections = (params.corrections ?? []).slice(0, 4);
  const learned = [
    examples.length
      ? `How ${params.senderName} actually writes replies — real emails they sent. Match their greeting, length, tone, formality, phrasing and sign-off closely; write as they would, not as a generic assistant:\n${examples
          .map((e, i) => `--- Example ${i + 1} (to ${e.to}, "${e.subject}")\n${e.text}`)
          .join("\n")}`
      : "",
    corrections.length
      ? `Earlier replies Anchor suggested and what ${params.senderName} actually sent instead. Learn from what they changed — what they cut, added, softened or made firmer — and write this one the way they would have sent it:\n${corrections
          .map((c, i) => `--- ${i + 1}. Anchor suggested:\n${c.suggested}\n--- They sent:\n${c.sent}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 1000,
    system: `You draft email replies in ${params.senderName}'s own voice for them to review and send — replies a seasoned, professional account executive would be glad to send as-is: specific to this customer and deal, concise, courteous, never pushy, never generic.${
      params.style ? ` How they write and negotiate: ${params.style}` : ""
    }`,
    tools: [REPLY_TOOL],
    tool_choice: { type: "tool", name: REPLY_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Draft ${params.senderName}'s reply to ${params.fromName}.\n\nSubject: ${params.subject}\n\nTheir message:\n${params.messageText}${
          params.dealContext ? `\n\nWhat Anchor knows about this deal and customer:\n${params.dealContext}` : ""
        }${learned ? `\n\n${learned}` : ""}`,
      },
    ],
  });
  const toolUse = message.content.find((b) => b.type === "tool_use");
  const input = toolUse && toolUse.type === "tool_use" ? (toolUse.input as { body?: unknown; approach?: unknown }) : null;
  const body = input?.body;
  if (typeof body !== "string" || !body.trim()) throw new Error("The model returned an empty reply.");
  const approach = typeof input?.approach === "string" ? input.approach.trim().slice(0, 160) : "";
  return { body: body.trim(), approach };
}
