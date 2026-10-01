"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FormattedMessage } from "@/components/AskAnchorPanel";

// Ask Anchor, docked on the right of every signed-in page (a sheet behind
// a floating button on narrow screens). What it can see follows the page:
// a deal page asks /api/deals/[id]/assist (that deal's meetings, files,
// email and research); a meeting recap asks /api/ask about that meeting;
// everywhere else asks /api/ask about the whole workspace. Pages can
// rename the scope (<AskAnchorScope label="Northwind" />) and other
// components can open it with a question (useAskAnchor().ask("…")).

type Turn = { role: "user" | "assistant"; content: string };
type Scope = { key: string; endpoint: string; body: Record<string, string>; kind: "deal" | "meeting" | "workspace" };

type AskAnchorApi = {
  ask: (question: string) => void;
  setLabel: (label: string | null) => void;
};

const AskAnchorContext = createContext<AskAnchorApi | null>(null);

export function useAskAnchor(): AskAnchorApi {
  return useContext(AskAnchorContext) ?? { ask: () => {}, setLabel: () => {} };
}

// Rendered by a page to name what Ask Anchor is looking at ("Northwind
// Logistics" instead of "this deal").
export function AskAnchorScope({ label }: { label: string }) {
  const { setLabel } = useAskAnchor();
  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
  return null;
}

function scopeFor(pathname: string): Scope | null {
  if (pathname.startsWith("/dashboard/admin")) return null; // viewing someone else's account
  const deal = pathname.match(/^\/dashboard\/deals\/([0-9a-f-]{36})$/i);
  if (deal) {
    return { key: `deal:${deal[1]}`, endpoint: `/api/deals/${deal[1]}/assist`, body: { mode: "panel" }, kind: "deal" };
  }
  const meeting = pathname.match(/^\/dashboard\/meetings\/([0-9a-f-]{36})$/i);
  if (meeting) {
    return { key: `meeting:${meeting[1]}`, endpoint: "/api/ask", body: { meetingId: meeting[1] }, kind: "meeting" };
  }
  return { key: "workspace", endpoint: "/api/ask", body: {}, kind: "workspace" };
}

function suggestionsFor(pathname: string, kind: Scope["kind"]): string[] {
  if (kind === "deal") return ["What should I lead with next call?", "What's still open on this deal?", "Who decides here?"];
  if (kind === "meeting") return ["What were the decisions?", "What did they push back on?", "What did we promise?"];
  if (pathname.startsWith("/dashboard/deals")) return ["Which deals could close this month?", "Biggest risks right now?", "Which deals went quiet?"];
  if (pathname.startsWith("/dashboard/insights")) return ["What do customers keep raising?", "Where are deals getting stuck?"];
  if (pathname.startsWith("/dashboard/contacts")) return ["Who haven't I talked to in a while?", "Who are the key people on my deals?"];
  if (pathname.startsWith("/dashboard/team")) return ["Who covers which deals?", "Who should back me up next week?"];
  if (pathname.startsWith("/dashboard/integrations")) return ["What can Anchor see in my Gmail?", "Why connect Salesforce?"];
  return ["What needs me today?", "What did I promise this week?", "Which deals need attention?"];
}

function defaultLabel(kind: Scope["kind"]): string {
  if (kind === "deal") return "This deal — meetings, files, email and research";
  if (kind === "meeting") return "This call — summary and full transcript";
  return "All your deals, meetings, tasks and people";
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}

