import { AsyncLocalStorage } from "node:async_hooks";
import { aiUsage } from "@/db/schema";

// Records what every paid AI and transcription call actually used and
// cost (see aiUsage in schema.ts), so the admin page can show real spend
// per member. Anthropic usage is read straight off each API response by
// meteredFetch below — streamed or not — so call sites only need to give
// their client a feature label. Who it's for comes from withAiUser() when
// the caller sets it (live calls, meeting processing, Ask Anchor), and
// otherwise from whoever is signed in on the current request.

// Anthropic list prices, USD per million tokens. Most specific prefix
// first. Cache writes cost 1.25x input and cache reads 0.1x input.
const ANTHROPIC_PRICES: [prefix: string, input: number, output: number][] = [
  ["claude-haiku-4-5", 1, 5],
  ["claude-haiku-3-5", 0.8, 4],
  ["claude-sonnet-5", 2, 10], // Sonnet 5 and 5.5
  ["claude-sonnet-4", 3, 15],
  ["claude-opus-5-5", 4, 20],
  ["claude-opus-5", 5, 25],
  ["claude-opus-4", 5, 25],
  ["claude-fable", 10, 50],
  ["claude-mythos", 10, 50],
];
// Used for a model not in the list above, so it's never counted as free.
const FALLBACK_PRICE: [number, number] = [3, 15];
const WEB_SEARCH_USD = 10 / 1000;

// AssemblyAI, USD per audio hour. Overridable because these weren't
// checked against AssemblyAI's live pricing page when this was written.
const TRANSCRIPTION_USD_PER_HOUR = Number(process.env.ASSEMBLYAI_USD_PER_HOUR) || 0.17;
const STREAMING_USD_PER_HOUR = Number(process.env.ASSEMBLYAI_STREAMING_USD_PER_HOUR) || 0.15;

type UsageContext = { userId: string | null; meetingId?: string | null };
const context = new AsyncLocalStorage<UsageContext>();

// Charges every AI call made inside fn to this member (and meeting).
export function withAiUser<T>(ctx: UsageContext, fn: () => T): T {
  return context.run(ctx, fn);
}

// The database is loaded on first write rather than at import, so code
// that only gets metered (and the scripts that reuse it) doesn't need
// DATABASE_URL just to load.
const loadDb = () => import("@/db");

let ensured: Promise<void> | null = null;
function ensureAiUsageTable(): Promise<void> {
  ensured ??= loadDb()
    .then(({ rawClient }) => rawClient.unsafe(
      `CREATE TABLE IF NOT EXISTS "ai_usage" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid REFERENCES "user"("id") ON DELETE SET NULL,
        "meetingId" uuid,
        "feature" text NOT NULL,
        "provider" text NOT NULL,
        "model" text,
        "inputTokens" integer NOT NULL DEFAULT 0,
        "outputTokens" integer NOT NULL DEFAULT 0,
        "cacheReadTokens" integer NOT NULL DEFAULT 0,
        "cacheWriteTokens" integer NOT NULL DEFAULT 0,
        "webSearches" integer NOT NULL DEFAULT 0,
        "audioSeconds" integer NOT NULL DEFAULT 0,
        "costUsd" double precision NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "ai_usage_createdAt_idx" ON "ai_usage" ("createdAt");
      CREATE INDEX IF NOT EXISTS "ai_usage_userId_createdAt_idx" ON "ai_usage" ("userId", "createdAt");`,
    ))
    .then(
      () => {},
      (err) => {
        ensured = null; // Try again next time rather than staying broken.
        throw err;
      },
    );
  return ensured;
}

// Exported for the admin page, which reads the table.
export { ensureAiUsageTable };

type UsageRow = typeof aiUsage.$inferInsert;

function save(row: UsageRow) {
  // Never let bookkeeping get in the way of the feature itself.
  void ensureAiUsageTable()
    .then(() => loadDb())
    .then(({ db }) => db.insert(aiUsage).values(row))
    .catch((err) => console.error("[aiUsage] couldn't record usage:", err));
}

async function signedInUserId(): Promise<string | null> {
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    return session?.user?.id ?? null;
  } catch {
    // Not inside a request (a background job) — nobody to charge.
    return null;
  }
}

