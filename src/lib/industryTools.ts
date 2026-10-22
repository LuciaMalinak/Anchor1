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

export type IndustryTool = {
  id: string;
  // Which industries see it; "all" for every team, including teams with
  // no industry set.
  industries: IndustryKey[] | "all";
  phase: ToolPhase;
  name: string;
  // What you get, in one line. Shown on the button card and the industry page.
  outcome: string;
  // What the report must contain, for the model. Written as an expert in
  // that business would brief a new analyst.
  instructions: string;
  // Gets the latest call's transcript too, for tools where the exact words
  // matter (adverse events, medical information requests, language review).
  needsTranscript?: boolean;
};

export const INDUSTRY_TOOLS: IndustryTool[] = [
  // -------------------------------------------------------------------------
  // Every industry
  {
    id: "promise_ledger",
    industries: "all",
    phase: "after",
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
