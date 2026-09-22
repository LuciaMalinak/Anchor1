// Turns the raw emails fetched for a deal (see integrations/gmail.ts) into
// a short, structured digest instead of just concatenating subjects and
// bodies verbatim. This is what "smart extraction" means here: a promise
// made in an email thread three weeks ago, a number someone quoted, a
// question that's still open — pulled out explicitly so every surface that
// reads deal.emailContext (live coaching, Ask Anchor, handoff briefings,
// and now meeting summaries/deal memory — see dealIntegrationContext.ts,
// summarize.ts) gets the substance instead of having to re-read a wall of
// raw email text on every single use.
//
// Same pattern as mergeDealMemory/mergeContactMemory in summarize.ts:
// Anthropic tool-use with a structured input_schema, never invent details
// not actually present in the source material.
import Anthropic from "@anthropic-ai/sdk";
import type { EmailContextItem } from "./integrations/gmail";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local"
    );
  }
  return new Anthropic({ apiKey });
}

// Caps how many raw characters of email go into the prompt — MAX_EMAILS (12)
// x MAX_BODY_CHARS (3000) in gmail.ts is already bounded, but this is a
// second belt-and-suspenders cap in case that ever changes upstream.
const MAX_PROMPT_CHARS = 40000;

export type DealEmailDigest = {
  summary: string;
  commitments: string[];
  keyFacts: string[];
  openQuestions: string[];
};

const EMAIL_DIGEST_TOOL = {
  name: "record_deal_email_digest",
  description:
    "Record a structured digest of what's actually been said in email with a deal's contacts.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "2-4 sentence plain-language summary of what this email thread history is about and where things stand.",
      },
      commitments: {
        type: "array",
        items: { type: "string" },
        description:
          "Concrete commitments either side made — 'we'll send pricing by Friday', 'they agreed to a pilot starting in March'. Include who committed to what, if clear. Empty array if none.",
      },
      keyFacts: {
        type: "array",
        items: { type: "string" },
        description:
          "Concrete facts mentioned that matter to this deal — a number, a date, a requirement, a name of someone else involved, a budget figure, a technical constraint. Empty array if none.",
      },
      openQuestions: {
        type: "array",
        items: { type: "string" },
        description:
          "Questions raised in the emails that don't appear to have been answered yet, based only on what's in this thread history. Empty array if none.",
      },
    },
    required: ["summary", "commitments", "keyFacts", "openQuestions"],
  },
};

// Renders a digest into the same flat-string shape the rest of the app
// already expects from deals.emailContext (a plain text column consumed
// verbatim by liveAssist.ts, liveCoaching.ts, and handoffBriefing.ts) — so
// upgrading extraction quality here doesn't require touching any of those
// three call sites at all.
export function formatDealEmailDigest(digest: DealEmailDigest): string {
  const parts = [digest.summary.trim()];
  if (digest.commitments.length) {
    parts.push(`Commitments made:\n${digest.commitments.map((c) => `- ${c}`).join("\n")}`);
  }
  if (digest.keyFacts.length) {
    parts.push(`Key facts:\n${digest.keyFacts.map((f) => `- ${f}`).join("\n")}`);
  }
  if (digest.openQuestions.length) {
    parts.push(`Still open:\n${digest.openQuestions.map((q) => `- ${q}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

// Best-effort: returns null on any failure so callers (dealIntegrationContext.ts)
// can fall back to a plain flat join rather than losing email context entirely.
export async function extractDealEmailDigest(
  dealName: string,
  emails: EmailContextItem[]
): Promise<DealEmailDigest | null> {
  if (emails.length === 0) return null;

  let emailsText = emails
    .map((e) => `From: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\n\n${e.body}`)
    .join("\n\n---\n\n");
  if (emailsText.length > MAX_PROMPT_CHARS) {
    emailsText = emailsText.slice(0, MAX_PROMPT_CHARS);
  }

  try {
    const message = await client().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system:
        "You extract concrete, factual detail from real business email threads for a sales/deal team. Never invent commitments, facts, or questions that aren't actually present in the emails. If the emails are mostly scheduling logistics or small talk with little substance, keep commitments/keyFacts/openQuestions short or empty rather than padding them out.",
      tools: [EMAIL_DIGEST_TOOL],
      tool_choice: { type: "tool", name: EMAIL_DIGEST_TOOL.name },
      messages: [
        {
          role: "user",
          content: `Deal: ${dealName}\n\nEmail thread history with this deal's contacts, most relevant first:\n\n${emailsText}`,
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    return toolUse.input as DealEmailDigest;
  } catch (err) {
    console.error(`[dealEmailDigest] extraction failed for deal "${dealName}":`, err);
    return null;
  }
}
