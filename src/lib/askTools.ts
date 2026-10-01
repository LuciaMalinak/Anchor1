import { getGoogleConnection } from "@/lib/integrations/google";
import { fetchRelevantDriveDocuments, hasDriveAccess } from "@/lib/integrations/drive";
import { formatDocumentContext } from "@/lib/integrations/documentSearch";
import type { ServerTool } from "@/lib/liveAssist";

// Live lookups Ask Anchor can run mid-answer for the person asking (see
// ServerTool in liveAssist.ts), plus the system prompt lines that tell it
// what's connected. Shared by every Ask Anchor surface: the workspace and
// meeting panel (/api/ask) and a deal's panel (/api/deals/[id]/assist).

// Fewer, longer excerpts than the background deal-context refresh: the
// person is asking about something specific (a forecast, a contract), so
// the numbers deep in that one file matter more than a skim of many.
const DRIVE_MAX_DOCUMENTS = 4;
const DRIVE_EXCERPT_CHARS = 6_000;

function driveTool(userId: string): ServerTool {
  return {
    tool: {
      name: "search_drive",
      description:
        "Search the person's connected Google Drive by file name and full text, and read the best matches (most recently edited first). Use it whenever they ask about a document, deck, spreadsheet, forecast, model, proposal, contract or notes, or about a number or fact that could live in a file — before answering from memory or saying you can't find it. Use short queries: a key term or two, a file name, or a company name. If nothing matches, try a different or shorter query.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "A short search term, e.g. \"2027 forecast\" or \"Oro\"." },
        },
        required: ["query"],
      },
    },
    async run(input) {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) return "No query given.";
      const docs = await fetchRelevantDriveDocuments(userId, query, {
        maxDocuments: DRIVE_MAX_DOCUMENTS,
        excerptChars: DRIVE_EXCERPT_CHARS,
      });
      return formatDocumentContext(docs) ?? `No files in Google Drive matched "${query}".`;
    },
  };
}

export async function loadAskTools(userId: string): Promise<{ serverTools: ServerTool[]; toolRules: string }> {
  const connection = await getGoogleConnection(userId).catch(() => null);
  if (connection && hasDriveAccess(connection.scope)) {
    const account = connection.externalAccountEmail ? ` (${connection.externalAccountEmail})` : "";
    return {
      serverTools: [driveTool(userId)],
      toolRules: `\n\nGoogle Drive: connected${account}. Search it with search_drive whenever the question could be answered by a file, and answer from what you find, naming the file and linking it. Never tell the person you can't access their Drive, and never ask them to paste or describe a file's contents before searching for it. If a couple of different searches find nothing, say what you searched for and ask what the file is called.`,
    };
  }
  return {
    serverTools: [],
    toolRules:
      "\n\nGoogle Drive isn't connected for this person (or Drive access wasn't granted), so you can't search it. If they ask about a file in Drive, tell them to connect Google Drive on the Integrations page.",
  };
}
