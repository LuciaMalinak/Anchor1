import Anthropic from "@anthropic-ai/sdk";

// Every structured AI call in Anchor (summaries, deal memory, follow-up
// emails, insights, handoffs, style profiles…) gets its JSON back by
// forcing a single tool call with tool_choice { type: "tool" }. Newer
// models (Sonnet 5.5, Opus 5.5, Fable 5.1) reject a forced tool_choice
// with a 400, so pointing ANTHROPIC_MODEL at one of them used to break
// all of these at once. This keeps the forced call (still the most
// reliable on models that allow it) and, if the model rejects the
// request, retries once with tool_choice "auto" plus an instruction to
// call the tool.
//
// The retry also raises max_tokens: those newer models think before
// answering by default, and several of these calls had budgets of only
// 500-700 tokens — enough for the tool call alone, not for reasoning
// first, so the call would come back cut off.
const RETRY_MIN_MAX_TOKENS = 4096;

type ForcedToolParams = Anthropic.MessageCreateParamsNonStreaming & {
  tool_choice: Anthropic.ToolChoiceTool;
};

function withInstruction(
  system: ForcedToolParams["system"],
  instruction: string
): ForcedToolParams["system"] {
  if (!system) return instruction;
  if (typeof system === "string") return `${system}\n\n${instruction}`;
  return [...system, { type: "text", text: instruction }];
}

export async function createWithForcedTool(
  client: Anthropic,
  params: ForcedToolParams
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(params);
  } catch (err) {
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    console.warn(
      `[ai] ${params.model} rejected a forced ${params.tool_choice.name} call, retrying with tool_choice auto:`,
      err.message
    );
    return client.messages.create({
      ...params,
      max_tokens: Math.max(params.max_tokens, RETRY_MIN_MAX_TOKENS),
      tool_choice: { type: "auto" },
      system: withInstruction(params.system, `Always respond by calling the ${params.tool_choice.name} tool.`),
    });
  }
}
