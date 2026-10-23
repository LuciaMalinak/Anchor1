import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { meteredFetch } from "./aiUsage";
import { createWithForcedTool } from "./forcedTool";
import { INDUSTRY_BY_KEY, isIndustryKey } from "./industries";
import type { IndustryPlaybook } from "./industryPlaybooks";
import { toolsForIndustry, type ToolKind, type ToolPhase } from "./industryTools";
import type { SpecialtyTool, TeamSpecialty } from "./teamSpecialty";

// Builds a team's own specialty from its website (teamSpecialty.ts): first
// researches what the company actually does, with web search, then has an
// expert in exactly that business write the playbook Anchor coaches with
// and 8-12 tools made for their work. Like companyResearch.ts, it looks
// at the company only, never at individual people.

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const KINDS: ToolKind[] = ["standin", "prep", "intel", "negotiate", "document", "compliance", "track"];
const PHASES: ToolPhase[] = ["before", "after"];

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  return new Anthropic({ apiKey, fetch: meteredFetch("specialty_builder") });
}

function normalizeWebsite(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return url.origin + (url.pathname === "/" ? "" : url.pathname);
  } catch {
    return null;
  }
}

async function research(website: string | null, description: string, industryLabel: string | null): Promise<string> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 3000,
    system:
      "You research a company so an expert can design tools for the people who work there. Use web search and the company's own website. Research the company and its market only, never individual employees. State only what you find; say plainly when something isn't public.",
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    messages: [
      {
        role: "user",
        content: `Research this company${website ? ` (${website})` : ""}${industryLabel ? `, which works in ${industryLabel.toLowerCase()}` : ""}.${
          description ? `\nWhat they say they do: ${description}` : ""
        }

Then write plain-text notes (no markdown) covering:
- Company name, and exactly what they do: services, niche, positioning, scale, geography.
- Who they work for and with: clients, counterparties, partners, and the kind of meetings their people have.
- The deals or engagements they run, how money is made, and what's at stake in a typical one.
- The metrics, documents, contracts and frameworks of their niche.
- The regulations, ethics and confidentiality rules that matter in their work.
- The jargon of their niche.
- What's hard about their work right now (market pressures, recent news about the company).`,
      },
    ],
  });
  const notes = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!notes) {
    throw new Error(
      message.stop_reason === "pause_turn"
        ? "Researching the website took too long. Try again, or add a description of what you do."
        : "Couldn't find anything about the company. Check the website, or add a description of what you do."
    );
  }
  return notes;
}

const SPECIALTY_TOOL: Anthropic.Tool = {
  name: "record_specialty",
  description: "Record the team's specialty: who they are, the playbook for their calls, and the tools made for them.",
  input_schema: {
    type: "object",
    properties: {
      companyName: { type: "string" },
      sectorName: { type: "string", description: "Their niche in a few words, e.g. 'Ultra-luxury hotel asset management'." },
      summary: { type: "string", description: "Two or three sentences on what they do and for whom." },
      focus: { type: "string", description: "Who Anchor sits beside on their calls, e.g. 'Asset managers representing owners of ultra-luxury hotels in calls with operators, brands and lenders'." },
      persona: { type: "string", description: "The expert Anchor acts as: 'a ... with 20 years of ... who knows ... cold'." },
      counterparties: { type: "string", description: "Who is usually on the other side of their calls." },
      pains: {
        type: "array",
        description: "5-6 real struggles of people doing this exact work, each with what Anchor does about it.",
        items: {
          type: "object",
          properties: { pain: { type: "string" }, anchor: { type: "string" } },
          required: ["pain", "anchor"],
        },
      },
      checklist: { type: "array", items: { type: "string" }, description: "6-8 things a strong call in their business always covers (short labels)." },
      listenFor: { type: "array", items: { type: "string" }, description: "6-8 moments in their calls worth reacting to live." },
      guardrails: {
        type: "array",
        description: "3-6 rules people in this business must not break on a call (confidentiality, regulation, authority limits).",
        items: {
          type: "object",
          properties: { label: { type: "string" }, rule: { type: "string" } },
          required: ["label", "rule"],
        },
      },
      captureFields: {
        type: "array",
        description: "6-10 facts their deal sheet tracks per deal or account, filled from calls.",
        items: {
          type: "object",
          properties: { label: { type: "string" }, hint: { type: "string" } },
          required: ["label", "hint"],
        },
      },
      vocabulary: { type: "array", items: { type: "string" }, description: "15-30 terms of their niche that speech-to-text mishears." },
      tools: {
        type: "array",
        description:
          "10-14 expert tools made for exactly this business. The core, at least 5, are kind 'standin': tools that let any employee step in for the CEO or deal lead in this niche's specific meetings and run them as the lead would. Then at least 3 time-savers (kind 'document') and the rest expert tools for reading counterparties, negotiating and preparing.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short, specific name." },
            kind: { type: "string", enum: KINDS },
            phase: { type: "string", enum: PHASES, description: "before = used to prepare for a call; after = written from calls." },
            outcome: { type: "string", description: "What you get, in one line, in their language." },
            outline: {
              type: "string",
              description: "The report's sections in one line, e.g. 'Positions by budget line; GM's likely pushbacks; owner's answers; what must come back to the owner'.",
            },
            clientFacing: { type: "boolean", description: "True if it's written to send to the client or counterparty." },
            needsTranscript: { type: "boolean", description: "True if it depends on exact wording from the latest call." },
          },
          required: ["name", "kind", "phase", "outcome", "outline"],
        },
      },
    },
    required: [
      "companyName",
      "sectorName",
      "summary",
      "focus",
      "persona",
      "counterparties",
      "pains",
      "checklist",
      "listenFor",
      "guardrails",
      "captureFields",
      "vocabulary",
      "tools",
    ],
  },
};

