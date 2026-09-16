import Anthropic from "@anthropic-ai/sdk";

// Centralized so it's a one-line change if this needs to point at a
// different model later.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local"
    );
  }
  return new Anthropic({ apiKey });
}

/**
 * Looks up public information about a COMPANY — never a named individual.
 * Uses Claude's native web search tool to ground the answer in real,
 * current sources instead of guessing from training data.
 *
 * Scope is deliberately limited to the business itself (what they do,
 * industry, size/stage, recent public news). Anchor does not use this,
 * or anything like it, to research specific people — that's a line kept
 * across the app regardless of how the lookup would be framed.
 */
export async function researchCompany(params: {
  companyName: string;
  companyWebsite?: string | null;
}): Promise<string> {
  const query = params.companyWebsite
    ? `${params.companyName} (${params.companyWebsite})`
    : params.companyName;

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 700,
    system:
      "You research companies for a salesperson prepping for a meeting. Use web search to find current, factual public information about the company only — never about specific employees or individuals. If search turns up little, say so plainly instead of guessing or padding with generic filler.",
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    messages: [
      {
        role: "user",
        content: `Research the company "${query}". Write a short factual briefing (4-6 sentences, plain prose, no headers or bullet points, no meta preamble like "Based on the search results") covering: what they do, their industry/sector, approximate size or stage if it's publicly known, and any notable recent public news (funding rounds, product launches, leadership changes) from roughly the last year. Start directly with the company name. Only state things you found via search.`,
      },
    ],
  });

  // Citations get returned as separate text blocks interleaved with the
  // surrounding sentence, so joining with "" (not a newline) and
  // collapsing whitespace keeps the result reading as one paragraph.
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  return text || "Anchor couldn't find much public information about this company.";
}
