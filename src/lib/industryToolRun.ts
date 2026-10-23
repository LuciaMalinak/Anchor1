import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealFiles, deals, meetings, summaries, teams, transcripts } from "@/db/schema";
import { meteredFetch } from "./aiUsage";
import { createWithForcedTool } from "./forcedTool";
import { buildDealToolContext } from "./dealToolContext";
import { isIndustryKey, INDUSTRY_BY_KEY, type IndustryKey } from "./industries";
import { teamPlaybook, toolsForTeam } from "./teamSpecialty";
import { relevantAnswers, playbookText } from "./answerPlaybook";
import { getDealLeadStyle } from "./styleProfile";
import type { IndustryTool, SavedToolReport, ToolReport } from "./industryTools";
import { withAiUser } from "./aiUsage";

// Writes one industry tool's report for a deal (see industryTools.ts) and
// saves it on the deal, so the team sees the latest one and its gaps can
// steer the next live call. Same model as the other batch features:
// quality matters more than speed here.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// A deal's whole call history, not just the last three calls the deal
// brief uses: a buyer log or promise ledger is only right if it sees
// every call. Bounded so a long-running deal still fits.
const MEETINGS_LIMIT = 30;
const MEETING_CHARS = 2500;
const FILES_CHARS = 24000;
const TRANSCRIPT_CHARS = 40000;

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local"
    );
  }
  return new Anthropic({ apiKey, fetch: meteredFetch("industry_tools") });
}

const REPORT_TOOL: Anthropic.Tool = {
  name: "record_report",
  description: "Record the finished report.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "The report's title, naming the deal." },
      summary: { type: "string", description: "Two or three sentences: the bottom line a busy senior person reads first." },
      sections: {
        type: "array",
        description: "The report's sections, in the order the instructions give. Use a table wherever the instructions ask for one.",
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            text: { type: "string", description: "Prose, when the section is prose. Plain text, no Markdown." },
            bullets: { type: "array", items: { type: "string" } },
            table: {
              type: "object",
              properties: {
                columns: { type: "array", items: { type: "string" } },
                rows: { type: "array", items: { type: "array", items: { type: "string" } } },
              },
              required: ["columns", "rows"],
            },
          },
          required: ["heading"],
        },
      },
      gaps: {
        type: "array",
        items: { type: "string" },
        description:
          "What this report is still missing, each written as a short question or ask for the next call (e.g. 'Ask Dana for last year's room pickup'). Up to 8, most important first. Empty if nothing's missing.",
      },
    },
    required: ["title", "summary", "sections", "gaps"],
  },
};

