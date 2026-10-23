import type { IndustryKey } from "./industries";

// What Anchor knows about how each industry actually works, so a team that
// sets its industry on the Team page gets a call partner who already knows
// the job: what a good call in that business has to cover, what to listen
// for, the jargon speech-to-text gets wrong, the rules people in that
// business can't break on a call, and the facts their own deal sheet
// tracks. One playbook per industry in src/lib/industries.ts.
//
// Used by live coaching and live question answers (through
// liveDealContextText in liveCoaching.ts), the post-call summary
// (summarize.ts), and the public industry pages (/industries/[key]).
//
// The pain points and rules come from what people in each business
// report struggling with. The guardrails are prompts for Anchor to flag
// a risky moment. They are not legal or compliance advice, and the
// industry pages must never claim Anchor makes anyone compliant.

export type IndustryPlaybook = {
  // Who Anchor sits beside on these calls, e.g. "agents on buyer and
  // listing calls".
  focus: string;
  // The expert Anchor acts as in the room.
  persona: string;
  // Who's usually on the other side of the call.
  counterparties: string;
  // What people in this business say slows them down, and what Anchor
  // does about each one. Shown on the industry page.
  pains: { pain: string; anchor: string }[];
  // What a strong call in this business always covers. Seeds the live
  // checklist when the deal has no prep notes of its own.
  checklist: string[];
  // Moments worth reacting to live.
  listenFor: string[];
  // Rules the person on the call can't break. Anything here counts as
  // off-limits live (red flag) and is checked after the call.
  guardrails: { label: string; rule: string }[];
  // The facts this business tracks per deal, filled from what was said
  // on each call (summary.industryFacts).
  captureFields: { label: string; hint: string }[];
  // Terms speech-to-text often mishears in this business.
  vocabulary: string[];
};

