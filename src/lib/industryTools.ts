import type { IndustryKey } from "./industries";

// The industry tools on a deal's Before and After tabs: expert work
// products the people in each business make by hand today (a buyer log,
// a seller update, a VAC packet, an adverse-event intake, a group
// proposal, a mutual action plan), written by Anchor from everything said
// on the deal's calls, its files and its memory.
//
// Each report also says what it's still missing. Those gaps become the
// next call's checklist (see toolGapsText in liveCoaching.ts), so a report
// finishes itself on the next call instead of someone chasing it by email.
//
// Definitions only: no database or model imports, so the public industry
// pages can list them. Generation is in industryToolRun.ts.

export type ToolPhase = "before" | "after";

// What a tool is for, to group them on the deal page.
export type ToolKind = "prep" | "intel" | "negotiate" | "document" | "compliance" | "track";

export const TOOL_KIND_LABEL: Record<ToolKind, string> = {
  prep: "Prepare",
  intel: "Read the room",
  negotiate: "Negotiate",
  document: "Documents to send",
  compliance: "Stay compliant",
  track: "Track the deal",
};

export type IndustryTool = {
  id: string;
  // Which industries see it; "all" for every team, including teams with
  // no industry set.
  industries: IndustryKey[] | "all";
  phase: ToolPhase;
  kind: ToolKind;
  name: string;
  // What you get, in one line. Shown on the button card and the industry page.
  outcome: string;
  // What the report must contain, for the model. Written as an expert in
  // that business would brief a new analyst.
  instructions: string;
  // Gets the latest call's transcript too, for tools where the exact words
  // matter (adverse events, medical information requests, language review).
  needsTranscript?: boolean;
  // Written to go to the client or counterparty: offers "Save as Gmail
  // draft" to the deal's main contact.
  clientFacing?: boolean;
};

