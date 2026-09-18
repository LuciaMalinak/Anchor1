// Shared registry of the industry "subsectors" a team can pick for
// itself on the Team page — drives the landing page's industry section,
// the small accent-color reskin in the dashboard, and (not built yet —
// a phase-2 project) industry-tuned AI prompts. One list, reused
// everywhere, so adding a seventh vertical later is a one-file change.
export type IndustryKey =
  | "real_estate"
  | "finance"
  | "healthcare"
  | "hospitality"
  | "pharma"
  | "tech";

export type Industry = {
  key: IndustryKey;
  label: string;
  // A short, honest blurb for the landing page — describes what Anchor's
  // existing memory/handoff/follow-up features mean for this kind of
  // work, without claiming compliance certifications or capabilities
  // that don't exist yet.
  blurb: string;
  accent: string;
  accentDark: string;
};

export const INDUSTRIES: Industry[] = [
  {
    key: "real_estate",
    label: "Real Estate",
    blurb:
      "Every showing, negotiation, and closing call in one thread — so nothing about a buyer or listing gets lost between agents.",
    accent: "#B2472F",
    accentDark: "#8C371F",
  },
  {
    key: "finance",
    label: "Finance",
    blurb:
      "Client commitments and numbers captured the moment they're said, with a clean handoff whenever someone else picks up the account.",
    accent: "#1F6E4A",
    accentDark: "#155238",
  },
  {
    key: "healthcare",
    label: "Healthcare",
    blurb:
      "Referral, partnership, and vendor conversations organized and easy to brief a colleague on — without digging through old notes.",
    accent: "#0E7C86",
    accentDark: "#0A5E66",
  },
  {
    key: "hospitality",
    label: "Hospitality",
    blurb:
      "Remember every guest, partner, and vendor relationship the way your best account manager would — even across a busy season.",
    accent: "#C08A1E",
    accentDark: "#976B16",
  },
  {
    key: "pharma",
    label: "Pharma",
    blurb:
      "Keep detailed, sensitive conversations organized and easy to hand off cleanly, meeting after meeting.",
    accent: "#6247AA",
    accentDark: "#4A3684",
  },
  {
    key: "tech",
    label: "Tech",
    blurb:
      "Turn sales and partnership calls into a shared team memory that never resets just because someone's out.",
    accent: "#2563EB",
    accentDark: "#1D4ED8",
  },
];

export const INDUSTRY_BY_KEY: Record<IndustryKey, Industry> = Object.fromEntries(
  INDUSTRIES.map((i) => [i.key, i])
) as Record<IndustryKey, Industry>;

export function isIndustryKey(value: string): value is IndustryKey {
  return value in INDUSTRY_BY_KEY;
}