export const INDUSTRY_PLAYBOOKS: Record<IndustryKey, IndustryPlaybook> = {
  real_estate: {
    focus: "Residential agents and teams on buyer, listing and negotiation calls",
    persona:
      "a top-producing residential agent and team lead with 15+ years of buyer and listing work, who knows contracts, contingencies, lender timelines and fair-housing rules cold",
    counterparties: "buyers, sellers, the other side's agent, lenders, inspectors, appraisers, attorneys and title/escrow",
    pains: [
      {
        pain: "Since the 2024 NAR settlement, buyers have to sign a written agreement before touring, and the compensation talk is now the hardest conversation in the first meeting.",
        anchor: "Checks every first buyer call for the agreement and compensation discussion, and gives you a clear, confident way to explain your value when the client pushes back on fees.",
      },
      {
        pain: "Commission pushback has become routine, and much of it comes from confusion rather than objection.",
        anchor: "Spots the pushback as it happens and suggests a plain explanation drawn from what you've told this client before, instead of a script.",
      },
      {
        pain: "Inspection, appraisal, financing and closing deadlines live in different places, so dates get missed.",
        anchor: "Pulls every date and contingency said on a call into the deal sheet and turns them into tasks with the deadline attached.",
      },
      {
        pain: "Buyers change their must-haves after every showing, and nobody remembers what they said three houses ago.",
        anchor: "Keeps a running list of each buyer's must-haves, dealbreakers and budget across every call and showing, so you can brief a teammate in a minute.",
      },
      {
        pain: "One careless line about schools, safety or \"the kind of people\" in an area is a fair-housing problem.",
        anchor: "Flags steering language live and after the call, and suggests neutral wording that points clients to objective sources.",
      },
      {
        pain: "Teams, showing agents and transaction coordinators lose context at every handoff.",
        anchor: "Hands off a complete brief: the client, the property, the offer, the deadlines and what was promised.",
      },
    ],
    checklist: [
      "Buyer agreement & compensation confirmed",
      "Pre-approval / proof of funds & lender",
      "Budget ceiling vs stated price range",
      "Must-haves vs dealbreakers",
      "Timeline: move date, lease end, closing",
      "Contingencies & key deadlines",
      "Next step: showing, offer or listing appointment",
    ],
    listenFor: [
      "The real ceiling on budget versus the range they gave",
      "Urgency: lease ending, job move, school start, a home to sell first",
      "Questions or pushback on commission or the buyer agreement",
      "Inspection, appraisal or financing problems and what each side wants done",
      "Mentions of another agent, or of shopping around",
      "Multiple-offer situations, escalation clauses, appraisal gaps, seller concessions",
      "Any date, because every date in a transaction is a deadline",
    ],
    guardrails: [
      {
        label: "Fair Housing: no steering",
        rule: "Never describe or recommend areas by race, religion, national origin, familial status, disability or other protected traits, and avoid subjective calls on 'good schools' or 'safe neighborhoods'. Point the client to objective sources instead.",
      },
      {
        label: "Client's max price & motivation",
        rule: "Never tell the other side your client's top price, how motivated they are or why they're moving, unless the client has said you can.",
      },
      {
        label: "Compensation is negotiable",
        rule: "Never present commission or buyer-agent compensation as fixed, standard or set by law or the MLS.",
      },
      {
        label: "Legal, tax or lending advice",
        rule: "Don't give legal, tax or loan-qualification advice. Refer the client to their attorney, CPA or lender.",
      },
    ],
    captureFields: [
      { label: "Property", hint: "Address or area, type, beds/baths, list price" },
      { label: "Price & offer terms", hint: "Offer, counter, escalation, earnest money, concessions" },
      { label: "Financing", hint: "Pre-approval, lender, loan type, down payment, cash" },
      { label: "Must-haves & dealbreakers", hint: "What they need, what rules a home out" },
      { label: "Timeline", hint: "Closing, move-in, lease end, sale-of-home dependency" },
      { label: "Contingencies & deadlines", hint: "Inspection, appraisal, financing, HOA review, with dates" },
      { label: "Agreement & compensation", hint: "Buyer/listing agreement status, agreed compensation" },
      { label: "Other parties", hint: "Other agent, lender, inspector, attorney, title/escrow" },
    ],
    vocabulary: [
      "MLS", "CMA", "earnest money", "escrow", "contingency", "appraisal gap", "escalation clause",
      "seller concessions", "HOA", "closing disclosure", "buyer representation agreement", "pre-approval",
      "comps", "under contract", "pending", "dual agency",
    ],
  },

  finance: {
    focus: "M&A advisors, investment bankers and capital raisers running sell-side, buy-side and fundraising processes",
    persona:
      "a managing director at a middle-market M&A advisory firm who has run 100+ sell-side and capital-raising processes and knows how buyers, sponsors and lenders really negotiate",
    counterparties: "strategic buyers, private-equity sponsors, lenders, investors, the client's management team, and lawyers and accountants on both sides",
    pains: [
      {
        pain: "A single sale process means 50 to 150 buyer calls, and the buyer log is still typed up by hand after every one.",
        anchor: "Fills each buyer's row from the call itself: interest level, price indication, structure, concerns, decision process and next step.",
      },
      {
        pain: "Comparing indications (IOIs) and letters of intent (LOIs) across bidders means digging through notes and emails for valuation, structure and conditions.",
        anchor: "Captures valuation, multiple, structure, financing and 'subject to' conditions the moment they're said, so bidders line up side by side.",
      },
      {
        pain: "One slip, like naming the client before an NDA or mentioning another bidder's price, can damage the process.",
        anchor: "Watches every call for confidentiality risks and flags them live, before you say something you can't take back.",
      },
      {
        pain: "Diligence questions come up on every call and get lost before they reach the data room or the client.",
        anchor: "Logs every diligence ask with who owes the answer, and uses past answers when the same question comes up again.",
      },
      {
        pain: "Partners want status on every live deal, and the junior bankers are the ones writing it up at midnight.",
        anchor: "Writes the update from the calls themselves and keeps a status brief on every deal current.",
      },
      {
        pain: "Teasers, CIMs and management presentations get rewritten from scratch each time.",
        anchor: "Drafts from what management actually said on calls, with the deck and model builder in Ask Anchor.",
      },
    ],
    checklist: [
      "NDA status confirmed",
      "Valuation range & basis (multiple, EBITDA)",
      "Structure: cash, stock, earn-out, rollover",
      "Financing source & certainty",
      "Decision process & approvals (IC, board)",
      "Diligence priorities & concerns",
      "Next process milestone & date",
    ],
    listenFor: [
      "Price anchoring, ranges and the basis behind them (multiple, adjusted EBITDA, run-rate)",
      "'Subject to' conditions: financing, diligence, management retention, approvals",
      "Requests for exclusivity, a shorter timeline or a preemptive offer",
      "Signs of a competing process or alternative target",
      "Concerns about quality of earnings, customer concentration, working capital, key-person risk",
      "Who really decides: investment committee, board, lenders",
      "Diligence requests and data room questions",
    ],
    guardrails: [
      {
        label: "Client identity before NDA",
        rule: "Don't name the client, or share the CIM or financials, with a counterparty who hasn't signed the NDA.",
      },
      {
        label: "Other bidders' names, prices & terms",
        rule: "Never reveal who else is in the process or what any other party has offered or asked for.",
      },
      {
        label: "Material non-public information",
        rule: "Don't share MNPI with anyone who hasn't been wall-crossed, and flag it if MNPI is mentioned on an unrestricted call.",
      },
      {
        label: "Price, exclusivity or timeline commitments",
        rule: "Never agree to a price, exclusivity, a deadline extension or deal terms without the client's sign-off.",
      },
      {
        label: "Guarantees of outcome or returns",
        rule: "Never promise a valuation, a closing, investment returns or performance.",
      },
    ],
    captureFields: [
      { label: "Counterparty", hint: "Firm, type (strategic / sponsor / lender / investor), people on the call" },
      { label: "NDA & access", hint: "NDA status, what materials they have" },
      { label: "Valuation indication", hint: "EV or equity value, multiple, basis" },
      { label: "Structure & terms", hint: "Cash/stock, earn-out, rollover, escrow, working capital" },
      { label: "Financing", hint: "Source, commitment level, lender, conditions" },
      { label: "Interest level", hint: "How serious, why, what would change it" },
      { label: "Decision process", hint: "IC, board, approvals and their dates" },
      { label: "Diligence asks", hint: "What they want to see, and who owes it" },
      { label: "Process dates", hint: "IOI, management meeting, LOI, exclusivity, signing" },
    ],
    vocabulary: [
      "EBITDA", "adjusted EBITDA", "EV", "enterprise value", "IOI", "LOI", "CIM", "teaser", "QoE",
      "quality of earnings", "earn-out", "rollover", "investment committee", "data room", "NWC peg",
      "R&W insurance", "exclusivity", "sponsor", "add-on", "platform", "recap", "accretion",
    ],
  },

  healthcare: {
    focus: "Teams selling into hospitals, health systems and physician groups, and building provider partnerships and referrals",
    persona:
      "a seasoned health-system sales and partnerships executive who has taken products through value analysis committees, GPO contracting, IT security review and go-live",
    counterparties: "clinical champions, department chairs, nursing leaders, supply chain and value analysis, finance, IT and security, compliance, and referral partners",
    pains: [
      {
        pain: "Hospital deals run 9 to 18 months, and context is lost between calls months apart.",
        anchor: "Remembers every stakeholder and everything said across the whole cycle, and briefs you before each call on what changed since the last one.",
      },
      {
        pain: "A value analysis committee of 8 to 15 people decides, and clinicians, supply chain, finance and IT each judge on different criteria.",
        anchor: "Maps each stakeholder and what they care about from the calls, and nudges you to cover each one's criteria, not just the champion's.",
      },
      {
        pain: "The real contract often sits with a GPO or the parent system, not the site you're talking to.",
        anchor: "Asks about contracting path, GPO and IDN early and records it, so it isn't a late surprise.",
      },
      {
        pain: "The BAA, security questionnaire and Epic/Cerner integration review can stall a deal for months if raised late.",
        anchor: "Tracks the BAA, security and integration steps as blockers with owners and dates from the first call onward.",
      },
      {
        pain: "Clinicians ask for evidence and finance asks for ROI, and promising more than the data shows is a risk.",
        anchor: "Answers from your actual evidence and files, and flags any clinical or reimbursement claim that goes beyond them.",
      },
      {
        pain: "Patient details get mentioned casually on calls and end up in notes.",
        anchor: "Flags patient-identifiable details so they stay out of notes and CRM.",
      },
    ],
    checklist: [
      "Clinical problem & current workflow",
      "Stakeholders: champion, VAC, supply chain, IT, finance",
      "Evidence & outcomes they need to see",
      "Financial case: ROI, budget cycle, reimbursement",
      "Contracting path: GPO / IDN / direct",
      "BAA, security & EHR integration review",
      "Next step: VAC date, pilot or trial",
    ],
    listenFor: [
      "Who sits on the value analysis committee, and when it next meets",
      "The clinical problem in their own words, with numbers (volumes, length of stay, readmissions, staff time)",
      "Budget timing: fiscal year, capital vs operating budget",
      "GPO (Vizient, Premier, HealthTrust) or system-level contracting",
      "Security, BAA and EHR integration (Epic, Cerner/Oracle Health, Meditech) questions",
      "Champion risk: a key person leaving, reorganizing or losing influence",
      "Patient details being described",
    ],
    guardrails: [
      {
        label: "No patient-identifiable information",
        rule: "Never capture or repeat patient names, dates of birth, record numbers or other identifiers from the call. Describe cases without identifiers.",
      },
      {
        label: "Clinical claims beyond evidence",
        rule: "Don't claim outcomes, safety or uses beyond the product's clearance or approval and published evidence.",
      },
      {
        label: "Referral inducements",
        rule: "Never offer or imply anything of value in exchange for referrals or purchases (anti-kickback / Stark).",
      },
      {
        label: "Reimbursement promises",
        rule: "Never promise that a payer will reimburse, or guarantee a billing code or rate.",
      },
      {
        label: "PHI access before a BAA",
        rule: "Don't agree to receive or handle patient data before a Business Associate Agreement is signed.",
      },
    ],
    captureFields: [
      { label: "Organization", hint: "System, hospital, sites, department" },
      { label: "Stakeholders", hint: "Name, role, what each one cares about" },
      { label: "Clinical problem", hint: "Problem, current workflow, volumes, measures" },
      { label: "Evidence asked for", hint: "Studies, references, pilot data they want" },
      { label: "Financial case", hint: "ROI, budget cycle, capital vs operating, reimbursement" },
      { label: "Contracting path", hint: "GPO, IDN, direct; VAC dates" },
      { label: "Security & integration", hint: "BAA, security questionnaire, EHR, IT owner" },
      { label: "Timeline", hint: "VAC meeting, pilot, go-live" },
    ],
    vocabulary: [
      "VAC", "value analysis", "GPO", "Vizient", "Premier", "HealthTrust", "IDN", "BAA", "PHI", "HIPAA",
      "Epic", "Cerner", "Oracle Health", "Meditech", "CMS", "CPT code", "DRG", "length of stay",
      "readmissions", "CMO", "CNO", "CMIO", "RCM",
    ],
  },

  hospitality: {
    focus: "Hotel, resort and venue group sales and event teams",
    persona:
      "a director of group and event sales at a full-service hotel who has booked thousands of groups and knows room blocks, attrition, F&B minimums and displacement inside out",
    counterparties: "meeting and event planners, third-party sourcing agents, corporate travel managers, wedding couples and families, and the property's revenue and event-services teams",
    pains: [
      {
        pain: "RFPs arrive in volume, and the fastest good response usually wins.",
        anchor: "Turns the discovery call into everything you need to answer: dates, pattern, rate, space and F&B, so the proposal goes out the same day.",
      },
      {
        pain: "Room blocks, peak nights, attrition and cutoff dates are negotiated in conversation and then misremembered in the contract.",
        anchor: "Captures every block, pattern, attrition percentage and cutoff date as said, so the contract matches the call.",
      },
      {
        pain: "Planners push for concessions like comp rooms, upgrades, Wi-Fi, parking and lower F&B minimums, and reps give too much on the call.",
        anchor: "Flags every concession ask, holds the line on anything that needs revenue-manager approval, and suggests trade-offs instead.",
      },
      {
        pain: "What counts toward the F&B minimum, and service charges, are the most common billing dispute later.",
        anchor: "Pins down what's included in the F&B minimum, service charge and tax on the call, in writing.",
      },
      {
        pain: "Details like dietary needs, accessibility, VIPs and AV get lost between sales and event services.",
        anchor: "Hands event services a complete brief with every special request said on the call.",
      },
      {
        pain: "Repeat planners expect you to remember their preferences, but sales managers turn over.",
        anchor: "Keeps each planner's history, preferences and past events, so a new sales manager sounds like they've known them for years.",
      },
    ],
    checklist: [
      "Dates & flexibility",
      "Room block & pattern (peak night)",
      "Rate expectations & budget",
      "Meeting space & setup",
      "F&B minimum & menus",
      "Contract terms: attrition, cutoff, cancellation",
      "Decision date & competing venues",
    ],
    listenFor: [
      "Date flexibility, and which nights are firm",
      "Peak-night rooms and the full pattern, compared with their past pickup history",
      "Concession asks: comp ratio, upgrades, Wi-Fi, parking, resort fee, F&B minimum",
      "Attrition, cutoff and cancellation terms they want changed",
      "Other venues they're considering and what those venues offer",
      "Dietary, allergy, accessibility, VIP and AV requirements",
      "Third-party agents and commissions",
    ],
    guardrails: [
      {
        label: "Rates & concessions over approval",
        rule: "Don't agree to a rate, comp rooms, concessions or a lower F&B minimum beyond what revenue management has approved.",
      },
      {
        label: "Attrition, cutoff & cancellation changes",
        rule: "Never change attrition, cutoff, cancellation or deposit terms live. Take them back for approval.",
      },
      {
        label: "Confirming dates or space unchecked",
        rule: "Don't confirm dates, a room block or space as held or definite before availability is checked.",
      },
      {
        label: "Other groups' details",
        rule: "Never share another group's name, rate or event details.",
      },
    ],
    captureFields: [
      { label: "Event", hint: "Group name, type, attendee count" },
      { label: "Dates", hint: "Preferred dates, alternates, flexibility" },
      { label: "Room block", hint: "Rooms per night, peak night, past pickup history" },
      { label: "Rate & concessions", hint: "Rate expectations, budget, concessions asked for" },
      { label: "Meeting space", hint: "Rooms, setups, hours, 24-hour holds" },
      { label: "F&B", hint: "Minimum, meals, menus, what counts, service charge" },
      { label: "Contract terms", hint: "Attrition %, cutoff date, cancellation, deposits" },
      { label: "Special requests", hint: "Dietary, accessibility, VIPs, AV, signage" },
      { label: "Decision", hint: "Decision date, decision maker, competing venues" },
    ],
    vocabulary: [
      "room block", "attrition", "cutoff date", "pickup", "peak night", "pattern", "F&B minimum",
      "BEO", "banquet event order", "comp ratio", "displacement", "RevPAR", "ADR", "service charge",
      "24-hour hold", "Cvent", "RFP", "force majeure", "rooming list", "resort fee",
    ],
  },

  pharma: {
    focus: "Pharma and biotech field reps and key account managers meeting healthcare providers",
    persona:
      "a top-performing pharma key account manager who knows the label, fair balance, access and reimbursement, and exactly where the line with Medical Affairs sits",
    counterparties: "physicians, nurse practitioners, pharmacists, office and practice managers, P&T committees, payers and specialty pharmacies",
    pains: [
      {
        pain: "Access to providers is down to minutes, so every second of the call has to count.",
        anchor: "Briefs you on the provider before you walk in: what they asked last time, their patients and objections, and what to lead with.",
      },
      {
        pain: "Providers casually describe patient experiences that are reportable adverse events, and reps miss them.",
        anchor: "Flags anything that sounds like an adverse event live and after the call, so it goes to safety reporting within your company's required window.",
      },
      {
        pain: "Off-label questions come up all the time, and a promotional answer is a serious compliance risk.",
        anchor: "Spots off-label questions as they're asked and steers you to log a medical information request instead of answering.",
      },
      {
        pain: "Call notes get audited, and incomplete or promotional notes create risk.",
        anchor: "Writes factual call notes from what was actually said, with safety and medical-information items separated out.",
      },
      {
        pain: "Most lost prescriptions are an access problem, like prior authorization, formulary status or copay, not a clinical one.",
        anchor: "Captures every access barrier the office mentions, by payer, and turns it into a follow-up for your access team.",
      },
      {
        pain: "Fair balance and safety information get skipped when the conversation moves fast.",
        anchor: "Nudges you to cover important safety information whenever benefits are discussed.",
      },
    ],
    checklist: [
      "Patient types & unmet need (no identifiers)",
      "Product experience & feedback",
      "Important safety information covered",
      "Access: formulary, prior auth, copay",
      "Objections & competing products",
      "Requests: samples, med info, resources",
      "Agreed next step",
    ],
    listenFor: [
      "Patient experiences that could be adverse events: side effects, hospitalizations, pregnancy exposure, lack of effect, medication errors",
      "Questions about uses, doses or populations outside the label",
      "Access barriers by payer: prior authorization, step edits, formulary tier, copay",
      "Competing products and why they're chosen",
      "Requests for samples, medical information, speaker programs or educational resources",
      "Prescribing intent and the patient type they'd start with",
    ],
    guardrails: [
      {
        label: "Off-label promotion",
        rule: "Never discuss or suggest uses, doses or patient groups outside the approved label. Offer a medical information request instead.",
      },
      {
        label: "Adverse events must be reported",
        rule: "Any patient side effect, product complaint or special situation mentioned must be captured and reported per company SOP. Never dismiss or minimize it.",
      },
      {
        label: "Fair balance & safety information",
        rule: "Don't discuss benefits without the important safety information, and never downplay risks.",
      },
      {
        label: "Comparative & unsupported claims",
        rule: "No superiority or comparative claims without approved head-to-head data.",
      },
      {
        label: "Gifts & transfers of value",
        rule: "Nothing of value outside company policy and the Sunshine Act / PhRMA Code.",
      },
      {
        label: "No patient identifiers",
        rule: "Never capture patient names or other identifiers.",
      },
    ],
    captureFields: [
      { label: "Provider", hint: "Name, specialty, practice, setting" },
      { label: "Products discussed", hint: "Products and indications covered" },
      { label: "Patient types", hint: "Patient profiles and unmet needs, no identifiers" },
      { label: "Access", hint: "Payers, formulary, prior auth, copay barriers" },
      { label: "Objections & competitors", hint: "Concerns and competing products" },
      { label: "Requests", hint: "Samples, medical information request, resources, programs" },
      { label: "Safety mentions", hint: "Any adverse event or product complaint mentioned" },
      { label: "Next step", hint: "Follow-up agreed and when" },
    ],
    vocabulary: [
      "HCP", "MSL", "KAM", "ISI", "important safety information", "fair balance", "label", "off-label",
      "adverse event", "pharmacovigilance", "MIRF", "medical information", "prior authorization", "PA",
      "step edit", "formulary", "tier", "copay card", "P&T committee", "specialty pharmacy", "hub",
      "REMS", "indication", "Sunshine Act",
    ],
  },

  tech: {
    focus: "B2B SaaS and technology sales teams: AEs, SEs, founders and account managers",
    persona:
      "an enterprise SaaS sales leader who has carried quota for a decade, runs deals with MEDDPICC, and knows security reviews and procurement before they become surprises",
    counterparties: "champions, economic buyers, technical evaluators, security and IT, procurement, legal, and end users",
    pains: [
      {
        pain: "Reps spend more time on CRM data entry and qualification fields than on selling.",
        anchor: "Fills MEDDPICC from the call itself: metrics, economic buyer, decision criteria and process, paper process, pain, champion and competition, then updates HubSpot or Salesforce.",
      },
      {
        pain: "Deals slip because security review, legal and procurement show up in the last two weeks.",
        anchor: "Asks about the paper process early, tracks security questionnaires and redlines as blockers, and warns when the close date doesn't fit.",
      },
      {
        pain: "Single-threaded deals die when the champion leaves or goes quiet.",
        anchor: "Notices when only one person shows up, and nudges you to bring in the economic buyer and other stakeholders.",
      },
      {
        pain: "Discount pressure at quarter end, and roadmap promises made to save a deal.",
        anchor: "Flags any discount past your limit and any roadmap date live, and suggests a trade instead of a giveaway.",
      },
      {
        pain: "Handoffs from AE to SE to customer success lose why the customer bought.",
        anchor: "Hands off a complete brief: what they bought, why, what was promised and who matters.",
      },
      {
        pain: "Forecasts rely on gut feel instead of what buyers actually said.",
        anchor: "Grounds deal health and next steps in the buyer's own words from each call.",
      },
    ],
    checklist: [
      "Metrics: the measurable outcome they need",
      "Economic buyer identified",
      "Decision criteria",
      "Decision process & timeline",
      "Paper process: security, legal, procurement",
      "Pain & why now",
      "Champion & competition",
    ],
    listenFor: [
      "Numbers behind the pain: hours, cost, revenue, error rates",
      "Who signs, and whether they've been involved",
      "Security review, SOC 2, SSO, data residency and DPA questions",
      "Procurement steps, vendor onboarding and legal redlines",
      "Competitors, incumbents, or 'build it ourselves'",
      "Discount, payment-term and contract-length asks",
      "Feature or roadmap requests",
    ],
    guardrails: [
      {
        label: "Roadmap dates & unbuilt features",
        rule: "Never commit to a release date or promise a feature that isn't generally available.",
      },
      {
        label: "Discounts over approval",
        rule: "Don't agree to discounts, free months or payment terms beyond what's approved.",
      },
      {
        label: "Unconfirmed security claims",
        rule: "Don't claim certifications, compliance or security features that aren't confirmed in the deal's files.",
      },
      {
        label: "Custom contract terms",
        rule: "Never agree to custom legal terms, SLAs or liability changes on the call.",
      },
    ],
    captureFields: [
      { label: "Metrics", hint: "The measurable outcome and its numbers" },
      { label: "Economic buyer", hint: "Who signs, and whether they're engaged" },
      { label: "Decision criteria", hint: "What they'll judge on" },
      { label: "Decision process", hint: "Steps, people and dates to a decision" },
      { label: "Paper process", hint: "Security review, legal, procurement, vendor onboarding" },
      { label: "Pain", hint: "The problem, its cost, why now" },
      { label: "Champion", hint: "Who's selling internally for you" },
      { label: "Competition", hint: "Alternatives, incumbents, build vs buy" },
    ],
    vocabulary: [
      "MEDDPICC", "SOC 2", "SSO", "SAML", "SCIM", "DPA", "MSA", "order form", "redlines", "ARR", "ACV",
      "POC", "pilot", "security questionnaire", "procurement", "seat", "usage-based", "API", "integration",
      "renewal", "upsell", "churn",
    ],
  },
};

