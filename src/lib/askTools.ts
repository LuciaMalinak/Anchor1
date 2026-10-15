import { getGoogleConnection } from "@/lib/integrations/google";
import { fetchRelevantDriveDocuments, hasDriveAccess } from "@/lib/integrations/drive";
import { fetchRelevantDropboxDocuments, getDropboxConnection } from "@/lib/integrations/dropbox";
import { formatDocumentContext, type DocumentContextItem } from "@/lib/integrations/documentSearch";
import type { ServerTool } from "@/lib/liveAssist";

// Live lookups Ask Anchor can run mid-answer for the person asking (see
// ServerTool in liveAssist.ts), plus the system prompt lines that tell it
// what's connected. Shared by every Ask Anchor surface: the workspace and
// meeting panel (/api/ask) and a deal's panel (/api/deals/[id]/assist).

// Fewer, longer excerpts than the background deal-context refresh: the
// person is asking about something specific (a forecast, a contract), so
// the numbers deep in that one file matter more than a skim of many.
const SEARCH_MAX_DOCUMENTS = 4;
const SEARCH_EXCERPT_CHARS = 6_000;

const WHEN_TO_SEARCH =
  "Use it whenever they ask about a document, deck, spreadsheet, forecast, model, proposal, contract or notes, or about a number or fact that could live in a file — before answering from memory or saying you can't find it. Use short queries: a key term or two, a file name, or a company name. If nothing matches, try a different or shorter query.";

function fileSearchTool(params: {
  name: string;
  source: DocumentContextItem["source"];
  searches: string;
  fetch: (query: string, opts: { maxDocuments: number; excerptChars: number }) => Promise<DocumentContextItem[]>;
}): ServerTool {
  return {
    tool: {
      name: params.name,
      description: `Search the person's connected ${params.source} ${params.searches}, and read the best matches (most recently edited first). ${WHEN_TO_SEARCH}`,
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
      const docs = await params.fetch(query, { maxDocuments: SEARCH_MAX_DOCUMENTS, excerptChars: SEARCH_EXCERPT_CHARS });
      return formatDocumentContext(docs) ?? `No files in ${params.source} matched "${query}".`;
    },
  };
}

export async function loadAskTools(userId: string): Promise<{ serverTools: ServerTool[]; toolRules: string }> {
  const [google, dropbox] = await Promise.all([
    getGoogleConnection(userId).catch(() => null),
    getDropboxConnection(userId).catch(() => null),
  ]);
  const serverTools: ServerTool[] = [];
  const connected: string[] = [];
  const missing: string[] = [];

  if (google && hasDriveAccess(google.scope)) {
    serverTools.push(
      fileSearchTool({
        name: "search_drive",
        source: "Google Drive",
        searches: "by file name and full text",
        fetch: (query, opts) => fetchRelevantDriveDocuments(userId, query, opts),
      })
    );
    const account = google.externalAccountEmail ? ` (${google.externalAccountEmail})` : "";
    connected.push(`Google Drive${account}, searched with search_drive`);
  } else {
    missing.push("Google Drive");
  }

  if (dropbox) {
    serverTools.push(
      fileSearchTool({
        name: "search_dropbox",
        source: "Dropbox",
        // Content search depends on the person's Dropbox plan.
        searches: "by file name (and by contents on Dropbox plans that index them)",
        fetch: (query, opts) => fetchRelevantDropboxDocuments(userId, query, opts),
      })
    );
    const account = dropbox.externalAccountEmail ? ` (${dropbox.externalAccountEmail})` : "";
    connected.push(`Dropbox${account}, searched with search_dropbox`);
  } else {
    missing.push("Dropbox");
  }

  const rules: string[] = [];
  if (connected.length) {
    rules.push(
      `Connected file storage: ${connected.join("; ")}. Search it whenever the question could be answered by a file${
        connected.length > 1 ? " (search both when you don't know where the file is)" : ""
      }, and answer from what you find, naming the file and linking it. Never tell the person you can't access their files, and never ask them to paste or describe a file's contents before searching for it. If a couple of different searches find nothing, say what you searched for and ask what the file is called.`
    );
  }
  if (missing.length) {
    rules.push(
      `${missing.join(" and ")} ${missing.length > 1 ? "aren't" : "isn't"} connected for this person, so you can't search ${
        missing.length > 1 ? "them" : "it"
      }. If they ask about a file there, tell them to connect it on the Integrations page.`
    );
  }
  return { serverTools, toolRules: `\n\n${rules.join("\n\n")}` };
}