export function anthropicCost(model: string, u: TokenUsage): number {
  const price = ANTHROPIC_PRICES.find(([prefix]) => model.startsWith(prefix));
  const [input, output] = price ? [price[1], price[2]] : FALLBACK_PRICE;
  return (
    (u.inputTokens * input +
      u.cacheWriteTokens * input * 1.25 +
      u.cacheReadTokens * input * 0.1 +
      u.outputTokens * output) /
      1_000_000 +
    u.webSearches * WEB_SEARCH_USD
  );
}

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
};

type RawUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

// Folds a usage object from the API into the running totals. Streamed
// responses report usage twice (message_start, then cumulative in
// message_delta), so each field keeps its largest value.
function mergeUsage(into: TokenUsage, raw: RawUsage | null | undefined) {
  if (!raw) return;
  into.inputTokens = Math.max(into.inputTokens, raw.input_tokens ?? 0);
  into.outputTokens = Math.max(into.outputTokens, raw.output_tokens ?? 0);
  into.cacheReadTokens = Math.max(into.cacheReadTokens, raw.cache_read_input_tokens ?? 0);
  into.cacheWriteTokens = Math.max(into.cacheWriteTokens, raw.cache_creation_input_tokens ?? 0);
  into.webSearches = Math.max(into.webSearches, raw.server_tool_use?.web_search_requests ?? 0);
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };
}

async function readStreamUsage(body: ReadableStream<Uint8Array>): Promise<{ model: string | null; usage: TokenUsage }> {
  const usage = emptyUsage();
  let model: string | null = null;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line: string) => {
    if (!line.startsWith("data:")) return;
    try {
      const event = JSON.parse(line.slice(5).trim());
      if (event.type === "message_start") {
        model = event.message?.model ?? model;
        mergeUsage(usage, event.message?.usage);
      } else if (event.type === "message_delta") {
        mergeUsage(usage, event.usage);
      }
    } catch {
      // Not JSON (a ping or partial line) — ignore.
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handle);
    }
    handle(buffer);
  } catch {
    // Aborted or dropped mid-stream — the input was still billed, so
    // record what was seen.
  }
  return { model, usage };
}

// A fetch for the Anthropic SDK (new Anthropic({ fetch })) that records
// each Messages API call's usage under this feature label.
export function meteredFetch(feature: string): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const store = context.getStore();
    const res = await fetch(input, init);
    if (!res.ok || !/\/v1\/messages(\?|$)/.test(url)) return res;

    // Who it's for is worked out alongside reading the usage, not before
    // the call, so it never adds latency to the request itself.
    const who: Promise<UsageContext> = store
      ? Promise.resolve(store)
      : signedInUserId().then((userId) => ({ userId }));
    const record = (model: string | null, usage: TokenUsage) => {
      if (!model) return;
      void who.then((ctx) =>
        save({
          userId: ctx.userId,
          meetingId: ctx.meetingId ?? null,
          feature,
          provider: "anthropic",
          model,
          ...usage,
          costUsd: anthropicCost(model, usage),
        }),
      );
    };

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream") && res.body) {
      const [forCaller, forUsage] = res.body.tee();
      void readStreamUsage(forUsage).then(({ model, usage }) => record(model, usage));
      return new Response(forCaller, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    if (contentType.includes("application/json")) {
      void res
        .clone()
        .json()
        .then((body: { model?: string; usage?: RawUsage }) => {
          const usage = emptyUsage();
          mergeUsage(usage, body.usage);
          record(body.model ?? null, usage);
        })
        .catch(() => {});
    }
    return res;
  };
}

// Transcription is billed per audio hour rather than per token.
export function recordAudioUsage(params: {
  feature: "transcription" | "live_transcription";
  seconds: number;
  // Defaults to whoever withAiUser() set.
  userId?: string | null;
  meetingId?: string | null;
}) {
  const store = context.getStore();
  const seconds = Math.max(0, Math.round(params.seconds));
  if (!seconds) return;
  const perHour = params.feature === "live_transcription" ? STREAMING_USD_PER_HOUR : TRANSCRIPTION_USD_PER_HOUR;
  save({
    userId: params.userId !== undefined ? params.userId : (store?.userId ?? null),
    meetingId: params.meetingId ?? store?.meetingId ?? null,
    feature: params.feature,
    provider: "assemblyai",
    model: null,
    audioSeconds: seconds,
    costUsd: (seconds / 3600) * perHour,
  });
}