export function industryPlaybook(key: IndustryKey | null | undefined): IndustryPlaybook | null {
  return key ? INDUSTRY_PLAYBOOKS[key] ?? null : null;
}

// The industry block for live coaching and live question answers. Sits in
// the cached deal-facts system block, so it adds nothing per refresh once
// the call has started.
export function industryLiveText(key: IndustryKey | null | undefined): string {
  return playbookLiveText(industryPlaybook(key));
}

// The same, for any playbook: an industry's, or a team's own specialty
// (teamSpecialty.ts).
export function playbookLiveText(p: IndustryPlaybook | null | undefined): string {
  if (!p) return "";
  return `

This team's business: ${p.focus}. Think like ${p.persona}. The other side is usually ${p.counterparties}.

What a strong call in this business covers. Use these as checklist items when the deal's own prep notes don't set the agenda:
${p.checklist.map((c) => `- ${c}`).join("\n")}

Moments to react to live in this business:
${p.listenFor.map((c) => `- ${c}`).join("\n")}

Industry rules: the person on the call must not break these, whatever the deal's own boundaries say. Treat each one as off-limits. A question or answer that would break one is a red flag, and the answer must steer away from it:
${p.guardrails.map((g) => `- ${g.label}: ${g.rule}`).join("\n")}

Terms speech-to-text often mishears in this business: ${p.vocabulary.join(", ")}.`;
}

// The industry block for the post-call summary.
export function industrySummaryText(key: IndustryKey | null | undefined): string {
  return playbookSummaryText(industryPlaybook(key));
}

export function playbookSummaryText(p: IndustryPlaybook | null | undefined): string {
  if (!p) return "";
  return `

This team's business: ${p.focus}. Write the summary the way ${p.persona} would want it, using this business's own terms.

Deal sheet: fill industryFacts with these fields, only from what was said on this call (leave a field out rather than guess):
${p.captureFields.map((f) => `- ${f.label}: ${f.hint}`).join("\n")}

Industry rules: fill complianceFlags with any moment on this call that broke or came close to one of these, or that needs follow-up because of one (for example, a reportable event or a disclosure that shouldn't have happened):
${p.guardrails.map((g) => `- ${g.label}: ${g.rule}`).join("\n")}

Terms speech-to-text often mishears in this business: ${p.vocabulary.join(", ")}.`;
}
