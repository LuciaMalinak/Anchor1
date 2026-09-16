import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { deals, meetings, summaries } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

// Same tool-use pattern as summarize.ts, applied across a whole team's
// deals instead of one meeting — this is what powers the Insights page.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local"
    );
  }
  return new Anthropic({ apiKey });
}

export type DealForInsights = {
  name: string;
  stage: string;
  memory: string | null;
  lastMeetingOverview: string | null;
  lastMeetingAt: string | null;
};

export type InsightsResult = {
  patterns: string[];
  atRisk: { dealName: string; reason: string }[];
  commonThemes: string[];
};

const INSIGHTS_TOOL = {
  name: "record_pipeline_insights",
  description: "Record patterns and risks noticed across a team's whole set of deals.",
  input_schema: {
    type: "object" as const,
    properties: {
      patterns: {
        type: "array",
        items: { type: "string" },
        description:
          "2-5 concrete patterns or trends visible across multiple deals (e.g. a recurring objection, a stage several deals are stuck in). Specific and grounded — cite deal names where useful. Empty array if there isn't enough data yet.",
      },
      atRisk: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dealName: { type: "string" },
            reason: {
              type: "string",
              description: "One concrete, factual reason this deal looks like it needs attention — not a guess.",
            },
          },
          required: ["dealName", "reason"],
        },
        description: "Deals that look stalled, going quiet, or otherwise worth a second look. Empty array if none stand out.",
      },
      commonThemes: {
        type: "array",
        items: { type: "string" },
        description: "2-5 short themes/topics that keep coming up across deals (e.g. 'pricing sensitivity', 'integration concerns'). Empty array if there isn't enough data yet.",
      },
    },
    required: ["patterns", "atRisk", "commonThemes"],
  },
};

export async function generateInsights(dealsData: DealForInsights[]): Promise<InsightsResult> {
  const dealsBlock = dealsData
    .map((d) => {
      const parts = [`Deal: ${d.name}`, `Stage: ${d.stage}`];
      if (d.memory) parts.push(`What's known so far: ${d.memory}`);
      if (d.lastMeetingOverview) parts.push(`Most recent meeting: ${d.lastMeetingOverview}`);
      if (d.lastMeetingAt) parts.push(`Last meeting date: ${d.lastMeetingAt}`);
      else parts.push("No finished meetings yet.");
      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You analyze a sales/account team's pipeline across multiple deals to surface real, grounded patterns — never invent facts, numbers, or risks that aren't supported by what you were given. If there isn't enough information yet, say so via empty arrays rather than padding with generic advice.",
    tools: [INSIGHTS_TOOL],
    tool_choice: { type: "tool", name: INSIGHTS_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Here is the current state of every deal on this team:\n\n${dealsBlock}\n\nAnalyze for patterns across the whole pipeline.`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return structured insights.");
  }

  return sanitizeInsights(toolUse.input);
}

// A forced tool call is usually well-shaped, but not guaranteed — seen in
// practice returning atRisk as plain strings instead of {dealName, reason}
// objects. Normalize rather than trust it blindly, since a malformed shape
// here renders as a blank card instead of failing loudly.
function sanitizeInsights(raw: unknown): InsightsResult {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const patterns = Array.isArray(input.patterns)
    ? input.patterns.filter((p): p is string => typeof p === "string")
    : [];

  const commonThemes = Array.isArray(input.commonThemes)
    ? input.commonThemes.filter((t): t is string => typeof t === "string")
    : [];

  const atRiskRaw = Array.isArray(input.atRisk) ? input.atRisk : [];
  const atRisk = atRiskRaw
    .map((item): { dealName: string; reason: string } | null => {
      if (typeof item === "string") return { dealName: item, reason: "" };
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        if (typeof obj.dealName === "string") {
          return { dealName: obj.dealName, reason: typeof obj.reason === "string" ? obj.reason : "" };
        }
      }
      return null;
    })
    .filter((x): x is { dealName: string; reason: string } => x !== null);

  return { patterns, atRisk, commonThemes };
}

// Shared by the /api/insights route (client-triggered refresh) and the
// Insights page (server-rendered on first load, so there's no
// client-side effect firing a fetch the instant the page mounts).
export async function getTeamInsights(
  teamId: string
): Promise<{ insights: InsightsResult; dealCount: number }> {
  const teamDeals = await db.select().from(deals).where(eq(deals.teamId, teamId));

  if (teamDeals.length === 0) {
    return { insights: { patterns: [], atRisk: [], commonThemes: [] }, dealCount: 0 };
  }

  const dealsForInsights: DealForInsights[] = await Promise.all(
    teamDeals.map(async (deal) => {
      const [latest] = await db
        .select({ meeting: meetings, summary: summaries })
        .from(meetings)
        .innerJoin(summaries, eq(summaries.meetingId, meetings.id))
        .where(and(eq(meetings.dealId, deal.id), eq(meetings.status, "ready")))
        .orderBy(desc(meetings.occurredAt))
        .limit(1);

      return {
        name: deal.name,
        stage: deal.stage,
        memory: deal.memory,
        lastMeetingOverview: latest?.summary.overview ?? null,
        lastMeetingAt: latest?.meeting.occurredAt.toLocaleDateString() ?? null,
      };
    })
  );

  const hasAnyData = dealsForInsights.some((d) => d.memory || d.lastMeetingOverview);
  if (!hasAnyData) {
    return {
      insights: { patterns: [], atRisk: [], commonThemes: [] },
      dealCount: teamDeals.length,
    };
  }

  const insights = await generateInsights(dealsForInsights);
  return { insights, dealCount: teamDeals.length };
}