export const INDUSTRY_TOOLS: IndustryTool[] = [
  // -------------------------------------------------------------------------
  // Every industry
  {
    id: "promise_ledger",
    industries: "all",
    phase: "after",
    kind: "track",
    name: "Promise ledger",
    outcome: "Every commitment both sides made on every call, with who owes it, by when, and whether it happened.",
    instructions: `A ledger of every commitment made on this deal's calls, by either side.
Sections:
1. "Promises" table: Promise | Made by | To | Call & date | Due | Status. Status is one of Done, Open, Overdue, Unclear, judged only from later calls, tasks and emails.
2. "At risk": open or overdue promises that matter most, and why.
3. "Promises we made that we can't keep alone": anything that needs someone else's sign-off.`,
  },
  {
    id: "stakeholder_map",
    industries: "all",
    phase: "before",
    kind: "intel",
    name: "Stakeholder map",
    outcome: "Everyone who influences this decision, what each one cares about, where they stand, and who's missing.",
    instructions: `Map the people on the other side who influence this decision.
Sections:
1. "Stakeholders" table: Name | Role | What they care about | Stance (supportive / neutral / skeptical / unknown) | Last heard from | What they need from us.
2. "Who decides": the real decision path as far as the calls show it.
3. "Who's missing": roles that normally matter in a decision like this but haven't appeared on any call, and how to reach them.`,
  },

  // -------------------------------------------------------------------------
  // Real estate
  {
    id: "re_buyer_brief",
    industries: ["real_estate"],
    phase: "before",
    kind: "prep",
    name: "Buyer brief & showing strategy",
    outcome: "What this buyer really needs, how it changed after each showing, their true budget, and how to run the next tour.",
    instructions: `Write the brief a top buyer's agent keeps on a client before the next showing or offer.
Sections:
1. "The buyer": who they are, why they're moving, timeline, and what's driving urgency.
2. "Budget reality" table: Item | What they said | Notes. Cover stated range, real ceiling, pre-approval amount and lender, down payment, monthly payment comfort, and cash for closing.
3. "Must-haves vs dealbreakers vs nice-to-haves", each tagged with the call it came from. Note anything that changed after a showing.
4. "What the showings taught us": reactions to homes seen and the pattern behind them.
5. "Next tour plan": what to prioritise and what to rule out. Describe homes by features, never by who lives in an area.
6. "Agreement & compensation": status of the written buyer agreement and the agreed compensation.`,
  },
  {
    id: "re_offer_compare",
    industries: ["real_estate"],
    phase: "after",
    kind: "negotiate",
    name: "Offer comparison & seller net",
    outcome: "Every offer side by side with the seller's estimated net, financing strength and contingency risk.",
    instructions: `Compare the offers discussed on this deal's calls, the way a listing agent presents them to a seller.
Sections:
1. "Offers" table: Buyer/agent | Price | Concessions/credits | Financing (type, down payment, lender, pre-approval) | Earnest money | Contingencies & periods | Appraisal gap coverage | Escalation | Close date | Leaseback/other.
2. "Estimated net to seller" table: Offer | Price | Less concessions | Less estimated costs | Estimated net. Use only numbers said; otherwise write "need: <item>". State the assumptions clearly and never invent commission or closing-cost rates.
3. "Risk read": for each offer, the likelihood it closes and why (financing, contingencies, appraisal, the buyer's own home sale).
4. "Questions to ask the buyers' agents" before responding.
5. "Options for the seller": accept, counter or multiple-counter, with the trade-offs. This is advice framing, not a decision.`,
  },
  {
    id: "re_deadlines",
    industries: ["real_estate"],
    phase: "after",
    kind: "track",
    name: "Contract deadline timeline",
    outcome: "Every contingency and closing date in order, who owns it, and what happens if it's missed.",
    instructions: `Build the transaction timeline from what was said on calls.
Sections:
1. "Timeline" table: Date | Deadline | Owner | What must happen | If missed. Cover inspection, appraisal, financing, HOA/document review, title, walkthrough, closing and possession. Use "date not stated" when a date wasn't said.
2. "Next 7 days": what must happen this week.
3. "Verify against the executed contract": every date here comes from conversation, so list which ones must be confirmed in the signed contract and addenda.`,
  },
  {
    id: "re_seller_update",
    industries: ["real_estate"],
    phase: "after",
    kind: "document",
    clientFacing: true,
    name: "Weekly seller update",
    outcome: "The update sellers wish they got: activity, buyer feedback, what it means, and a clear recommendation.",
    instructions: `Write the weekly update to the seller, ready to send from the listing agent. Sellers' biggest complaint is not hearing from their agent, so be specific and candid.
Sections:
1. "This week": showings, open houses, inquiries and offers, using counts and dates only where they were said.
2. "What buyers are saying": feedback themes, quoted where possible.
3. "What it means": a candid read on price, condition and presentation versus the market.
4. "Recommendation": a clear next move with options (price adjustment, repairs, staging, terms), each with its trade-off.
5. "Next steps & dates".
Write it in a warm, plain voice, as a letter.`,
  },
  {
    id: "re_fair_housing",
    industries: ["real_estate"],
    phase: "after",
    kind: "compliance",
    name: "Fair-housing language check",
    outcome: "Anything said on the call that could read as steering, with neutral wording to use instead.",
    needsTranscript: true,
    instructions: `Review the latest call's transcript for language that could raise fair-housing concerns. Look for steering; descriptions of areas by protected traits; subjective calls on schools, safety or "the kind of people"; and comments on familial status, disability, religion or national origin.
Sections:
1. "Findings" table: What was said (quote) | Why it could be a concern | Better wording.
2. "Good practice for next time": 2-4 specific habits based on this call.
If nothing concerning was said, say so plainly, with an empty findings table. Never invent findings. This is a coaching aid, not legal advice.`,
  },

  // -------------------------------------------------------------------------
  // Finance / M&A advisory
  {
    id: "fin_buyer_log",
    industries: ["finance"],
    phase: "after",
    kind: "track",
    name: "Buyer log",
    outcome: "One row per buyer or investor from every call: stage, interest, indication, structure, concerns and next step.",
    instructions: `Build the buyer log a sell-side or capital-raising team maintains, from every call on this deal.
Sections:
1. "Buyer log" table: Counterparty | Type (strategic / sponsor / family office / lender / investor) | Contacts | NDA | Stage (contacted / NDA / CIM / IOI / mgmt meeting / LOI / dropped) | Interest (high / medium / low) | Indication | Structure notes | Key concerns | Next step & date | Last call.
2. "Movement since last week": who advanced, stalled or dropped, and why.
3. "Process health": how many are active at each stage and where the process is thin.`,
  },
  {
    id: "fin_bid_matrix",
    industries: ["finance"],
    phase: "after",
    kind: "negotiate",
    name: "Bid comparison matrix",
    outcome: "IOIs and LOIs side by side, headline value versus what it's really worth, certainty and conditions.",
    instructions: `Compare every indication or offer discussed, the way an MD presents bids to a client.
Sections:
1. "Bids" table: Bidder | Headline value | Basis (multiple, EBITDA definition) | Cash at close | Earn-out / deferred | Rollover / equity | Financing & certainty | Key conditions ('subject to') | Diligence needs | Timing / exclusivity ask.
2. "Like-for-like read": what each bid is worth after structure and conditions. Use only numbers said and show the arithmetic; where a value can't be estimated, say what's missing.
3. "Certainty ranking": the most to least likely to close at its stated value, with reasons.
4. "How to tighten each bid": the specific questions or pushes for the next round.
Never share one bidder's terms with another; this is for the client and the deal team only.`,
  },
  {
    id: "fin_market_feedback",
    industries: ["finance"],
    phase: "after",
    kind: "intel",
    name: "What the market is telling us",
    outcome: "The themes across all buyer feedback, what they mean for value and the equity story, and what to fix.",
    instructions: `Synthesise what all counterparties have said across calls into the read a senior banker gives the client.
Sections:
1. "Recurring themes" table: Theme | How many buyers raised it | Representative quotes | Effect on value or appetite.
2. "Where the story is landing": what buyers believe and value.
3. "Where it isn't": concerns that cap price or reduce certainty (quality of earnings, customer concentration, working capital, management, growth durability).
4. "What to fix": materials, analysis or data-room additions that would answer each concern before the next round.
5. "Implications for price and process": candid, with no promises about valuation.`,
  },
  {
    id: "fin_drl",
    industries: ["finance"],
    phase: "after",
    kind: "track",
    name: "Diligence request tracker",
    outcome: "Every diligence question raised on calls, who asked, who owes the answer, and its status.",
    instructions: `Compile every diligence request or question raised on this deal's calls.
Sections:
1. "Requests" table: # | Request | Workstream (financial / commercial / legal / tax / HR / IT / operational) | Asked by | Call & date | Owner | Status (open / answered / in data room / unclear) | Priority.
2. "Repeat questions": the same ask from multiple parties. Answer once, then post to the data room or FAQ.
3. "Red-flag questions": asks that suggest a buyer has a concern that could move price.`,
  },
  {
    id: "fin_client_update",
    industries: ["finance"],
    phase: "after",
    kind: "document",
    clientFacing: true,
    name: "Client process update",
    outcome: "The weekly update to the client: where the process stands, what buyers said, risks, and decisions needed.",
    instructions: `Write the weekly process update from the deal team to the client, ready to send.
Sections:
1. "Headline": one paragraph on where the process stands.
2. "Activity" table: Stage | Count | Notes.
3. "Buyer highlights": the most important developments per active party.
4. "Risks & how we're handling them".
5. "Decisions we need from you", with dates.
6. "Next two weeks".
Tone: crisp, senior, candid. Make no promises about outcome or valuation.`,
  },
  {
    id: "fin_mgmt_prep",
    industries: ["finance"],
    phase: "before",
    kind: "prep",
    name: "Management meeting prep",
    outcome: "For the next buyer meeting: who's coming, what they'll push on, strong answers, and what not to disclose.",
    instructions: `Prepare the client's management team for their next meeting with a buyer or investor.
Sections:
1. "Who's in the room and what they care about".
2. "What they'll push on": the likely questions from their earlier calls and concerns, each with a suggested answer grounded only in facts from the calls and files. Write "needs an answer from management" where unknown.
3. "Our key messages": three to five.
4. "Don't disclose": other bidders, price expectations, anything confidential or not yet cleared.
5. "What we want to learn from them".`,
  },
  {
    id: "fin_info_release",
    industries: ["finance"],
    phase: "after",
    kind: "compliance",
    name: "Information release log",
    outcome: "Who has signed what and seen what (NDA, teaser, CIM, data room, management) with any slip flagged.",
    instructions: `Track confidentiality and information flow per counterparty from what was said.
Sections:
1. "Release log" table: Counterparty | NDA status | Teaser | CIM | Data room access | Management access | Clean team / restricted items | Notes.
2. "Possible issues": anything said on calls that may have been disclosed before an NDA, other-bidder information mentioned, or MNPI concerns. Quote what was said.
3. "Next releases planned" and the approvals they need.`,
  },

  // -------------------------------------------------------------------------
  // Healthcare (selling to hospitals and health systems)
  {
    id: "hc_vac_packet",
    industries: ["healthcare"],
    phase: "after",
    kind: "document",
    name: "Value analysis (VAC) submission draft",
    outcome: "A committee-ready packet: clinical need, evidence, safety, total cost, budget impact, rollout, and who supports it.",
    instructions: `Draft the value analysis committee submission the clinical champion will bring forward, built only from the calls, files and memory.
Sections:
1. "Request summary": what's being requested, for which department and sites, and who sponsors it.
2. "Clinical need": the problem with their own numbers (volumes, outcomes, staff time) as said on calls.
3. "Evidence": studies, outcomes data and references discussed. Keep claims within cleared or approved use and the evidence named.
4. "Safety & quality".
5. "Financial impact" table: Item | Current state | With product | Annual difference | Source. Cover price, consumables, training, labour, disposal and any savings. Show total cost of ownership and budget impact; show a conservative scenario.
6. "Implementation": training, IT and EHR integration, timeline.
7. "Contracting": GPO, IDN, BAA, security status.
8. "Stakeholder support": who supports it and who still has to weigh in.
The committee defers anything with a weak financial case, so be explicit about what's still missing.`,
  },
  {
    id: "hc_business_case",
    industries: ["healthcare"],
    phase: "after",
    kind: "negotiate",
    name: "ROI & budget-impact worksheet",
    outcome: "Total cost of ownership, budget impact and payback from the hospital's own numbers, with a conservative case.",
    instructions: `Build the financial case the way hospital finance and supply chain evaluate it: their own baseline, not national averages.
Sections:
1. "Inputs" table: Input | Value | Source (call & date, or "need from hospital").
2. "Total cost of ownership" table: Cost item | Year 1 | Year 2 | Year 3.
3. "Savings & revenue effects" table: Effect | Mechanism | Annual value | Confidence.
4. "Budget impact & payback": the net change in spend, payback period, and capital versus operating budget.
5. "Conservative case": the same numbers with cautious assumptions. It must still hold up, or say so.
Show your arithmetic. Never invent a number; list it as a needed input instead.`,
  },
  {
    id: "hc_contracting_path",
    industries: ["healthcare"],
    phase: "after",
    kind: "track",
    name: "Contracting path & blockers",
    outcome: "GPO, IDN, BAA, security review and EHR integration steps with owners, dates, and a realistic close date.",
    instructions: `Lay out every step between "they want it" and "PO issued" for this health system.
Sections:
1. "Path" table: Step | Owner (theirs / ours) | Status | Date needed | Blocker. Cover clinical approval, VAC, GPO or contract vehicle, IDN or system approval, BAA, security questionnaire, IT and EHR integration review, legal, budget approval and PO.
2. "Realistic timeline": versus the forecast close date, with slip risk and why.
3. "Do now": the steps that could run in parallel today.`,
  },
  {
    id: "hc_champion_kit",
    industries: ["healthcare"],
    phase: "before",
    kind: "document",
    name: "Champion kit",
    outcome: "Short notes the champion can forward to finance, supply chain, IT and nursing, each in that function's language.",
    instructions: `Help the clinical champion sell internally. Write a short, forwardable note for each function that evaluates the purchase, using only facts from the calls and files.
Sections: one per audience: "For finance", "For supply chain / value analysis", "For IT & security", "For nursing / frontline staff", "For physician colleagues". Each has 3-5 sentences covering what's in it for them, the evidence they'll want, and the one question they're likely to ask, with its answer.
End with "What the champion still needs from us".`,
  },
  {
    id: "hc_phi_check",
    industries: ["healthcare", "pharma"],
    phase: "after",
    kind: "compliance",
    name: "Patient-detail check",
    outcome: "Flags any patient-identifying detail said on the call so it stays out of notes, CRM and email.",
    needsTranscript: true,
    instructions: `Review the latest call's transcript for patient-identifying information: names, dates of birth, record numbers, addresses, phone numbers, specific dates tied to a patient, rare-condition details that identify someone, or images.
Sections:
1. "Findings" table: What was said (redact the identifier itself, e.g. "[patient name]") | Type of identifier | What to do (keep out of notes / report under privacy SOP if shared improperly).
2. "Safe way to describe these cases" in future notes.
If nothing identifying was said, say so plainly. Never repeat an identifier in the report.`,
  },

  // -------------------------------------------------------------------------
  // Hospitality (hotel and venue group sales)
  {
    id: "hosp_proposal",
    industries: ["hospitality"],
    phase: "after",
    kind: "document",
    clientFacing: true,
    name: "Same-day group proposal",
    outcome: "A tailored proposal from the discovery call (dates, room block, rates, space, F&B, terms) ready the same day.",
    instructions: `Draft the group proposal a director of sales sends right after the discovery call. Planners book the first good response, and generic packets lose, so tailor every line to what this planner said.
Sections:
1. "Opening": two or three sentences that show we heard them (their goals, attendees, what matters most).
2. "Dates": preferred and alternate dates, and why the alternates could work for them.
3. "Guest rooms" table: Night | Date | Rooms | Rate. Write "rate: confirm with revenue management" for any rate not said.
4. "Meeting & event space" table: Day | Time | Function | Setup | Attendees | Room.
5. "Food & beverage": minimum, what counts toward it, service charge and tax, and the menus discussed.
6. "Concessions": only those already approved or said. Mark requested ones as "pending approval".
7. "Key terms to confirm": attrition, cutoff date, cancellation, deposits.
8. "Next step & hold": what we're holding and until when.`,
  },
  {
    id: "hosp_displacement",
    industries: ["hospitality"],
    phase: "after",
    kind: "negotiate",
    name: "Group value & displacement check",
    outcome: "Is this group worth it? Total group revenue versus the transient business it would displace.",
    instructions: `Evaluate the group the way a revenue manager would, using only numbers said on calls or in files.
Sections:
1. "Group revenue" table: Item | Calculation | Value. Cover rooms × nights × group rate, F&B, meeting room rental, AV, and other spend.
2. "Displacement" table: Night | Group rooms | Forecast transient rooms displaced | Forecast transient ADR | Displaced revenue. If forecast occupancy or ADR isn't given, leave it as "need from revenue management". Never guess it.
3. "Net value": group total revenue minus displaced revenue, and the profit view (F&B and meeting space margins, acquisition costs).
4. "Shoulder nights & pattern": how shifting dates or pattern would improve the result.
5. "Recommendation": accept, counter with alternate dates or rate, or decline, with the reasoning.`,
  },
  {
    id: "hosp_pickup_risk",
    industries: ["hospitality"],
    phase: "after",
    kind: "intel",
    name: "Block & attrition risk",
    outcome: "Will this group fill its block? Pickup history versus the ask, the right block size, and attrition terms.",
    instructions: `Assess how likely the group is to pick up its block, the way an experienced group sales director would.
Sections:
1. "History vs ask" table: Event / year | Block | Pickup | Pickup % | Notes. Use only history the planner shared; otherwise list it as a question to ask.
2. "Risk factors": attendance drivers, registration timing, booking outside the block, change in the meeting format.
3. "Recommended block": size and pattern, with reasoning.
4. "Protection": suggested attrition percentage, cutoff date, review dates (sliding scale), resale credit and room-night counting method, each with the trade-off for the planner.`,
  },
  {
    id: "hosp_concessions",
    industries: ["hospitality"],
    phase: "after",
    kind: "negotiate",
    name: "Concession ledger",
    outcome: "Every concession asked, offered and given across calls, what it costs, and what we got in return.",
    instructions: `Track every concession in this negotiation.
Sections:
1. "Ledger" table: Concession | Asked by / offered by | Call & date | Status (asked / offered / agreed / declined / pending approval) | Estimated cost | What we got in return.
   Cover comp ratio, upgrades, suites, Wi-Fi, parking, resort fee, F&B minimum, meeting room rental, AV discounts, attrition and cutoff changes, deposits, and rebates or commissions.
2. "Totals": estimated total value given, and what's still pending approval.
3. "Trades to propose": concessions to ask for in return (dates, pattern, F&B, deposits, a multi-year commitment).`,
  },
  {
    id: "hosp_contract_check",
    industries: ["hospitality"],
    phase: "after",
    kind: "compliance",
    name: "Contract vs conversation check",
    outcome: "Checks the contract's terms against what was actually agreed on calls, before anyone signs.",
    instructions: `Compare the terms in any attached contract or proposal file with what was agreed or said on calls. If no contract file is attached, list the terms agreed on calls and what the contract must say.
Sections:
1. "Terms check" table: Term | What was said on calls (call & date) | What the contract says | Match? (match / mismatch / missing / not discussed).
   Cover dates, room block and pattern, rates, comp ratio, F&B minimum (what counts, service charge), meeting space, attrition (percentage and calculation method), cutoff date, cancellation schedule, deposits, resale credit, force majeure, Wi-Fi and fees, and concessions.
2. "Mismatches to fix before signing".
3. "Terms that were never discussed" but are in the contract, and should be explained to the planner.`,
  },
  {
    id: "hosp_turnover",
    industries: ["hospitality"],
    phase: "after",
    kind: "document",
    name: "Event services turnover",
    outcome: "The sales-to-event-services handoff with every detail, preference and promise from the calls, so nothing's lost.",
    instructions: `Write the turnover packet from sales to the event services or catering manager.
Sections:
1. "Group at a glance": name, dates, attendees, purpose, key contacts and how they like to communicate.
2. "Contracted vs promised": what's in the contract and anything promised verbally on calls that event services must honour.
3. "Program by day" table: Day | Time | Function | Setup | Attendees | F&B | AV | Notes.
4. "Special requirements": dietary needs and allergies (exactly as said), accessibility, VIPs, security, signage, shipping.
5. "Planner preferences & history": what they loved or hated before and what matters most to them.
6. "Open items" for the BEO.`,
  },

  // -------------------------------------------------------------------------
  // Pharma (field reps and key account managers)
  {
    id: "ph_call_note",
    industries: ["pharma"],
    phase: "after",
    kind: "document",
    name: "CRM-ready call note",
    outcome: "A factual, non-promotional call note ready to paste into your CRM, with safety and medical-information items separated out.",
    needsTranscript: true,
    instructions: `Write the call note a compliant field rep files in the CRM.
Sections:
1. "Call details": HCP, specialty, setting, attendees, channel (in-person / virtual).
2. "Products & topics discussed": factual, on-label topics only. Don't characterise efficacy; record what was discussed, not claims.
3. "HCP feedback & questions": neutral wording.
4. "Access": payer and coverage issues raised.
5. "Requests": samples, resources, medical information requests.
6. "Safety & medical information": list separately any possible adverse event, product complaint or off-label question, and note "route per SOP". Don't put the details in the call note itself.
7. "Follow-up".
Plain, factual, no superlatives, no patient identifiers.`,
  },
  {
    id: "ph_ae_intake",
    industries: ["pharma"],
    phase: "after",
    kind: "compliance",
    name: "Adverse event intake draft",
    outcome: "Catches any possible adverse event or product complaint in the call and drafts the intake with the reporting clock.",
    needsTranscript: true,
    instructions: `Screen the latest call's transcript for anything that could be a reportable adverse event (AE), special situation or product quality complaint. That includes side effects, lack of effect, overdose, misuse, medication errors, pregnancy or breastfeeding exposure, off-label use with an outcome, interactions, and damaged or defective product.
Sections:
1. "Possible events" table: # | What was said (verbatim quote) | Type (AE / special situation / product complaint) | Product | Patient described (no identifiers: age range or sex only if said) | Reporter (HCP) | Seriousness indicators mentioned.
2. "Minimum criteria check" for each: identifiable patient, identifiable reporter, suspect product, event. Mark each present or missing, and list what to ask the HCP to complete the report.
3. "Reporting clock": the call date is when the company became aware. Forward to pharmacovigilance within your company's required window (often one business day).
If nothing in the transcript could be an adverse event or complaint, say so plainly. Never invent one, and never judge causality: reporting doesn't require it.`,
  },
  {
    id: "ph_mir",
    industries: ["pharma"],
    phase: "after",
    kind: "compliance",
    name: "Medical information request",
    outcome: "Turns off-label or detailed scientific questions into properly documented, unsolicited medical information requests.",
    needsTranscript: true,
    instructions: `Find questions the HCP asked on the latest call that a rep must not answer promotionally: off-label uses, doses or populations, unpublished data, comparative questions, or detailed scientific questions beyond approved materials.
Sections:
1. "Requests" table: # | HCP's question (verbatim) | Product | Why it's a medical information request | Unsolicited? (yes / unclear) | Preferred response (email / mail / call from Medical).
2. "What the rep should have said or should say next time": a short compliant line for each.
3. "Not medical information requests": questions that can be answered with approved materials.
If no such question was asked, say so plainly. Only questions the HCP raised unprompted count as unsolicited; flag any that the rep prompted.`,
  },
  {
    id: "ph_access_map",
    industries: ["pharma"],
    phase: "after",
    kind: "track",
    name: "Access barrier map",
    outcome: "Every coverage problem the office raised, by payer, ready to hand to your access or reimbursement team.",
    instructions: `Map the access and reimbursement barriers this office or account has described across calls.
Sections:
1. "Barriers" table: Payer / plan | Barrier (PA denial, step edit, formulary tier, quantity limit, copay, specialty pharmacy, buy-and-bill) | Patients affected (count or type, no identifiers) | What the office tried | Call & date.
2. "Office workflow": who handles prior authorizations, and where they get stuck.
3. "Handoff to the access / field reimbursement team": a ready-to-send summary with specifics.
4. "Resources to offer": hub enrollment, copay programs and approved PA support materials, only as discussed.`,
  },
  {
    id: "ph_precall",
    industries: ["pharma"],
    phase: "before",
    kind: "prep",
    name: "60-second pre-call card",
    outcome: "For a two-minute window with a busy HCP: what changed, what's open, and the one thing to lead with.",
    instructions: `Write a pre-call card a rep can read in the elevator. It must be short.
Sections:
1. "Since last time": what this HCP said, asked or prescribed last call (one or two lines).
2. "Open items": medical information requests, adverse event follow-ups, samples, access issues promised.
3. "Lead with": the one on-label message most relevant to this HCP's patients and concerns.
4. "Expect": the likely objection and an on-label, fair-balanced response.
5. "Safety reminder": cover important safety information when benefits come up.
6. "Office": staff names and how to work with the office.`,
  },
  {
    id: "ph_promo_review",
    industries: ["pharma"],
    phase: "after",
    kind: "compliance",
    name: "Promotional language review",
    outcome: "Reviews what the rep said for overstatement, off-label, comparative or risk-minimising language, with compliant rewrites.",
    needsTranscript: true,
    instructions: `Review what the rep said on the latest call, not what the HCP said, the way a compliance coach would.
Sections:
1. "Findings" table: What the rep said (quote) | Risk (overstatement / off-label / unsupported comparison / minimising risk / missing fair balance / inducement) | Compliant alternative.
2. "What went well": compliant handling worth repeating.
If nothing concerning was said, say so plainly. Never invent findings. This is a coaching aid, not a compliance determination.`,
  },

  // -------------------------------------------------------------------------
  // Tech (B2B SaaS)
  {
    id: "tech_meddpicc",
    industries: ["tech"],
    phase: "after",
    kind: "intel",
    name: "MEDDPICC scorecard",
    outcome: "Each letter scored from what the buyer actually said, the evidence, the gaps, and the exact questions to close them.",
    instructions: `Qualify this deal with MEDDPICC using only evidence from calls, emails and files.
Sections:
1. "Scorecard" table: Element | Score (0-3) | Evidence (quote or call & date) | Gap. Elements: Metrics, Economic buyer, Decision criteria, Decision process, Paper process, Identify pain, Champion, Competition.
2. "Biggest risks" for this deal.
3. "Questions for the next call": specific, in the buyer's language, one or two per gap.`,
  },
  {
    id: "tech_map",
    industries: ["tech"],
    phase: "after",
    kind: "document",
    clientFacing: true,
    name: "Mutual action plan",
    outcome: "A shareable plan of every step, owner and date from today to go-live, built from what both sides agreed.",
    instructions: `Write a mutual action plan to share with the buyer. It's customer-facing, so make it collaborative and leave out internal notes.
Sections:
1. "Goal": the outcome they're buying, in their words, and the target go-live date and why it matters to them.
2. "Plan" table: Step | Owner (name, their side or ours) | Due | Status. Include evaluation, technical validation, security review, legal, procurement, signature, kickoff and go-live.
3. "Decision criteria we agreed".
4. "Contacts": both sides.
Only steps and dates actually discussed get dates; others say "to agree".`,
  },
  {
    id: "tech_close_check",
    industries: ["tech"],
    phase: "after",
    kind: "track",
    name: "Forecast reality check",
    outcome: "Can this deal really close by the date in the forecast? Remaining steps versus time left, and the slip risk.",
    instructions: `Pressure-test the close date the way a sales leader does in a forecast call.
Sections:
1. "Remaining steps" table: Step | Typical duration | Started? | Evidence. Cover security review, legal redlines, procurement, vendor onboarding, budget approval, signatures.
2. "Verdict": likely / at risk / unlikely by the stated date, with reasons.
3. "Slip signals" heard on calls.
4. "To pull it in": concrete actions such as parallel paths, an executive sponsor or early security review.`,
  },
  {
    id: "tech_security_prefill",
    industries: ["tech"],
    phase: "after",
    kind: "document",
    name: "Security questionnaire prefill",
    outcome: "Answers the buyer's security and compliance questions from your files and past answers, and flags what you can't claim.",
    instructions: `Prepare answers for the security, privacy and compliance questions this buyer raised on calls or in attached files.
Sections:
1. "Answers" table: Question | Proposed answer | Source (file, past answer, call) | Confidence (confirmed / needs security team).
2. "Do not claim": anything asked where no source confirms we have it (certifications, data residency, SSO, encryption specifics, pen tests).
3. "Documents to send": SOC 2 report, DPA, policies, as discussed.
Never state a certification, control or feature that isn't confirmed in the material.`,
  },
  {
    id: "tech_handoff",
    industries: ["tech"],
    phase: "after",
    kind: "document",
    name: "Sales-to-customer-success handoff",
    outcome: "Why they bought, what was promised, who matters and the success metrics, so onboarding starts with full context.",
    instructions: `Write the handoff from the account executive to customer success and implementation.
Sections:
1. "Why they bought": pain, metrics and the outcome they expect, in their words.
2. "What we promised": features, timelines, services and pricing terms, with anything non-standard flagged.
3. "People" table: Name | Role | Cares about | Style.
4. "Success plan": 30/60/90-day milestones tied to their metrics.
5. "Risks": adoption, technical and political.`,
  },
  {
    id: "tech_champion_case",
    industries: ["tech"],
    phase: "before",
    kind: "document",
    name: "Business case for your champion",
    outcome: "A one-page business case your champion can forward to the economic buyer, in their numbers.",
    instructions: `Write a short business case the champion can send to their economic buyer, as if the champion wrote it.
Sections:
1. "The problem": cost of the status quo in their numbers.
2. "The proposal": what, how much, how fast.
3. "Expected return" table: Benefit | Today | With the product | Annual value. Use only numbers said; otherwise "to quantify".
4. "Risks & how they're handled".
5. "The ask": decision and date.
Keep it to about a page. Write it in the buyer's language, not vendor marketing.`,
  },
  // -------------------------------------------------------------------------
  // New for every industry: reading between the lines, and rehearsing
  {
    id: "contradictions",
    industries: "all",
    phase: "after",
    kind: "intel",
    name: "Contradiction finder",
    outcome: "Every place the other side's story changed across calls, emails and files: numbers, dates, people, priorities, side by side.",
    instructions: `Compare everything the other side has said across every call, email and file on this deal, and find where it doesn't line up.
Sections:
1. "Contradictions" table: Topic | What they said before (quote, source & date) | What they say now (quote, source & date) | Why it matters.
   Look for budget or price, timeline, decision makers, requirements, volumes, competitors, approvals and reasons.
2. "Quietly dropped": things they cared about earlier that have disappeared from the conversation.
3. "How to raise it": for the important ones, a non-confrontational way to clarify on the next call ("Last time you mentioned X — has that changed?").
If nothing contradicts, say so. Never manufacture a contradiction from different wording of the same thing.`,
  },
  {
    id: "unsaid",
    industries: "all",
    phase: "after",
    kind: "intel",
    name: "What they're not saying",
    outcome: "The questions they dodged, the hedges, the topics they steered away from, and what that likely means.",
    needsTranscript: true,
    instructions: `Read the latest call's transcript for what sits under the words. Every finding must quote the transcript.
Sections:
1. "Dodged or deflected" table: Question asked | How they answered (quote) | What it may mean.
2. "Hedges & soft language": "we'll see", "probably", "I'd have to check", vague timelines, each with what's likely behind it.
3. "Topics they steered away from" or kept returning to.
4. "What their questions reveal": what they asked about tells you what they're worried about or prioritising.
5. "Read": a short, candid interpretation, framed as hypotheses to test, not conclusions.
6. "Test it next call": one question for each hypothesis.`,
  },
  {
    id: "premortem",
    industries: "all",
    phase: "after",
    kind: "intel",
    name: "Deal pre-mortem",
    outcome: "It's three months from now and this was lost. The most likely reasons, the early warning signs already showing, and what to do this week.",
    instructions: `Imagine it is three months from now and this deal or relationship was lost or stalled. Work backwards from the evidence.
Sections:
1. "Most likely reasons it failed" table: Reason | Evidence already in the record (quote / source) | Likelihood (high / medium / low).
2. "Warning signs already showing".
3. "What would have saved it": specific moves, ranked by impact.
4. "This week": the three actions to take now.
Be candid, not alarmist. Ground every reason in evidence; don't list generic risks the record doesn't support.`,
  },
  {
    id: "sparring",
    industries: "all",
    phase: "before",
    kind: "prep",
    name: "Toughest-questions sparring",
    outcome: "The ten hardest questions the other side is likely to ask next, why they'll ask, the best answer from your own record, and what never to say.",
    instructions: `Prepare the person for the next conversation like a demanding coach.
Sections:
1. "The ten hardest questions" table: # | Question (in their words) | Why they'll ask it (evidence) | Best answer (grounded in the team's past answers, calls and files) | Don't say.
   Where the record has no good answer, write "Need an answer from the team" in place of one.
2. "Curveballs": two or three unexpected questions given what's happened lately.
3. "Questions to ask them": three that shift the conversation your way.
Respect the industry rules and the deal's decision boundaries in every answer.`,
  },
  {
    id: "game_plan",
    industries: "all",
    phase: "before",
    kind: "prep",
    name: "Next call game plan",
    outcome: "A minute-by-minute plan for the next call: opening line, what you must leave with, the traps, and the fallback if it goes sideways.",
    instructions: `Write the plan for the next call on this deal.
Sections:
1. "Goal": the one outcome that makes the call a success, and the fallback outcome.
2. "Run of show" table: Minutes | Segment | What to say or ask (specific wording) | Purpose.
3. "Must leave with": the answers or commitments to get before hanging up.
4. "Traps": topics or questions likely to derail it, and how to handle each.
5. "Opening line" and "Closing ask", written out.
Make it specific to this deal's open items and people.`,
  },
  {
    id: "give_get",
    industries: ["real_estate", "finance", "healthcare", "pharma", "tech"],
    phase: "after",
    kind: "negotiate",
    name: "Give-and-get ledger",
    outcome: "Every ask and concession on both sides across calls, the running balance, and what to ask for in return next time.",
    instructions: `Track the negotiation's trades across every call and email.
Sections:
1. "Ledger" table: Item | Asked by | Given by | Call & date | Status (asked / offered / agreed / declined / pending sign-off) | What was received in return.
2. "Balance": who has given more so far, honestly.
3. "Next trades": for each open ask from them, what to request in exchange.
4. "Never give away": items the decision boundaries or industry rules protect.`,
  },

  // -------------------------------------------------------------------------
  // New for real estate
  {
    id: "re_listing_kit",
    industries: ["real_estate"],
    phase: "after",
    kind: "document",
    name: "Listing launch kit",
    outcome: "MLS remarks, feature highlights, showing instructions, open-house plan and social posts, written from the seller call and fair-housing safe.",
    instructions: `Turn what the seller said about the home into a launch kit.
Sections:
1. "MLS public remarks": about 250 words, vivid and specific about the property itself. Never describe the neighbourhood's people, "perfect for families", schools' quality or safety (fair housing).
2. "Feature highlights": 8-12 bullets from what was said (upgrades with years, systems, outdoor, storage).
3. "Showing instructions": access, pets, times to avoid, as the seller said.
4. "Open house plan": date ideas, what to stage or fix first, the story to tell at the door.
5. "Social posts": three captions (just listed / open house / feature spotlight).
6. "Pricing notes": the seller's expectations and constraints as said; no price recommendation unless one was discussed.
Mark anything not stated as "confirm with seller".`,
  },
  {
    id: "re_counter_sim",
    industries: ["real_estate"],
    phase: "after",
    kind: "negotiate",
    name: "Counter-offer simulator",
    outcome: "Three or four ways to counter, how the other side will likely react to each, and the risk and net effect of every path.",
    instructions: `Simulate the next move in this negotiation for your client.
Sections:
1. "Where it stands": the latest offer or counter, and each side's stated priorities.
2. "Counter options" table: Option | Terms (price, credits, dates, contingencies) | Likely reaction from the other side (with the evidence) | Risk | Effect on your client.
3. "Recommended sequence": what to lead with, what to hold back, and the walk-away signal.
4. "Script": how to present the recommended counter to the other agent.
Use only numbers said; mark unknowns "confirm". This is advice for the client to decide on.`,
  },
  {
    id: "re_repair_strategy",
    industries: ["real_estate"],
    phase: "after",
    kind: "negotiate",
    name: "Inspection repair strategy",
    outcome: "Every inspection issue raised, whether to ask for a repair, a credit or a price cut, and the request wording, prioritised.",
    instructions: `Build the repair negotiation from what was said about the inspection.
Sections:
1. "Issues" table: Issue | Severity as described | Ask (repair / credit / price reduction / let it go) | Why | Likely response from the other side.
2. "Priorities": the must-haves versus the trade-aways.
3. "Request wording": a draft of the repair request to the other agent.
4. "Deadlines": the inspection contingency dates, if said.
Don't estimate repair costs that weren't stated; write "get a quote".`,
  },

  // -------------------------------------------------------------------------
  // New for finance / M&A advisory
  {
    id: "fin_bidder_profiles",
    industries: ["finance"],
    phase: "after",
    kind: "intel",
    name: "Bidder psychology profiles",
    outcome: "For each buyer: what really drives them, their pressure points, their tells, the walk-away signals, and how to push them.",
    instructions: `Profile each counterparty in the process from everything they've said and done.
For each bidder, a section with:
- "Motivation": why they want this (strategic fit, platform or add-on, deploying capital, defensive).
- "Pressure points": timing, competition, internal politics, financing, fund life.
- "Tells": how they signal real interest or hesitation, with quotes.
- "Walk-away signals" to watch for.
- "How to push": the lever most likely to move their price or certainty, without disclosing anything about other bidders.
End with a "Ranking" table: Bidder | Appetite | Ability to pay | Certainty | Next move.`,
  },
  {
    id: "fin_tension_plan",
    industries: ["finance"],
    phase: "before",
    kind: "negotiate",
    name: "Competitive tension plan",
    outcome: "How to run the next round for the best price and certainty: who to call first, the deadlines, and the message for each bidder.",
    instructions: `Plan the next round of the process to maximise price and certainty without disclosing other parties' identities, prices or terms.
Sections:
1. "Round objective" and the deadline proposal.
2. "Sequencing" table: Bidder | Call order | Message (what we tell them; never other bidders' details) | What we want back | Fallback.
3. "Levers": exclusivity, timing, access to management or the data room, certainty requirements.
4. "Risks": who might drop, who might try to pre-empt, and the response to each.
5. "Client decisions needed".`,
  },
  {
    id: "fin_valuation_bridge",
    industries: ["finance"],
    phase: "after",
    kind: "negotiate",
    name: "Valuation bridge",
    outcome: "How each bidder gets from earnings to their price: EBITDA definition, adjustments, multiple, debt-like items, working capital. Where they diverge, and why.",
    instructions: `Reconstruct, from what was said, how each bidder arrives at their number.
Sections:
1. "Bridge" table: Bidder | EBITDA basis | Adjustments accepted / rejected | Multiple | Enterprise value | Debt-like items | NWC peg | Equity value. Use "not stated" where unknown, and show arithmetic only from stated numbers.
2. "Where they diverge": the biggest drivers of difference between bidders.
3. "Arguments to close the gap": the evidence that supports the adjustments they reject.
4. "Questions to put to each bidder".`,
  },
  {
    id: "fin_process_letter",
    industries: ["finance"],
    phase: "before",
    kind: "document",
    name: "Next-round process letter",
    outcome: "A draft bid-instruction letter for the next round: deadline, what each bid must include, and how to submit.",
    instructions: `Draft the process letter for the next round of bids, ready for the deal team to edit.
Sections:
1. "Letter": formal, addressed to "Prospective Bidders". Cover the deadline, the contents required (price and basis, structure, financing sources and certainty, diligence still needed, approvals and timing, key terms or markup, advisors), submission instructions and contacts, confidentiality reminder, and reservation of rights.
2. "Dates to confirm" with the client.
Use dates and terms only as discussed; leave placeholders like [date] otherwise.`,
  },
  {
    id: "fin_ic_memo",
    industries: ["finance"],
    phase: "after",
    kind: "document",
    name: "Investment committee memo",
    outcome: "For buy-side and investors: a first-draft IC memo from the diligence calls (thesis, risks, value, open questions).",
    instructions: `Draft an investment committee memo from what has been learned on this deal's calls and files.
Sections:
1. "Summary & recommendation" (as a draft for the team to decide).
2. "Investment thesis": three to five points, with the evidence for each.
3. "Business overview": what the record shows.
4. "Financials" table: Metric | Value | Source.
5. "Key risks & mitigants".
6. "Valuation & structure": as discussed.
7. "Diligence still open".
Never invent figures; write "need: …".`,
  },

  // -------------------------------------------------------------------------
  // New for healthcare
  {
    id: "hc_committee_sim",
    industries: ["healthcare"],
    phase: "before",
    kind: "prep",
    name: "Committee rehearsal",
    outcome: "Each value analysis committee member's three hardest questions (finance, supply chain, IT, nursing, physicians) and your best evidence-backed answers.",
    instructions: `Rehearse the value analysis committee meeting.
For each function (Finance, Supply chain / value analysis, IT & security, Nursing, Physicians, Infection prevention / quality), a section with a table: Question they'll ask | Best answer (from the evidence, files and calls only) | Gap (if the record can't answer it).
End with "Weakest points": the three questions most likely to get the request deferred, and how to shore each up before the meeting.
Keep clinical answers within cleared or approved use and the evidence on file.`,
  },
  {
    id: "hc_pilot_protocol",
    industries: ["healthcare"],
    phase: "after",
    kind: "document",
    name: "Pilot that converts",
    outcome: "A pilot plan designed to end in a purchase: units, length, baseline, success metrics, data to collect, owners, and the expand-or-stop decision.",
    clientFacing: true,
    instructions: `Design a pilot the health system can agree to, where success leads straight to a purchase decision.
Sections:
1. "Objective": in their words.
2. "Scope": units, sites, length, and who's involved.
3. "Success metrics" table: Metric | Baseline (from what they said, or "measure in week 0") | Target | How measured | Owner.
4. "Timeline" table: Week | Milestone.
5. "Decision": what result means expand, and the commercial terms that apply if it does (as discussed).
6. "Responsibilities": theirs and ours.
Keep it realistic and within the evidence; no promised outcomes.`,
  },
  {
    id: "hc_evidence_gaps",
    industries: ["healthcare"],
    phase: "after",
    kind: "intel",
    name: "Evidence gap finder",
    outcome: "Every claim and question in this deal matched against the evidence on file: what the committee will see as missing, and how to fill it.",
    instructions: `Audit the evidence behind this deal.
Sections:
1. "Claims & needs" table: Claim made or question asked (source) | Evidence on file (file name or call) | Strength (strong / partial / none) | How to fill the gap (study, reference site, local data, pilot).
2. "Red flags": anything said on calls that goes beyond the evidence or cleared use.
3. "Priority fixes" before the committee meets.`,
  },

  // -------------------------------------------------------------------------
  // New for hospitality
  {
    id: "hosp_site_visit",
    industries: ["hospitality"],
    phase: "before",
    kind: "prep",
    name: "Site visit itinerary",
    outcome: "A tour designed around this planner: the route, who greets them, what to show first, the tasting, and the objections to answer on the walk.",
    instructions: `Plan a site visit tailored to this planner's priorities and concerns from the calls.
Sections:
1. "What they care about": the three things that will decide this.
2. "Itinerary" table: Time | Stop | Who's there | What to show or say | Why (ties to their priority).
3. "Moments to create": personal touches from their preferences (room amenity, named welcome, tasting of the menus discussed).
4. "Objections to answer on the walk", with the proof point at each stop.
5. "The close": what to ask for at the end, and the hold or contract next step.`,
  },
  {
    id: "hosp_counter",
    industries: ["hospitality"],
    phase: "after",
    kind: "negotiate",
    name: "Counter-proposal builder",
    outcome: "Counter options that protect revenue: alternate dates and patterns, rate versus F&B trades, attrition sliding scales, each matched to the planner's priorities.",
    instructions: `Build counter-proposal options to the planner's latest asks.
Sections:
1. "Their asks" as stated.
2. "Options" table: Option | What we offer | What we ask in return | Revenue effect (from stated numbers, or directional) | Why it fits their priorities.
   Cover alternate dates or shoulder nights, pattern shifts, rate versus F&B minimum, a sliding-scale attrition with review dates, concessions tied to pickup or a multi-year commitment.
3. "Recommended counter" and the wording to present it.
All rates and concessions are subject to revenue-management approval; say so.`,
  },
  {
    id: "hosp_beo",
    industries: ["hospitality"],
    phase: "after",
    kind: "document",
    name: "BEO draft",
    outcome: "Banquet event orders for every function, built from what the planner said: times, setups, menus, counts, AV, dietary needs.",
    instructions: `Draft banquet event orders from the calls.
For each function, a section with a table: Field | Detail. Fields: Date, Time, Function, Room, Setup, Guaranteed count (or expected), Menu, Beverage, Dietary & allergies (exactly as said), AV, Décor & signage, Billing notes.
End with "Open items to confirm with the planner".`,
  },
  {
    id: "hosp_rebook",
    industries: ["hospitality"],
    phase: "after",
    kind: "document",
    name: "Rebook & multi-year pitch",
    outcome: "After the event: a personal pitch to book next year (or three), built on what went well and with incentives tied to a multi-year commitment.",
    clientFacing: true,
    instructions: `Write the rebooking pitch to the planner, ready to send.
Sections:
1. "Letter": warm and specific about what went well (from the calls), and what we'll improve.
2. "Proposed dates" for next year (and the year after, if discussed).
3. "Multi-year offer": incentives tied to commitment (rate protection, concessions), marked "subject to approval" where not already agreed.
4. "Next step".`,
  },

  // -------------------------------------------------------------------------
  // New for pharma
  {
    id: "ph_objection_library",
    industries: ["pharma"],
    phase: "before",
    kind: "prep",
    name: "On-label objection handler",
    outcome: "This HCP's objections across every call, with on-label, fair-balanced responses, and which ones belong with medical information instead.",
    instructions: `Build the objection library for this HCP or account.
Sections:
1. "Objections" table: Objection (their words, call date) | Category (efficacy / safety / access / cost / habit / competitor) | On-label response grounded in approved materials on file | Safety information to include | Route to medical information? (yes / no).
2. "Patterns": what keeps coming up, and why.
3. "What to bring next time": approved resources from the deal's files.
Never suggest off-label or comparative claims without approved data.`,
  },
  {
    id: "ph_hcp_profile",
    industries: ["pharma"],
    phase: "before",
    kind: "intel",
    name: "HCP practice profile",
    outcome: "How this provider practises: patient mix, what drives their choices, access realities, office team, and what has changed, all with no patient details.",
    instructions: `Profile this healthcare provider and their practice from the calls (never any patient identifiers).
Sections:
1. "Practice": specialty, setting, patient mix as described.
2. "Decision drivers": what they weigh when choosing a treatment, in their words.
3. "Access realities": the payers and barriers they deal with.
4. "Office team" table: Name | Role | How to work with them.
5. "Communication": the format and length they prefer, and the best times.
6. "What's changed" since the earliest calls.`,
  },
  {
    id: "ph_call_plan",
    industries: ["pharma"],
    phase: "before",
    kind: "prep",
    name: "Three-visit call plan",
    outcome: "The next three visits planned as a sequence: the objective of each, what to bring, the access follow-ups, and how you'll know it's working.",
    instructions: `Plan the next three visits to this HCP or account as a sequence.
"Plan" table: Visit | Objective | Key message (on-label) | Resources to bring | Follow-ups due (medical information, adverse event, access) | Success signal.
Then "Watch-outs": compliance points specific to this HCP's questions so far.`,
  },
  {
    id: "ph_account_plan",
    industries: ["pharma"],
    phase: "after",
    kind: "document",
    name: "Key account plan",
    outcome: "For KAMs: stakeholders, the P&T and protocol path, access status, goals and the action plan for the account.",
    instructions: `Write the key account plan from the calls on this account.
Sections:
1. "Account overview".
2. "Stakeholders" table: Name | Role | Influence | Stance | Needs.
3. "Formulary & protocol path": P&T timing, pathways and order sets, as discussed.
4. "Access status" by payer.
5. "Goals": the next six months.
6. "Action plan" table: Action | Owner | Due.`,
  },

  // -------------------------------------------------------------------------
  // New for tech
  {
    id: "tech_battlecard",
    industries: ["tech"],
    phase: "before",
    kind: "negotiate",
    name: "Deal-specific battlecard",
    outcome: "What this buyer has said about each competitor or the 'build it ourselves' option, the landmines to set, and the proof points that win.",
    instructions: `Build a battlecard for this deal from what the buyer actually said.
For each competitor or alternative (including build-it-yourself and doing nothing), a section with:
- "What they said about it" (quotes).
- "Where we win" for this buyer.
- "Where we're exposed".
- "Landmine questions": questions to ask that highlight the gaps.
- "Proof points": from the files and the team's past answers.
Never claim features or certifications the material doesn't confirm.`,
  },
  {
    id: "tech_exec_brief",
    industries: ["tech"],
    phase: "before",
    kind: "prep",
    name: "Executive sponsor brief",
    outcome: "A one-pager for your executive before an exec-to-exec call: why it matters, their exec's priorities, the ask, and what to avoid.",
    instructions: `Brief your executive before they meet the buyer's executive. Keep it to one page.
Sections:
1. "Why this call matters" (deal size and stage as known).
2. "Their executive": role, priorities, what they've said or care about.
3. "What we need from this call": the one ask.
4. "Talking points": three.
5. "Avoid": topics, promises and sensitivities.
6. "If they ask about…": the two likeliest tough questions, with answers.`,
  },
  {
    id: "tech_legal_prep",
    industries: ["tech"],
    phase: "before",
    kind: "negotiate",
    name: "Legal & procurement prep",
    outcome: "The asks legal and procurement are likely to make (liability, data protection, payment terms, SLAs), with your positions and fallbacks to clear before the call.",
    instructions: `Prepare for the paper process.
Sections:
1. "Expected asks" table: Topic (liability cap, indemnities, DPA and data residency, security addendum, SLA, payment terms, auto-renewal, termination, pricing protection) | What they've signalled (quote or "not yet") | Our standard position | Fallback (needs approval) | Who approves.
2. "Documents to send early".
3. "Timeline risk": steps that could push the close date.
Nothing here is agreed until approved internally; this is prep, not a commitment.`,
  },
  {
    id: "tech_expansion",
    industries: ["tech"],
    phase: "after",
    kind: "intel",
    name: "Expansion map",
    outcome: "For existing customers: the teams, use cases and triggers for growth that have come up in calls, and who to talk to next.",
    instructions: `Map growth opportunities in this account from the calls.
Sections:
1. "Opportunities" table: Team or use case | Evidence (quote) | Size signal | Trigger or timing | Who to talk to.
2. "Risks to the renewal" heard on calls.
3. "Next three plays".`,
  },
];