export function AskAnchorProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/dashboard";
  const scope = useMemo(() => scopeFor(pathname), [pathname]);
  const [label, setLabel] = useState<string | null>(null);
  // Conversations are kept per scope for this visit, so going back to a
  // deal shows what you asked about it a minute ago.
  const [threads, setThreads] = useState<Record<string, Turn[]>>({});
  const [streaming, setStreaming] = useState<{ key: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const inFlight = useRef(false);

  const turns = scope ? threads[scope.key] ?? [] : [];

  const ask = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!scope || !question || inFlight.current) return;
      inFlight.current = true;
      setSheetOpen(true);
      setError(null);
      const history = threads[scope.key] ?? [];
      const withQuestion: Turn[] = [...history, { role: "user", content: question }];
      setThreads((t) => ({ ...t, [scope.key]: withQuestion }));
      setStreaming({ key: scope.key, text: "" });
      try {
        const res = await fetch(scope.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...scope.body,
            question,
            history,
            // So "today" and calendar times are in their own time zone.
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Anchor couldn't answer that.");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let answer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          answer += decoder.decode(value, { stream: true });
          setStreaming({ key: scope.key, text: answer });
        }
        if (!answer.trim()) throw new Error("Anchor couldn't answer that.");
        setThreads((t) => ({ ...t, [scope.key]: [...withQuestion, { role: "assistant", content: answer }] }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Anchor couldn't answer that.");
        setThreads((t) => ({ ...t, [scope.key]: history }));
      } finally {
        setStreaming(null);
        inFlight.current = false;
      }
    },
    [scope, threads]
  );

  const api = useMemo<AskAnchorApi>(() => ({ ask: (q) => void ask(q), setLabel }), [ask]);

  return (
    <AskAnchorContext.Provider value={api}>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">{children}</div>
        {scope && (
          <>
            <aside
              aria-label="Ask Anchor"
              className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[400px] shrink-0 border-l border-[#1f3658] bg-[#0f2340] lg:flex"
            >
              <DockBody
                pathname={pathname}
                scope={scope}
                label={label}
                turns={turns}
                streamingText={streaming?.key === scope.key ? streaming.text : null}
                error={error}
                onAsk={(q) => void ask(q)}
                onClear={() => setThreads((t) => ({ ...t, [scope.key]: [] }))}
              />
            </aside>
            {/* Narrow screens: a button that opens the same panel as a sheet. */}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="fixed bottom-5 right-5 z-30 flex h-14 items-center gap-2 rounded-full bg-[#12294a] px-5 text-sm font-semibold text-white shadow-lg lg:hidden"
            >
              <Sparkle className="h-5 w-5 text-[#f0b48f]" />
              Ask Anchor
            </button>
            {sheetOpen && (
              <div className="fixed inset-0 z-40 flex flex-col bg-[#0f2340] lg:hidden" role="dialog" aria-modal="true" aria-label="Ask Anchor">
                <DockBody
                  pathname={pathname}
                  scope={scope}
                  label={label}
                  turns={turns}
                  streamingText={streaming?.key === scope.key ? streaming.text : null}
                  error={error}
                  onAsk={(q) => void ask(q)}
                  onClear={() => setThreads((t) => ({ ...t, [scope.key]: [] }))}
                  onClose={() => setSheetOpen(false)}
                />
              </div>
            )}
          </>
        )}
      </div>
    </AskAnchorContext.Provider>
  );
}

