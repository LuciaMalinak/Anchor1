"use client";

import { useRef, useState, type ReactNode } from "react";
import { runAskActions, stripAskActions } from "@/lib/askActions";

type ChatTurn = { role: "user" | "assistant"; content: string };

// Assistant replies come back as plain markdown-ish text (the model
// naturally reaches for **bold** and "- " bullet lists) but were being
// dropped straight into a <div> as a literal string — every "**" and "-"
// showed up as literal characters in the chat bubble instead of actual
// formatting. A real markdown library felt like overkill (and a new
// dependency to install right before a demo) for what the model actually
// produces here, so this is a small, dependency-free renderer for just
// **bold** spans and "- "/"* " bullet lists — the two things worth
// handling; anything else just renders as plain text, which is exactly
// what it did before.
// **bold** and [label](https://link) — e.g. news articles Ask Anchor
// suggests. Only http(s) links are made clickable; they open in a new tab.
function renderInline(text: string, keyPrefix: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).filter((p) => p.length > 0);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
          {link[1]}
        </a>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

export function FormattedMessage({ content }: { content: string }) {
  // Grouped line by line, so a bolded line followed straight away by
  // "- " bullets (e.g. "**Suggested next steps**") renders as a label and
  // a real list rather than literal dashes.
  const groups: { type: "p" | "ul"; lines: string[] }[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      groups.push({ type: "p", lines: [] }); // paragraph break
      continue;
    }
    const isBullet = /^\s*[-*•]\s+/.test(line);
    const last = groups[groups.length - 1];
    if (isBullet) {
      const text = line.trim().replace(/^[-*•]\s+/, "");
      if (last?.type === "ul") last.lines.push(text);
      else groups.push({ type: "ul", lines: [text] });
    } else if (last?.type === "p" && last.lines.length > 0) {
      last.lines.push(line);
    } else {
      groups.push({ type: "p", lines: [line] });
    }
  }
  const blocks = groups.filter((g) => g.lines.length > 0);
  return (
    <>
      {blocks.map((block, bi) =>
        block.type === "ul" ? (
          <ul key={bi} className={`list-disc space-y-0.5 pl-4 ${bi > 0 ? "mt-1.5" : ""}`}>
            {block.lines.map((line, li) => (
              <li key={li}>{renderInline(line, `${bi}-${li}`)}</li>
            ))}
          </ul>
        ) : (
          <p key={bi} className={bi > 0 ? "mt-2" : undefined}>
            {block.lines.map((line, li) => (
              <span key={li}>
                {renderInline(line, `${bi}-${li}`)}
                {li < block.lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        )
      )}
    </>
  );
}

// The mid-meeting "Ask Anchor" quick-question box — grounded in a deal's
// past meetings, action items, and files via /api/deals/[id]/assist (see
// src/lib/liveAssist.ts). Its own file (moved out of DealTabs.tsx) so the
// Before/During tabs and the standalone focus-mode window (src/app/focus)
// can both use it without keeping two copies of this logic in sync.
export function AskAnchorPanel({ dealId }: { dealId: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  // The answer as it streams in, word by word, before it's a finished
  // turn — shown as its own bubble so the first words appear almost
  // immediately instead of everyone staring at "Thinking…" for a few
  // seconds while the full answer is generated.
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleAsk(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = question.trim();
    if (!q || asking) return;
    setError(null);
    setQuestion("");
    const nextTurns: ChatTurn[] = [...turns, { role: "user", content: q }];
    setTurns(nextTurns);
    setAsking(true);
    setStreamingAnswer("");
    try {
      const res = await fetch(`/api/deals/${dealId}/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: turns }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Anchor couldn't answer that.");
      }
      if (!res.body) throw new Error("Anchor couldn't answer that.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setStreamingAnswer(stripAskActions(answer));
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
      if (!answer.trim()) throw new Error("Anchor couldn't answer that.");
      // Stop the meeting / open a file if the answer asked for it — see
      // askActions.ts. A failure is added under the answer, not hidden.
      const actionNote = await runAskActions(answer);
      const shown = stripAskActions(answer) + (actionNote ? `\n\n${actionNote}` : "");
      setTurns([...nextTurns, { role: "assistant", content: shown }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anchor couldn't answer that.");
    } finally {
      setAsking(false);
      setStreamingAnswer("");
    }
  }

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-3">
        <p className="text-sm font-medium text-slate-900">Ask Anchor</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Grounded in this deal&apos;s past meetings, action items, and files — ask for a
          quick answer or talking point mid-meeting.
        </p>
      </div>

      {turns.length > 0 && (
        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto px-5 py-4">
          {turns.map((t, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                t.role === "user"
                  ? "self-end bg-brand text-white"
                  : "self-start bg-slate-100 text-slate-800"
              }`}
            >
              {t.role === "assistant" ? <FormattedMessage content={t.content} /> : t.content}
            </div>
          ))}
          {asking && (
            <div className="max-w-[85%] self-start rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800">
              {streamingAnswer ? <FormattedMessage content={streamingAnswer} /> : <span className="text-slate-400">Thinking…</span>}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <form onSubmit={handleAsk} className="flex items-center gap-2 border-t border-slate-200 p-3">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What did they push back on last time?"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={asking || !question.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark disabled:opacity-50"
        >
          Ask
        </button>
      </form>
      {error && <p className="px-3 pb-3 text-xs text-red-600">{error}</p>}
    </div>
  );
}