export const TOOL_BY_ID: Record<string, IndustryTool> = Object.fromEntries(INDUSTRY_TOOLS.map((t) => [t.id, t]));

// The tools a team sees: its industry's, plus the ones for every industry.
export function toolsForIndustry(industry: IndustryKey | null): IndustryTool[] {
  return INDUSTRY_TOOLS.filter((t) => t.industries === "all" || (industry !== null && t.industries.includes(industry)));
}

// What a generated report looks like: titled sections of prose, bullets
// and tables, plus what's still missing to finish it.
export type ToolReport = {
  title: string;
  summary: string;
  sections: {
    heading: string;
    text?: string;
    bullets?: string[];
    table?: { columns: string[]; rows: string[][] };
  }[];
  // Questions to ask or facts to get on the next call to complete this
  // report. Fed into the next live call's checklist.
  gaps: string[];
};

export type SavedToolReport = { report: ToolReport; generatedAt: string };

// The report as Markdown, for copying into email or documents.
export function toolReportMarkdown(report: ToolReport): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const out: string[] = [`# ${report.title}`, "", report.summary];
  for (const s of report.sections) {
    out.push("", `## ${s.heading}`);
    if (s.text) out.push("", s.text);
    if (s.bullets?.length) out.push("", ...s.bullets.map((b) => `- ${b}`));
    if (s.table && s.table.columns.length) {
      out.push("", `| ${s.table.columns.map(cell).join(" | ")} |`, `| ${s.table.columns.map(() => "---").join(" | ")} |`);
      for (const row of s.table.rows) out.push(`| ${s.table.columns.map((_, i) => cell(row[i] ?? "")).join(" | ")} |`);
    }
  }
  if (report.gaps.length) out.push("", "## Still missing (ask on the next call)", "", ...report.gaps.map((g) => `- ${g}`));
  return out.join("\n");
}

// The report as a plain-text email body (Gmail drafts): headings on their
// own lines, and each table row written out as "Column: value" lines,
// which reads better in an email than a Markdown table.
export function toolReportPlainText(report: ToolReport): string {
  const out: string[] = [report.summary];
  for (const s of report.sections) {
    out.push("", s.heading.toUpperCase());
    if (s.text) out.push(s.text);
    if (s.bullets?.length) out.push(...s.bullets.map((b) => `• ${b}`));
    if (s.table?.columns.length) {
      for (const row of s.table.rows) {
        out.push("", ...s.table.columns.map((c, i) => `${c}: ${row[i] ?? ""}`).filter((line) => !/:\s*$/.test(line)));
      }
    }
  }
  return out.join("\n").trim();
}