function clip(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// What a team's tools and reports are built from: its industry, its own
// specialty if it has one, the playbook that follows from those, and the
// full list of tools it can use.
export async function teamToolContext(teamId: string) {
  const [team] = await db.select({ industry: teams.industry, specialty: teams.specialty }).from(teams).where(eq(teams.id, teamId));
  const industry: IndustryKey | null = team?.industry && isIndustryKey(team.industry) ? team.industry : null;
  const specialty = team?.specialty ?? null;
  return { industry, specialty, playbook: teamPlaybook(industry, specialty), tools: toolsForTeam(industry, specialty) };
}

// Everything the report draws on: the deal tool context (memory, notes,
// people, tasks, email and documents), every call's summary with its
// industry deal sheet, the deal's files, and the latest transcript when
// the tool needs exact words.
async function reportContext(deal: typeof deals.$inferSelect, tool: IndustryTool): Promise<string> {
  const [{ context }, calls, files] = await Promise.all([
    buildDealToolContext(deal),
    db
      .select({ meeting: meetings, summary: summaries })
      .from(meetings)
      .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
      .where(and(eq(meetings.dealId, deal.id), eq(meetings.status, "ready")))
      .orderBy(desc(meetings.occurredAt))
      .limit(MEETINGS_LIMIT),
    db.select({ fileName: dealFiles.fileName, extractedText: dealFiles.extractedText }).from(dealFiles).where(eq(dealFiles.dealId, deal.id)),
  ]);

  const parts = [context];

  if (calls.length) {
    const lines = calls
      .slice()
      .reverse()
      .map(({ meeting, summary }) => {
        const bits = [
          `### ${meeting.title} (${meeting.occurredAt.toISOString().slice(0, 10)})`,
          summary.overview,
          summary.keyPoints.length ? `Key points:\n${summary.keyPoints.map((p) => `- ${p}`).join("\n")}` : "",
          summary.industryFacts?.length ? `Deal sheet:\n${summary.industryFacts.map((f) => `- ${f.label}: ${f.value}`).join("\n")}` : "",
          summary.actionItems.length
            ? `Action items:\n${summary.actionItems.map((a) => `- ${a.text}${a.owner ? ` (${a.owner})` : ""}`).join("\n")}`
            : "",
          summary.complianceFlags?.length
            ? `Flagged for review:\n${summary.complianceFlags.map((f) => `- ${f.rule}: ${f.detail}`).join("\n")}`
            : "",
        ];
        return clip(bits.filter(Boolean).join("\n"), MEETING_CHARS);
      });
    parts.push(`Every call on this deal, oldest first:\n\n${lines.join("\n\n")}`);
  } else {
    parts.push("No finished calls on this deal yet.");
  }

  let budget = FILES_CHARS;
  const fileText: string[] = [];
  for (const f of files) {
    if (!f.extractedText || budget <= 0) continue;
    const t = clip(f.extractedText, Math.min(budget, 12000));
    budget -= t.length;
    fileText.push(`### ${f.fileName}\n${t}`);
  }
  if (fileText.length) parts.push(`Files attached to this deal:\n\n${fileText.join("\n\n")}`);

  if (tool.needsTranscript && calls[0]) {
    const [t] = await db.select({ fullText: transcripts.fullText, utterances: transcripts.utterances }).from(transcripts).where(eq(transcripts.meetingId, calls[0].meeting.id));
    const text = t?.utterances?.length ? t.utterances.map((u) => `${u.speakerLabel}: ${u.text}`).join("\n") : t?.fullText;
    parts.push(
      text
        ? `Transcript of the latest call, "${calls[0].meeting.title}" on ${calls[0].meeting.occurredAt.toISOString().slice(0, 10)} (speech-to-text: expect misheard words):\n${clip(text, TRANSCRIPT_CHARS)}`
        : "No transcript is available for the latest call."
    );
  }

  // How the deal lead operates, so stand-in and prep tools sound like them.
  const leadStyle = await getDealLeadStyle(deal.leadUserId ?? null, { allowSynchronousRebuild: false }).catch(() => null);
  if (leadStyle) parts.push(`How the deal lead operates (their style, phrases and how they decide): ${leadStyle}`);

  // What the team has said before about this kind of thing, for tools that
  // answer questions (security prefill, management meeting prep).
  const answers = await relevantAnswers(deal.teamId, deal.id, `${tool.name} ${tool.outcome}`).catch(() => []);
  if (answers.length) parts.push(playbookText(answers));

  return parts.join("\n\n");
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function normalizeReport(raw: unknown, fallbackTitle: string): ToolReport {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sections = Array.isArray(r.sections) ? r.sections : [];
  return {
    title: str(r.title, 200) || fallbackTitle,
    summary: str(r.summary, 2000),
    sections: sections
      .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
      .map((s) => {
        const table = s.table && typeof s.table === "object" ? (s.table as Record<string, unknown>) : null;
        const columns = Array.isArray(table?.columns) ? table.columns.map((c) => str(c, 120)) : [];
        const rows = Array.isArray(table?.rows)
          ? table.rows.filter(Array.isArray).map((row: unknown[]) => columns.map((_, i) => str(row[i], 1500)))
          : [];
        return {
          heading: str(s.heading, 200),
          text: str(s.text, 6000) || undefined,
          bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => str(b, 1500)).filter(Boolean) : undefined,
          table: columns.length ? { columns, rows } : undefined,
        };
      })
      .filter((s) => s.heading),
    gaps: Array.isArray(r.gaps) ? r.gaps.map((g) => str(g, 300)).filter(Boolean).slice(0, 8) : [],
  };
}

export async function runIndustryTool(deal: typeof deals.$inferSelect, tool: IndustryTool): Promise<SavedToolReport> {
  const { industry, specialty, playbook } = await teamToolContext(deal.teamId);
  const context = await reportContext(deal, tool);

  const sector = specialty
    ? `${specialty.companyName}, in ${specialty.sectorName.toLowerCase()} (${specialty.summary})`
    : industry
      ? `a team in ${INDUSTRY_BY_KEY[industry].label.toLowerCase()} (${playbook?.focus.toLowerCase()})`
      : null;
  const expert = playbook
    ? `You are ${playbook.persona}, writing for ${sector}. Use this business's own terms. Rules people in this business must keep: ${playbook.guardrails.map((g) => `${g.label} (${g.rule})`).join("; ")}.`
    : "You are a senior deal professional writing for the team that owns this deal.";

  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 12000,
    system: `${expert}

You write the work products experts in this business make by hand, from the deal's real record: its calls, files, emails and notes. Rules:
- Use only facts in the material. Never invent a name, number, date, price, term or quote. Where something the report needs isn't known, write "not stated" (or the specific "need: …") in place, and add it to gaps as a question for the next call.
- Be specific: real names, figures and dates, quotes where they help.
- Follow the section structure you're given; use tables where it asks for them, with every row having a value for every column.
- Write plainly, for a busy senior reader. No filler, no Markdown inside text.`,
    tools: [REPORT_TOOL],
    tool_choice: { type: "tool", name: REPORT_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Write the "${tool.name}" for the deal "${deal.name}".

What it's for: ${tool.outcome}

What it must contain:
${tool.instructions}

The deal's record:

${context}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("The model didn't return a report.");
  if (message.stop_reason === "max_tokens") console.warn(`[industry tools] ${tool.id} hit max_tokens — using what came back`);

  const saved: SavedToolReport = {
    report: normalizeReport(toolUse.input, `${tool.name}: ${deal.name}`),
    generatedAt: new Date().toISOString(),
  };

  // Read-modify-write of one key; two people running different tools on
  // the same deal at the same moment is rare enough not to need a lock,
  // and jsonb_set keeps each write to its own key.
  await db
    .update(deals)
    .set({ toolReports: sqlSetKey(tool.id, saved) })
    .where(eq(deals.id, deal.id));

  return saved;
}

function sqlSetKey(key: string, value: SavedToolReport) {
  return sql`jsonb_set(coalesce(${deals.toolReports}, '{}'::jsonb), ${`{${key}}`}::text[], ${JSON.stringify(value)}::jsonb, true)`;
}

// Autopilot: after each call on a deal, rewrite the reports the team has
// already used there, so a buyer log or MEDDPICC scorecard is always
// current without anyone clicking Update. Most recently used first, a few
// at most per call, one at a time.
const AUTOPILOT_MAX = 6;

export async function refreshDealReports(dealId: string, userId: string): Promise<number> {
  try {
    const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
    const saved = deal?.toolReports ?? {};
    if (!deal || !Object.keys(saved).length) return 0;
    const available = new Map((await teamToolContext(deal.teamId)).tools.map((t) => [t.id, t]));
    const toRun = Object.entries(saved)
      .sort(([, a], [, b]) => b.generatedAt.localeCompare(a.generatedAt))
      .map(([id]) => available.get(id))
      .filter((t): t is IndustryTool => Boolean(t))
      .slice(0, AUTOPILOT_MAX);
    let done = 0;
    for (const tool of toRun) {
      try {
        // Re-read each time: the previous report updated the row.
        const [fresh] = await db.select().from(deals).where(eq(deals.id, dealId));
        if (!fresh) break;
        await withAiUser({ userId }, () => runIndustryTool(fresh, tool));
        done++;
      } catch (err) {
        console.error(`[industry tools] autopilot ${tool.id} failed on ${dealId}:`, err);
      }
    }
    if (done) console.log(`[industry tools] autopilot refreshed ${done} report(s) on ${dealId}`);
    return done;
  } catch (err) {
    console.error(`[industry tools] autopilot failed on ${dealId}:`, err);
    return 0;
  }
}
