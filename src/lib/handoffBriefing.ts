import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get a key at https://console.anthropic.com and add it to .env.local"
    );
  }
  return new Anthropic({ apiKey });
}

const HANDOFF_TOOL = {
  name: "record_handoff_briefing",
  description:
    "Record a structured briefing for someone else stepping in to run this deal's next meeting.",
  input_schema: {
    type: "object" as const,
    properties: {
      whatWasDecided: {
        type: "string",
        description:
          "2-4 sentences: what has actually been agreed, confirmed, or decided on this deal so far. Facts and commitments, not tasks or hopes. If little has been decided yet, say so plainly.",
      },
      whatToPushOn: {
        type: "string",
        description:
          "2-4 sentences: the open action items and what's blocking this deal from moving forward — what this meeting needs to accomplish to advance it.",
      },
      focusAreas: {
        type: "string",
        description:
          "2-3 sentences of tactical guidance for walking into this specific meeting: the stakeholder's known concerns or objections to be ready for, and anything to avoid getting derailed by.",
      },
      personalTouches: {
        type: "string",
        description:
          "1-3 sentences of small, human details about the people on the other side worth remembering when stepping in — personal interests, family mentioned in passing, how they like to communicate, anything that helps someone new build rapport instead of walking in cold. Draw only from what's given (contact relationship notes, meeting notes) — never invent a personal detail. If nothing like that is known yet, say so plainly rather than making something up.",
      },
    },
    required: ["whatWasDecided", "whatToPushOn", "focusAreas", "personalTouches"],
  },
};

export type HandoffBriefingResult = {
  whatWasDecided: string;
  whatToPushOn: string;
  focusAreas: string;
  personalTouches: string;
};

export async function generateHandoffBriefing(params: {
  dealName: string;
  stage: string | null;
  memory: string | null;
  notes: string | null;
  people: {
    name: string;
    role: string | null;
    company: string | null;
    relationshipSummary: string | null;
    notes: string | null;
  }[];
  recentMeetings: {
    title: string;
    occurredAt: string;
    overview: string;
    keyPoints: string[];
    actionItems: { text: string; owner: string | null }[];
  }[];
  // How the deal's actual lead tends to negotiate, decide, and
  // communicate (see src/lib/styleProfile.ts) — null if no lead is set,
  // or there isn't enough of their own material yet. This is the whole
  // point of a handoff: focusAreas and whatToPushOn should read like
  // guidance from THEM, not generic sales advice.
  leadStyle?: string | null;
}): Promise<HandoffBriefingResult> {
  const meetingsBlock =
    params.recentMeetings.length > 0
      ? params.recentMeetings
          .map((m) => {
            const items = m.actionItems.map((a) => a.text + (a.owner ? ` (${a.owner})` : "")).join("; ");
            return `— ${m.title} (${m.occurredAt})\n${m.overview}\nKey points: ${m.keyPoints.join("; ") || "None"}\nAction items: ${items || "None"}`;
          })
          .join("\n\n")
      : "No finished meetings yet.";

  const peopleBlock =
    params.people.length > 0
      ? params.people
          .map((p) => {
            const roleCompany = [p.role, p.company].filter(Boolean).join(", ");
            const lines = [`— ${p.name}${roleCompany ? ` (${roleCompany})` : ""}`];
            if (p.relationshipSummary) lines.push(`What Anchor knows: ${p.relationshipSummary}`);
            if (p.notes) lines.push(`Manual notes: ${p.notes}`);
            return lines.join("\n");
          })
          .join("\n\n")
      : "No one resolved yet on the other side.";

  const leadStyleBlock = params.leadStyle
    ? `\n\nHow the deal lead actually operates — write focusAreas and whatToPushOn to match this, not generic sales advice:\n${params.leadStyle}`
    : "";

  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 700,
    system:
      "You brief a colleague who is stepping in to run someone else's sales meeting. Be specific and grounded only in what you're given — never invent commitments, numbers, facts, or personal details that weren't provided.",
    tools: [HANDOFF_TOOL],
    tool_choice: { type: "tool", name: HANDOFF_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Deal: ${params.dealName}${params.stage ? ` — Stage: ${params.stage}` : ""}

Rolling deal memory (what Anchor has learned so far):
${params.memory || "Nothing recorded yet."}

Owner's own notes:
${params.notes || "None."}

People on the other side:
${peopleBlock}

Recent meetings:
${meetingsBlock}${leadStyleBlock}

Produce a handoff briefing for someone else running the next meeting on this deal.`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Anchor didn't return a handoff briefing.");
  }

  // Defensive: forced tool_choice isn't a 100% schema guarantee (see
  // insights.ts) — fall back to empty strings rather than crashing on an
  // unexpected shape.
  const raw = toolUse.input as Partial<HandoffBriefingResult>;
  return {
    whatWasDecided: typeof raw.whatWasDecided === "string" ? raw.whatWasDecided : "",
    whatToPushOn: typeof raw.whatToPushOn === "string" ? raw.whatToPushOn : "",
    focusAreas: typeof raw.focusAreas === "string" ? raw.focusAreas : "",
    personalTouches: typeof raw.personalTouches === "string" ? raw.personalTouches : "",
  };
}
