// Shared registry of the industry "subsectors" a team can pick for
// itself on the Team page — drives the landing page's industry section,
// the /industries pages, the small accent-color reskin in the dashboard,
// and the industry-tuned AI (each one's playbook is in
// industryPlaybooks.ts). Adding a seventh vertical means an entry here
// and a playbook there.
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
  // A short, honest blurb for the landing page — what Anchor does for
  // this kind of work (see its playbook), without claiming compliance
  // certifications or capabilities that don't exist.
  blurb: string;
  accent: string;
  accentDark: string;
};

export const INDUSTRIES: Industry[] = [
  {
    key: "real_estate",
    label: "Real Estate",
    blurb:
      "Buyer agreements, compensation talks, contingency deadlines and every buyer's must-haves, caught on the call, with fair-housing language flagged before it's a problem.",
    accent: "#B2472F",
    accentDark: "#8C371F",
  },
  {
    key: "finance",
    label: "Finance",
    blurb:
      "A buyer log that fills itself in: valuation, structure, financing and diligence asks from every buyer call, with NDA and other-bidder slips flagged live.",
    accent: "#1F6E4A",
    accentDark: "#155238",
  },
  {
    key: "healthcare",
    label: "Healthcare",
    blurb:
      "Every VAC stakeholder, GPO path, BAA and security step across an 18-month cycle, with clinical claims kept within your evidence and patient details kept out of notes.",
    accent: "#0E7C86",
    accentDark: "#0A5E66",
  },
  {
    key: "hospitality",
    label: "Hospitality",
    blurb:
      "Room blocks, peak nights, attrition, cutoff dates and F&B minimums captured as they're negotiated, and concessions held to what revenue management approved.",
    accent: "#C08A1E",
    accentDark: "#976B16",
  },
  {
    key: "pharma",
    label: "Pharma",
    blurb:
      "Possible adverse events and off-label questions flagged the moment they come up, factual call notes written for you, and every access barrier logged by payer.",
    accent: "#6247AA",
    accentDark: "#4A3684",
  },
  {
    key: "tech",
    label: "Tech",
    blurb:
      "MEDDPICC filled from the call itself, the paper process uncovered early, and roadmap promises and over-limit discounts flagged before you make them.",
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
