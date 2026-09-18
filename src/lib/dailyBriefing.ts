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

// Was once a day; shortened so the briefing doesn't visibly go stale
// mid-workday (e.g. still showing this morning's news at 4pm) while
// someone's actively using the app — the per-team throttle still
// keeps this from re-searching on every page load. The manual
// "Refresh" button (see the team briefing API route) always bypasses
// this regardless of how recent the last one was.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // refresh at most every 6 hours, per team

// Same reasoning as isResearchStale in companyResearch.ts — kept in a
// plain lib module so the Date.now() read never runs in a component's
// render path.
export function isBriefingStale(updatedAt: Date | null): boolean {
  if (!updatedAt) return true;
  return Date.now() - updatedAt.getTime() > STALE_AFTER_MS;
}

/**
 * A general, team-wide "what's worth knowing today" roundup — not tied to
 * any one deal. Shared across the team and refreshed at most once a day
 * (see isBriefingStale) so every deal's News tab doesn't each pay for its
 * own search. Company-specific news lives separately in companyResearch.ts.
 */
export async function getDailyBriefing(): Promise<string> {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 500,
    system:
      "You brief a B2B salesperson at the start of their day. Use web search to find today's actual top business, market, and technology news — real stories, not generic filler. If search turns up little that's genuinely notable, say so plainly.",
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    messages: [
      {
        role: "user",
        content: `Today is ${today}. Search for today's top business, market, and technology news — the kind of thing worth knowing before a day of sales meetings (market moves, notable funding rounds, major product launches, economic indicators, industry shifts). Reply with a short briefing (4-6 sentences, plain prose, no headers or bullet points, no meta preamble like "Based on the search results") covering the 2-4 most relevant stories. Only state things you found via search.`,
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  return text || "Anchor couldn't find much notable news today.";
}