// Second step: the full brief for each tool, written separately so one
// answer never has to hold the whole playbook and every tool's brief.
const INSTRUCTIONS_TOOL: Anthropic.Tool = {
  name: "record_tool_instructions",
  description: "Record what each tool's report must contain.",
  input_schema: {
    type: "object",
    properties: {
      tools: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The tool's name, exactly as given." },
            instructions: {
              type: "string",
              description:
                "What the report must contain: numbered sections, with the exact table columns where a table fits, written as a top expert would brief an analyst. Say to use only facts from the deal's calls, files and emails, and to write 'need: ...' for anything unknown. 80-200 words.",
            },
          },
          required: ["name", "instructions"],
        },
      },
    },
    required: ["tools"],
  },
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function strs(v: unknown, maxItems: number, maxLen: number): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
}
function pairs<K extends string>(v: unknown, a: K, b: K, maxItems: number): Record<K, string>[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
        .map((x) => ({ [a]: str(x[a], 400), [b]: str(x[b], 600) }) as Record<K, string>)
        .filter((x) => x[a] && x[b])
        .slice(0, maxItems)
    : [];
}
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "tool";
}

export async function buildTeamSpecialty(teamId: string, input: { website?: string | null; description?: string | null }): Promise<TeamSpecialty> {
  const [team] = await db
    .select({ name: teams.name, industry: teams.industry, companyWebsite: teams.companyWebsite, companyContext: teams.companyContext })
    .from(teams)
    .where(eq(teams.id, teamId));
  if (!team) throw new Error("Team not found.");
  // Anything not given this time falls back to what the team saved: the
  // website from sign-up, and the context from the Profile page.
  const website = normalizeWebsite(input.website || team.companyWebsite);
  const description = str(input.description || team.companyContext, 4000);
  if (!website && !description) throw new Error("Add the company's website or a line about what they do.");
  const industry = team.industry && isIndustryKey(team.industry) ? team.industry : null;
  const industryLabel = industry ? INDUSTRY_BY_KEY[industry].label : null;

  const notes = await research(website, description, industryLabel);
  const existing = toolsForIndustry(industry).map((t) => t.name).join(", ");

  const message = await createWithForcedTool(client(), {
    model: MODEL,
    max_tokens: 16000,
    system: `You are the most experienced practitioner in this company's exact niche, and you design tools for people who do that work every day. Anchor joins their client and counterparty calls, remembers every call, email and file on each deal, coaches them live, and writes reports from that record with one click.

Design their specialty. Be specific to their niche, not their broad industry: the tools must use the documents, metrics, contracts and negotiations that only people in this niche deal with, and each should save a senior person hours or catch something that would cost them money.

Anchor's core purpose: any employee can step in for the CEO or deal lead and run the meeting the way the lead would. That's what matters most; everything else is an add-on. So:
- Most important, kind "standin" (at least 5): tools that let a colleague cover the lead in THIS niche's specific meetings (for example, for hotel asset management: covering the owner's seat in an operator budget review, a brand PIP negotiation, a lender call). Each gives the stand-in the lead's positions and red lines for that kind of meeting, the lead's answers in their own words, the numbers they must know cold, what they may agree to and what must come back to the lead, and how to read the people in the room. Note: everyone already gets general stand-in tools (Stand-in brief, How the lead decides, Answer like the lead, Live cover sheet, Relationship handover, Debrief for the lead), so make these specific to this niche's meeting types.
- Then time-savers (kind "document"): the reports, updates, memos and trackers of their trade, written from what was said.
- Then expert tools for reading counterparties, negotiating and preparing.

Think past ordinary note-taking. Strong tools:
- read between the lines across months of calls (shifts in a counterparty's position, unkept promises, early signs of trouble)
- rehearse them against the toughest people they face
- model a negotiation's options and the likely reaction to each
- draft the documents of their trade from what was said
- benchmark what they're told against what they should expect
- protect them from the rules they could break on a call
They already have these general tools, so don't repeat them: ${existing || "none"}.

Never design anything that profiles or researches private individuals, or that would require breaking confidentiality or regulation.`,
    tools: [SPECIALTY_TOOL],
    tool_choice: { type: "tool", name: SPECIALTY_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Research notes on the company:\n\n${notes}${description ? `\n\nHow they describe what they do: ${description}` : ""}${
          industryLabel ? `\n\nTheir broad industry in Anchor: ${industryLabel}.` : ""
        }`,
      },
    ],
  });
  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("Couldn't design the specialty.");
  const r = toolUse.input as Record<string, unknown>;

  if (message.stop_reason === "max_tokens") console.warn("[specialty] design reply hit max_tokens — using what came back");

  const used = new Set<string>();
  const designed = (Array.isArray(r.tools) ? r.tools : [])
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
    .map((t) => {
      const name = str(t.name, 80);
      let id = `x_${slug(name)}`;
      while (used.has(id)) id += "_2";
      used.add(id);
      return {
        id,
        name,
        kind: KINDS.includes(t.kind as ToolKind) ? (t.kind as ToolKind) : "intel",
        phase: PHASES.includes(t.phase as ToolPhase) ? (t.phase as ToolPhase) : "after",
        outcome: str(t.outcome, 300),
        outline: str(t.outline, 600),
        clientFacing: t.clientFacing === true,
        needsTranscript: t.needsTranscript === true,
      };
    })
    .filter((t) => t.name && t.outcome)
    .slice(0, 14);
  if (!designed.length) throw new Error("The AI didn't design any tools. Try again, or add more context about what you do.");

  // Step two: each tool's full brief. If it falls short, a tool still gets
  // working instructions built from its outline.
  const briefs = new Map<string, string>();
  try {
    const second = await createWithForcedTool(client(), {
      model: MODEL,
      max_tokens: 16000,
      system: `You are the most experienced practitioner in this niche: ${str(r.sectorName, 120) || "their business"} (${str(r.summary, 600)}). Write the brief for each of these Anchor tools. Each report is written from a deal's calls, files and emails. Stand-in tools ("standin") must let a colleague run that kind of meeting exactly as the lead would: positions, red lines, the lead's answers in their own words, numbers to know, what may be agreed and what must come back to the lead.`,
      tools: [INSTRUCTIONS_TOOL],
      tool_choice: { type: "tool", name: INSTRUCTIONS_TOOL.name },
      messages: [
        {
          role: "user",
          content: designed.map((t) => `- ${t.name} [${t.kind}, ${t.phase} the call]: ${t.outcome}${t.outline ? ` Sections: ${t.outline}` : ""}`).join("\n"),
        },
      ],
    });
    const use = second.content.find((b) => b.type === "tool_use");
    const list = use && use.type === "tool_use" ? ((use.input as { tools?: unknown }).tools as unknown[]) ?? [] : [];
    for (const x of list) {
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        const text = str(o.instructions, 4000);
        if (text) briefs.set(str(o.name, 80).toLowerCase(), text);
      }
    }
  } catch (err) {
    console.error("[specialty] writing tool briefs failed, using outlines:", err);
  }

  const tools: SpecialtyTool[] = designed.map(({ outline, ...t }) => ({
    ...t,
    instructions:
      briefs.get(t.name.toLowerCase()) ??
      `Write the "${t.name}" for this deal: ${t.outcome}
Sections: ${outline || "the findings, a table of the key items with their sources, and the next steps"}.
Use only facts from the deal's calls, files and emails; write "need: …" for anything not known.`,
  }));

  const playbook: IndustryPlaybook = {
    focus: str(r.focus, 300),
    persona: str(r.persona, 400),
    counterparties: str(r.counterparties, 400),
    pains: pairs(r.pains, "pain", "anchor", 6) as { pain: string; anchor: string }[],
    checklist: strs(r.checklist, 8, 80),
    listenFor: strs(r.listenFor, 8, 200),
    guardrails: pairs(r.guardrails, "label", "rule", 6) as { label: string; rule: string }[],
    captureFields: pairs(r.captureFields, "label", "hint", 10) as { label: string; hint: string }[],
    vocabulary: strs(r.vocabulary, 30, 60),
  };
  if (!playbook.focus || !playbook.persona) throw new Error("The AI's answer was incomplete. Try again.");

  const specialty: TeamSpecialty = {
    website,
    companyName: str(r.companyName, 120) || team.name,
    sectorName: str(r.sectorName, 120),
    summary: str(r.summary, 600),
    playbook,
    tools,
    generatedAt: new Date().toISOString(),
  };
  await db.update(teams).set({ specialty }).where(eq(teams.id, teamId));
  return specialty;
}

export async function clearTeamSpecialty(teamId: string) {
  await db.update(teams).set({ specialty: null }).where(eq(teams.id, teamId));
}
