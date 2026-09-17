// A small retry helper for the network calls in the meeting-processing
// pipeline (transcription, summarization). Before this, any transient
// hiccup — a rate limit, a dropped connection, a 502 from AssemblyAI or
// Anthropic — immediately flipped the whole meeting to "failed" and the
// person had to notice and re-run it by hand. Most of these are
// self-healing if you just try again a moment later, so that's what this
// does automatically instead.
//
// Deliberately conservative about what counts as retryable: a real
// content problem (bad API key, "no speech detected", a 4xx validation
// error) should fail fast and clearly rather than being retried and
// silently delayed.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; label: string }
): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 1000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      const delay = baseDelayMs * Math.pow(3, attempt);
      console.warn(
        `[retry] ${opts.label} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms:`,
        err instanceof Error ? err.message : err
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  const status = extractStatus(err);
  if (status != null) {
    // Rate limits, server errors, and timeouts are worth another try.
    // Anything else in the 4xx range (bad auth, bad request) will just
    // fail the same way again.
    return status === 429 || status === 408 || status >= 500;
  }
  // No HTTP status at all usually means a network-level failure
  // (connection reset, DNS hiccup, fetch timeout) — also worth retrying.
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("fetch failed") ||
    message.includes("network")
  );
}

function extractStatus(err: unknown): number | null {
  if (err && typeof err === "object") {
    const withStatus = err as { status?: unknown; statusCode?: unknown };
    const status = withStatus.status ?? withStatus.statusCode;
    if (typeof status === "number") return status;
  }
  return null;
}
