// The widgets a live meeting's focus-mode window (src/app/focus/[meetingId])
// can show, and which ones show by default. The whole point of focus mode
// is trimming a live call down to "the important info and only the tools
// you need" (as opposed to the full deal page, which also has files, team
// chat, the news sidebar, etc.) — so the default set deliberately leans
// toward the AI's own synthesis (coaching nudges, key facts) rather than
// raw material like the live transcript, which someone can still turn on
// from the window's own "Customize" panel if they want it.
export const FOCUS_WIDGETS = [
  {
    key: "coaching",
    label: "Live coaching",
    description: "Talking-point nudges and the checklist of what this call should cover.",
  },
  {
    key: "askAnchor",
    label: "Ask Anchor",
    description: "A quick-question box grounded in this deal's history.",
  },
  {
    key: "keyFacts",
    label: "Key facts",
    description: "Stage, primary contact, and what a stand-in is allowed to decide on their own.",
  },
  {
    key: "transcript",
    label: "Live transcript",
    description: "The raw word-for-word feed, if you want it alongside the coaching above.",
  },
] as const;

export type FocusWidgetKey = (typeof FOCUS_WIDGETS)[number]["key"];

// Transcript is off by default — it's the one widget here that's raw
// material rather than something Anchor has already boiled down, and the
// whole ask behind focus mode was showing less, not everything.
export const DEFAULT_FOCUS_WIDGETS: FocusWidgetKey[] = ["coaching", "askAnchor", "keyFacts"];

const VALID_KEYS = new Set<string>(FOCUS_WIDGETS.map((w) => w.key));

export function isFocusWidgetKey(value: string): value is FocusWidgetKey {
  return VALID_KEYS.has(value);
}

// Turns whatever's saved (possibly null, possibly stale) into a valid,
// de-duplicated widget list — unlike resolveDashboardOrder in
// dashboardSections.ts, a missing widget here just means "off," not
// "append it at the end," since showing more than someone chose would
// defeat the point of a focus window.
export function resolveFocusWidgets(saved: unknown): FocusWidgetKey[] {
  if (!Array.isArray(saved)) return DEFAULT_FOCUS_WIDGETS;
  const seen = new Set<FocusWidgetKey>();
  for (const k of saved) {
    if (typeof k === "string" && isFocusWidgetKey(k)) seen.add(k);
  }
  return seen.size > 0 ? [...seen] : DEFAULT_FOCUS_WIDGETS;
}
