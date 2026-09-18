import Anthropic from "@anthropic-ai/sdk";

// Centralized so it's a one-line change if this needs to point at a
// different model later.
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

// Was once a day — shortened for the same reason as dailyBriefing.ts's
// STALE_AFTER_MS: this is a per-deal company-news lookup, so it's worth
// it being noticeably more current during an active workday, not just
// once every 24 hours.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // refresh at most every 6 hours

// Kept in a plain lib module (rather than inline in a page component) so
// the Date.now() read doesn't run inside a component's render path.
export function isResearchStale(updatedAt: Date | null): boolean {
  if (!updatedAt) return true;
  return Date.now() - updatedAt.getTime() > STALE_AFTER_MS;
}

export type CompanyResearchResult = {
  briefing: string;
  // A one-line headline for the single most notable thing that happened
  // in roughly the last 30 days, if there is one — drives the small
  // "News" callout on the deal page. Null when nothing that fresh turned up.
  newsHeadline: string | null;
};

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
}): Promise<CompanyResearchResult> {
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
        content: `Research the company "${query}" using web search, then reply in exactly this format (plain text, no markdown):

HEADLINE: <a single-sentence headline for the single most notable public news about this company from roughly the last 30 days — a launch, funding round, leadership change, major press. Write NONE if nothing that recent and notable turned up.>
BRIEFING: <a factual briefing, 4-6 sentences, plain prose, no headers or bullet points, no meta preamble like "Based on the search results" — start directly with the company name — covering what they do, their industry/sector, approximate size or stage if publicly known, and notable public news from roughly the last year.>

Only state things you found via search.`,
      },
    ],
  });

  // Citations get returned as separate text blocks interleaved with the
  // surrounding sentence, so joining with "" (not a newline) and
  // collapsing whitespace keeps the result reading as one paragraph.
  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();

  // Defensive parsing — a model reply isn't guaranteed to hit the exact
  // format even when asked for it, so fall back gracefully rather than
  // throwing (same lesson learned building Insights: never trust
  // "structured" model output blindly).
  const headlineMatch = raw.match(/HEADLINE:\s*(.*?)(?:\n|$)/i);
  const briefingMatch = raw.match(/BRIEFING:\s*([\s\S]*)/i);

  const headlineRaw = headlineMatch?.[1]?.trim() || null;
  const newsHeadline = !headlineRaw || /^none\.?$/i.test(headlineRaw) ? null : headlineRaw;

  const briefing = (briefingMatch?.[1]?.trim() || raw.replace(/^HEADLINE:.*$/im, "").trim()).replace(
    /\s+/g,
    " "
  );

  return {
    briefing: briefing || "Anchor couldn't find much public information about this company.",
    newsHeadline,
  };
}
