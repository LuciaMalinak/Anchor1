import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  users,
  teams,
  deals,
  contacts,
  meetings,
  transcripts,
  summaries,
  meetingParticipants,
  tasks,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

// LOCAL-ONLY demo-content seeder for recording the product-demo video.
// Never deployed to production — not referenced from render.yaml, not
// committed. Fills in a fully fictional, multi-account, multi-quarter
// history for a given already-signed-up account, so the demo can show
// what Anchor looks like after real, sustained use (a year-old flagship
// account plus a couple of newer ones in the pipeline) rather than a
// single, thin, just-created deal. Never touches a single real
// customer's data.
const SEED_KEY = "local-demo-only";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== SEED_KEY) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const email = req.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "?email=... required" }, { status: 400 });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user || !user.teamId) {
    return NextResponse.json({ error: "Sign up with that email first" }, { status: 400 });
  }
  const teamId = user.teamId;

  // Back-date the account itself so the home feed's "joined the team"
  // entry sits at the start of the story, not above seven months of
  // history that supposedly predates it.
  await db.update(users).set({ createdAt: daysAgo(215) }).where(eq(users.id, user.id));
  await db.update(teams).set({ name: "Acme Robotics (demo)" }).where(eq(teams.id, teamId));

  // Idempotency check: if the flagship deal's newest meeting already
  // exists, assume the whole seed already ran and bail out early.
  const [already] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.userId, user.id), eq(meetings.title, "Acme Robotics — EMEA Expansion Discussion")));
  if (already) {
    return NextResponse.json({ ok: true, already: true });
  }

  // ---------------------------------------------------------------------
  // Deal A (the flagship account): a year-long relationship from first
  // call to a signed, growing, 40-seat rollout now discussing expansion.
  // ---------------------------------------------------------------------
  const [dealA] = await db
    .insert(deals)
    .values({
      teamId,
      name: "Acme Robotics — Platform Rollout",
      stage: "Closed won",
      primaryContactName: "Jordan Weiss",
      primaryContactRole: "VP of Engineering",
      primaryContactEmail: "jordan.weiss@acmerobotics-demo.com",
      companyWebsite: "https://acmerobotics-demo.com",
      notes:
        "Champion is Jordan (VP Eng) — brought Anchor in originally and still drives the account. Economic buyer is Priya Shah, CTO; she cleared the original security review and is now the one weighing the EMEA data-residency question. Signed at 40 seats; can offer up to 15% off list at this volume without approval. EMEA expansion pricing can match the existing per-seat rate. Any new integration work (Slack, SSO/SAML) needs a check with Lucia first.",
      memory:
        "Acme Robotics builds warehouse picking robots. What started as a single kickoff call about cutting down manual call notes for their 40-person customer success team turned into a signed deal within two months, once Jordan cleared it with Priya (CTO) and their security team signed off on SOC 2. Seven months in, adoption is strong — 35 of the 40 team members are active users, and the recap emails are the most-cited win in every check-in. The conversation has shifted from onboarding to growth: Jordan and Priya are now asking about a ~10-seat expansion for a new EMEA team, a Slack integration for deal alerts, and whether call data can stay in-region for EU team members.",
      decisionBoundaries:
        "Can offer up to 15% off list at this volume without approval. EMEA expansion can be priced at the existing per-seat rate. Custom SSO/SAML or new integrations (e.g. Slack) require checking with Lucia first. EU data residency commitments need a real answer from engineering before promising anything to Priya.",
      createdByUserId: user.id,
      leadUserId: user.id,
      createdAt: daysAgo(212),
      updatedAt: daysAgo(2),
    })
    .returning();

  const [jordan] = await db
    .insert(contacts)
    .values({
      userId: user.id,
      name: "Jordan Weiss",
      email: "jordan.weiss@acmerobotics-demo.com",
      company: "Acme Robotics",
      role: "VP of Engineering",
      relationshipSummary:
        "Jordan is the internal champion who first brought Anchor to Acme Robotics and has driven the account from a single kickoff call to a company-wide rollout across all 40 team members. Practical and fast-moving — now pushing for an EMEA expansion and a Slack integration.",
      meetingCount: 4,
      firstMetAt: daysAgo(210),
      lastMeetingAt: daysAgo(2),
      createdAt: daysAgo(210),
      updatedAt: daysAgo(2),
    })
    .returning();

  const [priya] = await db
    .insert(contacts)
    .values({
      userId: user.id,
      name: "Priya Shah",
      email: "priya.shah@acmerobotics-demo.com",
      company: "Acme Robotics",
      role: "Chief Technology Officer",
      relationshipSummary:
        "Priya is Acme Robotics's CTO and the final sign-off on security and budget. She cleared the original SOC 2 review and is now weighing the data-residency requirements for the EMEA expansion.",
      meetingCount: 2,
      firstMetAt: daysAgo(150),
      lastMeetingAt: daysAgo(2),
      createdAt: daysAgo(150),
      updatedAt: daysAgo(2),
    })
    .returning();

  async function addMeeting(opts: {
    dealId: string;
    title: string;
    occurredAtDays: number;
    durationSeconds: number;
    participants: { label: string; contactId?: string; name: string }[];
    utterances: { speakerLabel: string; text: string; startMs: number; endMs: number }[];
    overview: string;
    keyPoints: string[];
    actionItems: { text: string; owner: string | null }[];
    continuityNote?: string;
    dealSignals: { type: "buying_signal" | "risk" | "blocker"; detail: string }[];
  }) {
    const occurredAt = daysAgo(opts.occurredAtDays);
    const [meeting] = await db
      .insert(meetings)
      .values({
        userId: user.id,
        dealId: opts.dealId,
        title: opts.title,
        occurredAt,
        status: "ready",
        durationSeconds: opts.durationSeconds,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      })
      .returning();

    await db.insert(meetingParticipants).values(
      opts.participants.map((p) => ({
        meetingId: meeting.id,
        contactId: p.contactId,
        speakerLabel: p.label,
        displayName: p.name,
      }))
    );

    await db.insert(transcripts).values({
      meetingId: meeting.id,
      provider: "assemblyai",
      fullText: opts.utterances.map((u) => u.text).join(" "),
      utterances: opts.utterances,
      createdAt: occurredAt,
    });

    await db.insert(summaries).values({
      meetingId: meeting.id,
      overview: opts.overview,
      keyPoints: opts.keyPoints,
      actionItems: opts.actionItems,
      continuityNote: opts.continuityNote ?? null,
      dealSignals: opts.dealSignals,
      createdAt: occurredAt,
    });

    return meeting;
  }

  const m1 = await addMeeting({
    dealId: dealA.id,
    title: "Acme Robotics — Kickoff Call",
    occurredAtDays: 210,
    durationSeconds: 1620,
    participants: [
      { label: "Speaker A", contactId: jordan.id, name: "Jordan Weiss" },
      { label: "Speaker B", name: "Sam Rivera (you)" },
    ],
    utterances: [
      { speakerLabel: "Speaker B", text: "Thanks for making time, Jordan — I know you've got a packed week. Want to start with what's prompting the search for something like Anchor?", startMs: 0, endMs: 6200 },
      { speakerLabel: "Speaker A", text: "Yeah, no problem. Honestly it's pretty simple — our team spends a good chunk of every day just writing up call notes and updating the CRM by hand, and half of it never gets written down at all.", startMs: 6400, endMs: 16000 },
      { speakerLabel: "Speaker B", text: "That's exactly the gap Anchor's built for. It joins the call, transcribes it, and writes the recap and action items automatically — and it keeps a running memory per account so the next call already has context.", startMs: 16400, endMs: 27000 },
      { speakerLabel: "Speaker A", text: "That memory piece is actually the part I care most about. We've got forty people on the team and constant account handoffs — every time someone leaves or a deal changes owners, we lose context.", startMs: 27400, endMs: 38000 },
      { speakerLabel: "Speaker B", text: "Makes sense — that's the handoff briefing feature. It pulls together the deal history, decision boundaries, and open items into one page whoever's picking it up can read in two minutes.", startMs: 38400, endMs: 48500 },
      { speakerLabel: "Speaker A", text: "Good. Two blockers on my end: pricing at our seat count, and our security team is going to ask about SOC 2 before this goes anywhere.", startMs: 49000, endMs: 58000 },
      { speakerLabel: "Speaker B", text: "Both very fair. I can get you our SOC 2 documentation this week, and on pricing — at 40 seats you'd qualify for our volume tier, I can put a real number in front of you by Friday.", startMs: 58400, endMs: 69000 },
      { speakerLabel: "Speaker A", text: "That works. If the security review clears, I think I can get this in front of Priya, our CTO, for final sign-off.", startMs: 69400, endMs: 77000 },
      { speakerLabel: "Speaker B", text: "Perfect — let's plan on looping her in once the SOC 2 docs are in hand. I'll send those over today along with the pricing by Friday.", startMs: 77400, endMs: 85000 },
    ],
    overview:
      "Kickoff call with Jordan Weiss (VP of Engineering, Acme Robotics) to explore Anchor for their 40-person customer success team. Strong initial interest — the core pain point is manual call notes and lost context on account handoffs. Two open items before this can move forward: SOC 2 documentation for their security review, and volume pricing at their seat count.",
    keyPoints: [
      "Acme's 40-person team currently writes up call notes by hand, and a lot of it never makes it into the CRM.",
      "Jordan is most interested in Anchor's per-account memory and handoff briefings — they have frequent account reassignments.",
      "Security review (SOC 2) and volume pricing are the two remaining blockers before this can go to the CTO for sign-off.",
    ],
    actionItems: [
      { text: "Send Jordan Weiss Anchor's SOC 2 documentation", owner: "Sam Rivera" },
      { text: "Put together volume pricing for 40 seats", owner: "Sam Rivera" },
    ],
    dealSignals: [
      { type: "buying_signal", detail: "Explicitly framed this as solving a real, recurring pain point for the whole team, not just \"nice to have.\"" },
      { type: "risk", detail: "Final approval depends on a security review (SOC 2) that hasn't started yet." },
      { type: "blocker", detail: "Pricing at their seat count hasn't been shared yet — needs to land before the CTO conversation." },
    ],
  });

  await addMeeting({
    dealId: dealA.id,
    title: "Acme Robotics — Security & Pricing Follow-up",
    occurredAtDays: 150,
    durationSeconds: 1500,
    participants: [
      { label: "Speaker A", contactId: jordan.id, name: "Jordan Weiss" },
      { label: "Speaker B", contactId: priya.id, name: "Priya Shah" },
      { label: "Speaker C", name: "Sam Rivera (you)" },
    ],
    utterances: [
      { speakerLabel: "Speaker C", text: "Priya, thanks for joining — Jordan mentioned your security team finished going through the SOC 2 report.", startMs: 0, endMs: 7000 },
      { speakerLabel: "Speaker B", text: "We did, and it was thorough enough for us — no follow-up questions. My only real question left is pricing at our volume.", startMs: 7400, endMs: 16500 },
      { speakerLabel: "Speaker C", text: "At 40 seats you'd qualify for our volume tier — I can offer 15% off list, which puts you right in line with what I quoted Jordan.", startMs: 17000, endMs: 26000 },
      { speakerLabel: "Speaker A", text: "That matches what I was expecting. If Priya's good with it, I think we're ready to move.", startMs: 26400, endMs: 33000 },
      { speakerLabel: "Speaker B", text: "I'm good with it. One thing — where does call data actually live? Just want that on record for our own audit trail.", startMs: 33400, endMs: 41500 },
      { speakerLabel: "Speaker C", text: "All in encrypted storage in the US, covered under the same SOC 2 report you already reviewed — nothing outside that boundary today.", startMs: 42000, endMs: 51000 },
      { speakerLabel: "Speaker B", text: "Good, that's all I needed. I'll get procurement moving on a PO this week.", startMs: 51400, endMs: 58000 },
      { speakerLabel: "Speaker A", text: "I'll loop in our CS team so onboarding is ready to go as soon as the PO clears.", startMs: 58400, endMs: 64000 },
    ],
    overview:
      "Follow-up call with Jordan and Priya Shah (CTO) to close out the two open items from the kickoff. Priya's security team cleared the SOC 2 review with no follow-up questions, and 15% volume pricing at 40 seats was agreed on the call. Priya will start procurement on a PO this week; Jordan is looping in Acme's CS team to prep onboarding.",
    keyPoints: [
      "SOC 2 review passed with no follow-up questions from Acme's security team.",
      "15% volume discount at 40 seats agreed verbally by both Jordan and Priya.",
      "Priya asked one clarifying question about data residency/storage, satisfied by the existing SOC 2 boundary.",
    ],
    actionItems: [
      { text: "Get a signed PO from Acme Robotics procurement", owner: "Priya Shah" },
      { text: "Loop in Acme's CS team ahead of onboarding", owner: "Jordan Weiss" },
    ],
    continuityNote:
      "Picks up exactly where the kickoff call left off: both blockers flagged there (SOC 2 review, volume pricing) are resolved on this call, with Priya now directly engaged for the first time.",
    dealSignals: [
      { type: "buying_signal", detail: "CTO explicitly signed off verbally and is starting procurement paperwork the same week." },
    ],
  });

  await addMeeting({
    dealId: dealA.id,
    title: "Acme Robotics — Quarterly Business Review",
    occurredAtDays: 45,
    durationSeconds: 1400,
    participants: [
      { label: "Speaker A", contactId: jordan.id, name: "Jordan Weiss" },
      { label: "Speaker B", name: "Sam Rivera (you)" },
    ],
    utterances: [
      { speakerLabel: "Speaker B", text: "Good to see you, Jordan — it's been a few months since rollout. How's adoption looking?", startMs: 0, endMs: 6500 },
      { speakerLabel: "Speaker A", text: "Really strong, actually — 35 of our 40 people are using it regularly. The recap emails are the thing people mention most; it's saved a ton of admin time.", startMs: 6800, endMs: 17000 },
      { speakerLabel: "Speaker B", text: "That's great to hear. Any friction points on the other 5, or anything the team's asked for?", startMs: 17400, endMs: 23500 },
      { speakerLabel: "Speaker A", text: "Mainly one thing — some people still take calls by phone instead of Zoom, and those don't get captured at all. Not a dealbreaker, just a gap.", startMs: 24000, endMs: 33000 },
      { speakerLabel: "Speaker B", text: "Good to know, I'll flag that as product feedback. Anything else on your radar?", startMs: 33400, endMs: 38500 },
      { speakerLabel: "Speaker A", text: "Actually yes — we're standing up a small EMEA team next quarter, maybe 10 people. And a few people have asked if Anchor can post deal alerts into Slack.", startMs: 39000, endMs: 49000 },
      { speakerLabel: "Speaker B", text: "Both very doable to talk through. Let's set up time once the EMEA team's headcount is firmer, and I'll look into the Slack integration timeline in the meantime.", startMs: 49400, endMs: 58500 },
    ],
    overview:
      "Quarterly check-in seven months into the rollout. Adoption is strong — 35 of 40 team members active, recap emails cited as the top win. One product gap noted (calls taken by phone aren't captured). Jordan raised two forward-looking items: a ~10-seat EMEA expansion planned for next quarter, and interest in a Slack integration for deal alerts.",
    keyPoints: [
      "35 of 40 seats are active users seven months in; recap emails are the most-cited benefit.",
      "Gap identified: calls taken by phone rather than Zoom/Teams/Meet aren't captured today.",
      "Jordan flagged two expansion signals: a new ~10-seat EMEA team next quarter, and requested Slack alerts.",
    ],
    actionItems: [
      { text: "Look into capturing notes from non-Zoom (phone) calls", owner: "Sam Rivera" },
    ],
    continuityNote:
      "First check-in since onboarding closed out the prior call's PO — this is the account's first quarterly business review, several months into active use rather than a sales conversation.",
    dealSignals: [
      { type: "buying_signal", detail: "Unprompted mention of a ~10-seat EMEA expansion next quarter, plus a specific feature request (Slack)." },
      { type: "blocker", detail: "Phone calls aren't currently captured, leaving a gap for people who don't use Zoom/Teams/Meet." },
    ],
  });

  await addMeeting({
    dealId: dealA.id,
    title: "Acme Robotics — EMEA Expansion Discussion",
    occurredAtDays: 2,
    durationSeconds: 1560,
    participants: [
      { label: "Speaker A", contactId: jordan.id, name: "Jordan Weiss" },
      { label: "Speaker B", contactId: priya.id, name: "Priya Shah" },
      { label: "Speaker C", name: "Sam Rivera (you)" },
    ],
    utterances: [
      { speakerLabel: "Speaker A", text: "Thanks for hopping on — the EMEA team is confirmed now, 10 people starting next quarter, and we'd like to get them onto Anchor from day one.", startMs: 0, endMs: 8500 },
      { speakerLabel: "Speaker C", text: "Great news. Pricing-wise I can match your existing per-seat rate for those 10 — I'll send over a formal quote today.", startMs: 8800, endMs: 17000 },
      { speakerLabel: "Speaker B", text: "One thing I need before I can sign off: those team members are EU-based. Can you confirm their call data stays in-region, or does everything still route through the US?", startMs: 17400, endMs: 27500 },
      { speakerLabel: "Speaker C", text: "Good question — today everything's processed in the US under our existing SOC 2 boundary. Let me get you a definitive answer on EU data residency rather than guess.", startMs: 28000, endMs: 38000 },
      { speakerLabel: "Speaker B", text: "Appreciate it — I'll loop in our own legal team on our end too, just so we're aligned before anyone signs anything.", startMs: 38400, endMs: 46000 },
      { speakerLabel: "Speaker A", text: "And separately — any update on the Slack integration I asked about last quarter? A few people have asked again.", startMs: 46400, endMs: 53500 },
      { speakerLabel: "Speaker C", text: "It's on our roadmap — I'll find out the actual timing and get back to you with a real date instead of \"soon.\"", startMs: 54000, endMs: 61500 },
      { speakerLabel: "Speaker A", text: "That works. Once we've got the data residency answer and a quote, I think we can move fast on this.", startMs: 62000, endMs: 68000 },
    ],
    overview:
      "Jordan and Priya requested a formal ~10-seat expansion for Acme's new EMEA team starting next quarter. Priya's sign-off is conditional on confirming EU data residency for those team members' call data — a real open question, not yet answered. Jordan also re-raised the Slack integration request from the last quarterly review. Two concrete follow-ups are now owed: a pricing quote, and a straight answer on data residency and the Slack integration timeline.",
    keyPoints: [
      "Formal request: ~10 additional seats for a new EMEA team, starting next quarter.",
      "Priya's approval is conditional on EU data residency for those team members — currently everything processes in the US.",
      "Slack integration request (first raised last quarter) came up again — people are asking for it directly.",
    ],
    actionItems: [
      { text: "Send EMEA expansion pricing quote (10 seats)", owner: "Sam Rivera" },
      { text: "Confirm Slack integration roadmap timing for Acme Robotics", owner: "Sam Rivera" },
      { text: "Loop in Acme's EU legal team on data residency", owner: "Jordan Weiss" },
    ],
    continuityNote:
      "Directly follows up on two threads from the last quarterly review: the EMEA team Jordan mentioned as a possibility is now a confirmed, funded expansion, and the Slack request has come up again — this time with a specific ask for a real timeline.",
    dealSignals: [
      { type: "buying_signal", detail: "Concrete, funded expansion request (10 EMEA seats) rather than a hypothetical — Jordan wants to move fast." },
      { type: "risk", detail: "Priya's sign-off is explicitly conditional on an EU data-residency answer that doesn't exist yet." },
    ],
  });

  await db.insert(tasks).values([
    { teamId, dealId: dealA.id, text: "Send Jordan Weiss Anchor's SOC 2 documentation", ownerLabel: "Sam Rivera", source: "meeting", sourceMeetingId: m1.id, completed: true, completedAt: daysAgo(205), createdAt: daysAgo(210) },
    { teamId, dealId: dealA.id, text: "Put together volume pricing for Acme Robotics (40 seats)", ownerLabel: "Sam Rivera", source: "meeting", sourceMeetingId: m1.id, completed: true, completedAt: daysAgo(202), createdAt: daysAgo(210) },
    { teamId, dealId: dealA.id, text: "Look into capturing notes from non-Zoom (phone) calls", ownerLabel: "Sam Rivera", source: "meeting", completed: true, completedAt: daysAgo(38), createdAt: daysAgo(45) },
    { teamId, dealId: dealA.id, text: "Send EMEA expansion pricing quote (10 seats)", ownerLabel: "Sam Rivera", source: "meeting", completed: false, createdAt: daysAgo(2) },
    { teamId, dealId: dealA.id, text: "Confirm Slack integration roadmap timing for Acme Robotics", ownerLabel: "Sam Rivera", source: "meeting", completed: false, createdAt: daysAgo(2) },
  ]);

  // ---------------------------------------------------------------------
  // Deal B & C: a couple of newer, earlier-stage accounts in the pipeline
  // alongside the flagship one, so the deals list and dashboard read like
  // a real book of business rather than a single client.
  // ---------------------------------------------------------------------
  const [dealB] = await db
    .insert(deals)
    .values({
      teamId,
      name: "Globex Industries — New Business",
      stage: "Qualifying",
      primaryContactName: "Morgan Lee",
      primaryContactRole: "Director of Sales Operations",
      primaryContactEmail: "morgan.lee@globex-demo.com",
      companyWebsite: "https://globex-demo.com",
      notes: "Inbound from a webinar. Pain point is messy handoffs between teammates, not note-taking per se — lead with the handoff briefing feature.",
      memory:
        "Globex Industries makes industrial sensors. Morgan Lee (Director of Sales Ops) took an initial discovery call interested primarily in Anchor's handoff briefings — team members hand off accounts to each other frequently and lose context every time. Early stage; a proposal is the next step.",
      createdByUserId: user.id,
      leadUserId: user.id,
      createdAt: daysAgo(8),
      updatedAt: daysAgo(8),
    })
    .returning();

  const [morgan] = await db
    .insert(contacts)
    .values({
      userId: user.id,
      name: "Morgan Lee",
      email: "morgan.lee@globex-demo.com",
      company: "Globex Industries",
      role: "Director of Sales Operations",
      relationshipSummary: "Morgan took an initial discovery call and is mainly evaluating Anchor's handoff briefings for messy handoffs between teammates.",
      meetingCount: 1,
      firstMetAt: daysAgo(8),
      lastMeetingAt: daysAgo(8),
      createdAt: daysAgo(8),
      updatedAt: daysAgo(8),
    })
    .returning();

  await addMeeting({
    dealId: dealB.id,
    title: "Globex Industries — Discovery Call",
    occurredAtDays: 8,
    durationSeconds: 1260,
    participants: [
      { label: "Speaker A", contactId: morgan.id, name: "Morgan Lee" },
      { label: "Speaker B", name: "Sam Rivera (you)" },
    ],
    utterances: [
      { speakerLabel: "Speaker B", text: "Morgan, thanks for the time — what's prompting you to look at something like Anchor right now?", startMs: 0, endMs: 6000 },
      { speakerLabel: "Speaker A", text: "Mainly handoffs. Every time an account moves from one teammate to another, half the context gets lost and the customer has to repeat themselves.", startMs: 6400, endMs: 15000 },
      { speakerLabel: "Speaker B", text: "That's one of the things Anchor's handoff briefings are built for — pulls the deal history into one page whoever's picking it up can read in a couple minutes.", startMs: 15400, endMs: 24500 },
      { speakerLabel: "Speaker A", text: "That would solve a real problem for us. Can you put together a proposal so I can bring it to my VP?", startMs: 25000, endMs: 31000 },
      { speakerLabel: "Speaker B", text: "Absolutely, I'll get one over to you this week.", startMs: 31400, endMs: 34500 },
    ],
    overview:
      "Discovery call with Morgan Lee (Director of Sales Ops, Globex Industries), inbound from a webinar. Core pain point is context loss when an account moves from one teammate to another. Morgan asked for a proposal to bring to their VP.",
    keyPoints: [
      "Primary pain point is handoffs, not note-taking — Anchor's handoff briefing feature is the clear fit.",
      "Morgan needs a proposal to socialize internally with their VP.",
    ],
    actionItems: [{ text: "Send Globex Industries a proposal deck", owner: "Sam Rivera" }],
    dealSignals: [{ type: "buying_signal", detail: "Asked directly for a proposal to bring to their VP — a real next step, not just information gathering." }],
  });

  await db.insert(tasks).values([
    { teamId, dealId: dealB.id, text: "Send Globex Industries a proposal deck", ownerLabel: "Sam Rivera", source: "meeting", completed: false, createdAt: daysAgo(8) },
  ]);

  const [dealC] = await db
    .insert(deals)
    .values({
      teamId,
      name: "Initech — Renewal",
      stage: "Negotiation",
      primaryContactName: "Casey Tran",
      primaryContactRole: "RevOps Lead",
      primaryContactEmail: "casey.tran@initech-demo.com",
      companyWebsite: "https://initech-demo.com",
      notes: "First renewal. Headcount shrank since original signing — expect a request to true down seats.",
      memory:
        "Initech is up for its first annual renewal. Usage has been solid, but their team shrank from 20 to roughly 16 people over the year, and Casey Tran (RevOps Lead) is asking for the renewal to reflect that rather than renewing flat.",
      createdByUserId: user.id,
      leadUserId: user.id,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
    })
    .returning();

  const [casey] = await db
    .insert(contacts)
    .values({
      userId: user.id,
      name: "Casey Tran",
      email: "casey.tran@initech-demo.com",
      company: "Initech",
      role: "RevOps Lead",
      relationshipSummary: "Casey manages the Initech renewal and is requesting the seat count be trued down from 20 to about 16 to match current headcount.",
      meetingCount: 1,
      firstMetAt: daysAgo(4),
      lastMeetingAt: daysAgo(4),
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
    })
    .returning();

  await addMeeting({
    dealId: dealC.id,
    title: "Initech — Renewal Check-in",
    occurredAtDays: 4,
    durationSeconds: 1320,
    participants: [
      { label: "Speaker A", contactId: casey.id, name: "Casey Tran" },
      { label: "Speaker B", name: "Sam Rivera (you)" },
    ],
    utterances: [
      { speakerLabel: "Speaker B", text: "Casey, good to catch up — overall, how's the past year with Anchor been for the team?", startMs: 0, endMs: 6000 },
      { speakerLabel: "Speaker A", text: "Genuinely good, no complaints on the product. The one thing is our team shrank from 20 people to about 16 over the year, so I'd like the renewal to reflect that.", startMs: 6400, endMs: 17500 },
      { speakerLabel: "Speaker B", text: "That's fair, and totally doable — I can true the seat count down to 16 for the renewal term.", startMs: 18000, endMs: 25000 },
      { speakerLabel: "Speaker A", text: "Great, that's really all I needed. Send over the updated contract and I can get it signed this week.", startMs: 25400, endMs: 32000 },
    ],
    overview:
      "Annual renewal check-in with Casey Tran (RevOps Lead). No product complaints — the only change is Initech's team shrinking from 20 to 16 people over the year, so Casey asked for the renewal to be trued down to match. Agreed on the call; Casey is ready to sign once the updated contract goes out.",
    keyPoints: [
      "No product or satisfaction issues raised — this is a straightforward true-down, not a save.",
      "Headcount dropped from 20 to 16 people over the year; renewal should reflect 16 seats.",
    ],
    actionItems: [{ text: "Send Initech the renewal contract for signature", owner: "Sam Rivera" }],
    dealSignals: [{ type: "risk", detail: "Renewal seat count is dropping from 20 to 16 — a true-down, not an expansion, though the account itself is healthy." }],
  });

  await db.insert(tasks).values([
    { teamId, dealId: dealC.id, text: "Send Initech the renewal contract for signature", ownerLabel: "Sam Rivera", source: "meeting", completed: false, createdAt: daysAgo(4) },
  ]);

  return NextResponse.json({ ok: true, dealId: dealA.id });
}
