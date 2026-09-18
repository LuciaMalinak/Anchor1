import Anthropic from "@anthropic-ai/sdk";
import type { IndustryKey } from "./industries";

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

// Much shorter than dailyBriefing's 6 hours — this is the "small window
// that updates nonstop" ticker, so it needs to actually feel live rather
// than a once-a-shift roundup. 20 minutes is frequent enough to catch
// same-day market moves without re-searching on every one of the (much
// more frequent) client-side polls that read this — see the ticker API
// route, which only ever triggers a rebuild, never blocks on one.
const STALE_AFTER_MS = 20 * 60 * 1000;

export function isTickerStale(updatedAt: Date | null): boolean {
  if (!updatedAt) return true;
  return Date.now() - updatedAt.getTime() > STALE_AFTER_MS;
}

// What each vertical's ticker should actually be about — a finance team
// wants index levels and rate moves, a hospitality team doesn't. No
// entry for "tech" is missing anything special; it's just a normal
// industry read like the rest, not a stand-in default.
const INDUSTRY_FOCUS: Record<IndustryKey, string> = {
  finance: "major stock market indices and notable moves, interest rates and Fed/central bank news, currency and bond market moves, and notable individual stock or earnings news",
  real_estate: "mortgage rate moves, housing market data (prices, inventory, sales volume), and notable commercial or residential real estate news",
  healthcare: "health policy and regulatory news, notable FDA actions, healthcare M&A, and insurance/payer news",
  hospitality: "travel and tourism demand trends, notable hotel/airline/booking-platform news, and consumer spending data relevant to travel",
  pharma: "FDA approvals and rejections, clinical trial results, pharma M&A and licensing deals, and drug pricing news",
  tech: "tech stock moves, notable product launches, AI industry news, and tech M&A/funding news",
};

const DEFAULT_FOCUS =
  "major stock market indices and moves, notable business headlines, and economic indicators";

/**
 * A fast-refreshing, ticker-style feed of short market/industry headlines
 * — the ambient "ticker running along the top" companion to
 * dailyBriefing's longer daily roundup. industry null/unrecognized falls
 * back to general market news rather than failing.
 *
 * Asks for a plain "- item" list rather than forcing a tool call: the
 * model needs to actually search first (a server-side tool call/response
 * round trip) before it has real numbers to report, and forcing tool_choice
 * to a custom tool from the first turn would skip that search entirely —
 * same reasoning as companyResearch.ts's HEADLINE:/BRIEFING: format.
 */
export async function getIndustryTicker(industry: IndustryKey | null): Promise<string[]> {
  const focus = (industry && INDUSTRY_FOCUS[industry]) || DEFAULT_FOCUS;

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 500,
    system:
      "You produce a live news ticker for a B2B sales team. Use web search to find today's actual, current facts and figures — real numbers and named events, never generic filler or invented figures. If search turns up little, return fewer items rather than padding.",
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    messages: [
      {
        role: "user",
        content: `Search for today's current news on: ${focus}.

Then reply with ONLY a plain list, one short item per line, each starting with "- ". 6-10 items, each under ~14 words, each a specific concrete fact or figure from search (a number, a move, a named event) — written like ticker headlines, not full sentences. No preamble, no markdown, no headers, nothing before or after the list.`,
      },
    ],
  });

  // Same "join text blocks, then collapse whitespace" citation handling
  // as the other search-backed features, but line-by-line since this is
  // a list rather than one flowing paragraph.
  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return raw
    .split("\n")
    .map((line) => line.replace(/^[-•\s]+/, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .slice(0, 10);
}
