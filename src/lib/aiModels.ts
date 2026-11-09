// Which Claude model Anchor runs on. Everything defaults to Claude Haiku
// 5.5, the lowest-cost current model ($0.10 / $0.50 per million input /
// output tokens for prompts up to 100K tokens), which supports everything
// Anchor uses: structured (tool) output, web search and long context.
//
// ANTHROPIC_MODEL in Render overrides it for summaries, memory, briefs,
// reports and the rest; leave it unset to stay on the default. Live calls
// and Ask Anchor have their own overrides (ANTHROPIC_LIVE_MODEL,
// ANTHROPIC_ASK_MODEL, in liveCoaching.ts and liveAssist.ts).
export const DEFAULT_MODEL = "claude-haiku-5-5";

export const MAIN_MODEL = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