function DockBody({
  pathname,
  scope,
  label,
  turns,
  streamingText,
  error,
  onAsk,
  onClear,
  onClose,
}: {
  pathname: string;
  scope: Scope;
  label: string | null;
  turns: Turn[];
  streamingText: string | null;
  error: string | null;
  onAsk: (q: string) => void;
  onClear: () => void;
  onClose?: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [canListen, setCanListen] = useState(false);
  const asking = streamingText !== null;

  useEffect(() => {
    // Read after mount: the server render can't know about the browser's
    // speech support, and reading it during render would mismatch.
    const id = requestAnimationFrame(() => setCanListen(getSpeechRecognition() !== null));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, streamingText]);

  // ⌘K / Ctrl+K jumps to the question box from anywhere on the page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit(q: string) {
    if (!q.trim() || asking) return;
    onAsk(q);
    setQuestion("");
  }

  function toggleListening() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.onresult = (e) => {
      const text = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? "")
        .join("");
      setQuestion(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognition.current = r;
    setListening(true);
    r.start();
  }

  const suggestions = suggestionsFor(pathname, scope.kind);

  return (
    <div className="flex h-full min-h-0 w-full flex-col text-slate-100">
      <div className="border-b border-[#1f3658] px-5 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkle className="h-5 w-5 text-[#f0b48f]" />
            <h2 className="text-lg font-semibold text-white">Ask Anchor</h2>
          </div>
          <div className="flex items-center gap-1">
            {turns.length > 0 && (
              <button type="button" onClick={onClear} className="rounded-md px-2 py-1 text-xs text-[#9fb3d1] hover:bg-white/10 hover:text-white">
                New chat
              </button>
            )}
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Ask Anchor"
                className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-[#9fb3d1] hover:bg-white/10 hover:text-white"
              >
                ×
              </button>
            ) : (
              <kbd className="hidden rounded border border-[#2b4268] px-1.5 py-0.5 font-sans text-[11px] text-[#7d8fb0] lg:inline">⌘K</kbd>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-xs text-[#9fb3d1]">
          Knows about: <span className="font-medium text-white">{label ?? defaultLabel(scope.kind)}</span>
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4" aria-live="polite">
        {turns.length === 0 && !asking && (
          <div className="rounded-xl border border-[#1f3658] bg-[#16304f] px-4 py-3 text-sm leading-relaxed text-[#cfdaea]">
            {scope.kind === "deal"
              ? "Ask anything about this deal: what was said, what's open, who decides, or what to say next."
              : scope.kind === "meeting"
                ? "Ask about this call: exact quotes, decisions, objections, or what to put in the follow-up."
                : "Ask about any deal, call, task or person. Anchor answers from your own meetings and notes."}
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="max-w-[88%] self-end rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-white">
              {t.content}
            </div>
          ) : (
            <div key={i} className="max-w-[95%] self-start rounded-2xl rounded-tl-md border border-[#1f3658] bg-[#16304f] px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 [&_strong]:text-white">
              <FormattedMessage content={t.content} />
            </div>
          )
        )}
        {asking && (
          <div className="max-w-[95%] self-start rounded-2xl rounded-tl-md border border-[#1f3658] bg-[#16304f] px-3.5 py-2.5 text-sm leading-relaxed text-slate-100">
            {streamingText ? <FormattedMessage content={streamingText} /> : <span className="text-[#9fb3d1]">Thinking…</span>}
          </div>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2 px-5 pb-3">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submit(s)}
              disabled={asking}
              className="rounded-full border border-[#3b5479] px-3 py-1.5 text-left text-xs text-[#cfdaea] transition hover:border-[#f0b48f] hover:text-white disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="px-5 pb-5 pt-1"
      >
        <div className="flex items-end gap-2 rounded-2xl bg-white p-1.5 pl-3.5 shadow-[0_0_0_3px_rgba(240,180,143,0.25)]">
          <label htmlFor={`ask-anchor-${onClose ? "sheet" : "dock"}`} className="sr-only">
            Ask Anchor
          </label>
          <textarea
            id={`ask-anchor-${onClose ? "sheet" : "dock"}`}
            ref={inputRef}
            rows={1}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(question);
              }
            }}
            placeholder="Ask anything…"
            className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent py-2.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
          />
          {canListen && (
            <button
              type="button"
              onClick={toggleListening}
              aria-label={listening ? "Stop listening" : "Ask by voice"}
              aria-pressed={listening}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${listening ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
            </button>
          )}
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-white transition hover:bg-accent-dark disabled:opacity-50"
          >
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}

// A button anywhere on a page that asks the docked Ask Anchor a ready-made
// question ("Why did Bluepeak go quiet?").
export function AskAnchorButton({
  question,
  children,
  className,
}: {
  question: string;
  children: ReactNode;
  className?: string;
}) {
  const { ask } = useAskAnchor();
  return (
    <button
      type="button"
      onClick={() => ask(question)}
      className={
        className ??
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand hover:text-brand"
      }
    >
      <Sparkle className="h-3.5 w-3.5 text-accent" />
      {children}
    </button>
  );
}
