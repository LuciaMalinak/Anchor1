// The home dashboard's reorderable sections — each teammate can put these
// in whatever order suits them (see users.dashboardLayout in schema.ts and
// DashboardCustomize.tsx for the UI). Kept as a short, fixed list rather
// than free-form drag-and-drop of arbitrary content: "Tasks & updates" is
// one movable unit (not split into two) since splitting it would break
// its two-column layout on wider screens.
export const DASHBOARD_SECTIONS = [
  { key: "attention", label: "Needs your attention" },
  { key: "announcements", label: "From leadership" },
  { key: "tasksAndUpdates", label: "Tasks & updates" },
  { key: "meetings", label: "Recent meetings" },
] as const;

export type DashboardSectionKey = (typeof DASHBOARD_SECTIONS)[number]["key"];

export const DEFAULT_DASHBOARD_ORDER: DashboardSectionKey[] = DASHBOARD_SECTIONS.map((s) => s.key);

const VALID_KEYS = new Set<string>(DEFAULT_DASHBOARD_ORDER);

export function isDashboardSectionKey(value: string): value is DashboardSectionKey {
  return VALID_KEYS.has(value);
}

// Turns whatever's saved (possibly null, possibly stale from before a
// section was added/removed) into a complete, valid order: known keys in
// the saved order first, then any section missing from it (new, or never
// saved) appended in default order at the end — so a future new section
// always shows up for existing users instead of silently vanishing.
export function resolveDashboardOrder(saved: unknown): DashboardSectionKey[] {
  const savedKeys = Array.isArray(saved)
    ? saved.filter((k): k is DashboardSectionKey => typeof k === "string" && isDashboardSectionKey(k))
    : [];
  const seen = new Set(savedKeys);
  const missing = DEFAULT_DASHBOARD_ORDER.filter((k) => !seen.has(k));
  return [...savedKeys, ...missing];
}
