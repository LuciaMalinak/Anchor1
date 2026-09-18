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

export type TickerDirection = "up" | "down" | "flat";
export type TickerItem = { text: string; direction: TickerDirection };

// Older deploys stored this column as a plain string[] (see git history
// on this file) — a team's cached row can still be in that shape for up
// to STALE_AFTER_MS after this change goes live, until the next
// background refresh overwrites it. Reading code should always go
// through this rather than trusting the DB value's shape directly.
export function normalizeTickerItems(raw: unknown): TickerItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): TickerItem | null => {
      if (typeof item === "string") {
        const text = item.trim();
        return text ? { text, direction: "flat" } : null;
      }
      if (item && typeof item === "object" && "text" in item) {
        const text = String((item as { text: unknown }).text || "").trim();
        if (!text) return null;
        const direction = (item as { direction?: unknown }).direction;
        const safeDirection: TickerDirection =
          direction === "up" || direction === "down" ? direction : "flat";
        return { text, direction: safeDirection };
      }
      return null;
    })
    .filter((item): item is TickerItem => item !== null);
}

// What each vertical's ticker should actually be about — a finance team
// wants index levels and rate moves, a hospitality team doesn't. No
// entry for "tech" is missing anything special; it's just a normal
// industry read like the rest, not a stand-in default. Finance is
// written to explicitly pull named tickers/indices with an actual price
// or % move, since that's the "stock ticker" feel a finance team expects
// from this widget — the others ask for the equivalent concrete number
// for their world instead of forcing a stock quote where none applies.
const INDUSTRY_FOCUS: Record<IndustryKey, string> = {
  finance:
    "major stock indices (S&P 500, Dow, Nasdaq) with their current level and % move, notable individual stocks or earnings movers with their price and % change, interest rate and Fed/central bank news, currency and bond market moves (e.g. the 10-year Treasury yield)",
  real_estate: "mortgage rate moves, housing market data (prices, inventory, sales volume), and notable commercial or residential real estate news",
  healthcare: "health policy and regulatory news, notable FDA actions, healthcare M&A, and insurance/payer news",
  hospitality: "travel and tourism demand trends, notable hotel/airline/booking-platform news, and consumer spending data relevant to travel",
  pharma: "FDA approvals and rejections, clinical trial results, pharma M&A and licensing deals, and drug pricing news",
  tech: "tech stock moves (with price and % change), notable product launches, AI industry news, and tech M&A/funding news",
};

const DEFAULT_FOCUS =
  "major stock market indices and moves, notable business headlines, and economic indicators";

const STRUCTURE_TOOL = {
  name: "record_ticker_items",
  description:
    "Format a raw list of news items into a structured live ticker feed for a B2B sales team.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description:
                "The ticker line itself, kept as concrete and short as the source item — numbers, tickers, and % moves stay in (e.g. 'S&P 500 6,481 -0.18%', 'AAPL $228.14 +1.24%', 'Existing home sales -2.1% in August').",
            },
            direction: {
              type: "string",
              enum: ["up", "down", "flat"],
              description:
                "'up' if the item describes a gain, increase, or positive move (a stock/index up, rates cut, sales rising); 'down' for a loss, decrease, or negative move; 'flat' if there's no clear directional number (an FDA approval, an M&A deal, a product launch) or the move is roughly flat.",
            },
          },
          required: ["text", "direction"],
        },
      },
    },
    required: ["items"],
  },
};

/**
 * A fast-refreshing, ticker-style feed of short market/industry headlines
 * — the ambient "ticker running along the top" companion to
 * dailyBriefing's longer daily roundup. industry null/unrecognized falls
 * back to general market news rather than failing.
 *
 * Two-pass: first a search turn (web_search can't be combined with a
 * forced tool_choice — the model would call the tool immediately instead
 * of searching first, same reasoning as companyResearch.ts's
 * HEADLINE:/BRIEFING: format), then a second, non-search turn that
 * structures the raw list into {text, direction} via a forced tool call
 * — this is what lets the widget render a real up/down indicator next to
 * each line instead of guessing from the sentence.
 */
export async function getIndustryTicker(industry: IndustryKey | null): Promise<TickerItem[]> {
  const focus = (industry && INDUSTRY_FOCUS[industry]) || DEFAULT_FOCUS;

  const searchMessage = await client().messages.create({
    model: MODEL,
    max_tokens: 500,
    system:
      "You produce a live news ticker for a B2B sales team. Use web search to find today's actual, current facts and figures — real numbers and named events, never generic filler or invented figures. If search turns up little, return fewer items rather than padding.",
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    messages: [
      {
        role: "user",
        content: `Search for today's current news on: ${focus}.

Then reply with ONLY a plain list, one short item per line, each starting with "- ". 6-10 items, each under ~14 words, each a specific concrete fact or figure from search (a number, a move, a named event) — written like ticker headlines, not full sentences. Wherever the source gives an exact price or % change, keep it in the item. No preamble, no markdown, no headers, nothing before or after the list.`,
      },
    ],
  });

  const raw = searchMessage.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const rawItems = raw
    .split("\n")
    .map((line) => line.replace(/^[-•\s]+/, "").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .slice(0, 10);

  if (rawItems.length === 0) return [];

  const structureMessage = await client().messages.create({
    model: MODEL,
    max_tokens: 600,
    system:
      "You format raw news items into a structured ticker feed. Never invent numbers or change the meaning of an item — only classify and lightly tighten the wording of what's given.",
    tools: [STRUCTURE_TOOL],
    tool_choice: { type: "tool", name: STRUCTURE_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Raw items:\n${rawItems.map((item) => `- ${item}`).join("\n")}`,
      },
    ],
  });

  const toolUse = structureMessage.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    // Structuring is a nice-to-have on top of already-good raw items —
    // fall back to them as flat/neutral rather than losing the refresh.
    return rawItems.map((text) => ({ text, direction: "flat" as const }));
  }

  const items = (toolUse.input as { items?: unknown }).items;
  return normalizeTickerItems(items).slice(0, 10);
}
