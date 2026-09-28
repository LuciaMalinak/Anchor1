import Anthropic from "@anthropic-ai/sdk";

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

// Generous, but pasted profile text (About + Experience + a headline) is
// realistically a few thousand characters — this is just a guard against
// someone pasting in an entire multi-page document by mistake.
export const MAX_PASTE_LENGTH = 20000;

const EXTRACT_TOOL = {
  name: "record_linkedin_profile",
  description:
    "Record structured facts pulled from text a salesperson pasted in from someone's LinkedIn profile page.",
  input_schema: {
    type: "object" as const,
    properties: {
      company: {
        type: "string",
        description: "Their current employer/company name, exactly as stated. Empty string if not clearly stated.",
      },
      role: {
        type: "string",
        description: "Their current job title, exactly as stated. Empty string if not clearly stated.",
      },
      summary: {
        type: "string",
        description:
          "A short (2-4 sentence) plain-prose professional summary useful for a B2B salesperson preparing to meet this person — background, current focus, anything relevant to the relationship. Blend in any prior context given rather than dropping it. Never invent anything not present in the pasted text or prior context.",
      },
    },
    required: ["company", "role", "summary"],
  },
};

export type LinkedInExtraction = { company: string | null; role: string | null; summary: string };

// Deliberately NOT an automated LinkedIn API pull — see the comment on
// contacts.linkedinUrl in schema.ts for why. This only ever runs on text a
// person copy/pasted themselves, which keeps it clear of LinkedIn's terms
// around automated access to member data.
export async function extractLinkedInProfile(params: {
  contactName: string;
  pastedText: string;
  priorSummary?: string | null;
}): Promise<LinkedInExtraction> {
  const text = params.pastedText.slice(0, MAX_PASTE_LENGTH);
  const priorBlock = params.priorSummary?.trim()
    ? `\n\nWhat Anchor already knows about them from past meetings — keep anything from this that's still relevant, don't drop it just because it's not repeated in the pasted text:\n${params.priorSummary.trim()}`
    : "";

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 500,
    system:
      "You extract structured facts from text a salesperson pasted in from someone's LinkedIn profile page. Only use what's actually in the pasted text or given prior context — never invent a company, title, or detail that isn't there. Do your best even if the pasted text is messy or only partial.",
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Contact: ${params.contactName}\n\nPasted LinkedIn profile text:\n${text}${priorBlock}\n\nExtract their current company and job title, and write the summary described.`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Couldn't pull anything structured out of that text — try pasting more of the profile.");
  }

  const input = toolUse.input as { company?: string; role?: string; summary?: string };
  return {
    company: input.company?.trim() || null,
    role: input.role?.trim() || null,
    summary: input.summary?.trim() || "",
  };
}
