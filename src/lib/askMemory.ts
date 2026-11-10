import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { askLog, askMemory } from "@/db/schema";
import { meteredFetch, withAiUser } from "@/lib/aiUsage";

// Ask Anchor learns how each person likes to work: a short private note of
// their preferences (length, format, units, how they like models and
// decks), corrections they've made and facts they've told it. The note is
// added to every Ask Anchor answer (liveAssist.ts, personalRules). It's
// rewritten in the background:
// - every few questions, from their recent questions and answers;
// - straight away when they rate an answer, or say "remember", "always",
//   "never", "from now on", "I prefer";
// The person can read, edit or clear it on their Profile (/api/ask/memory).

const MODEL = "claude-haiku-5-5";
const UPDATE_EVERY = 5;
const MAX_NOTES_CHARS = 1500;
const RECENT_ASKS = 12;
const EXPLICIT = /\b(remember|always|never|from now on|going forward|i prefer|i'd prefer|i like|don't|do not|stop)\b/i;

export async function getAskMemory(userId: string): Promise<string | null> {
  const [row] = await db.select({ notes: askMemory.notes }).from(askMemory).where(eq(askMemory.userId, userId)).catch(() => []);
  return row?.notes?.trim() || null;
}

export async function setAskMemory(userId: string, notes: string): Promise<void> {
  const clean = notes.trim().slice(0, MAX_NOTES_CHARS);
  await db
    .insert(askMemory)
    .values({ userId, notes: clean, asksSinceUpdate: 0, updatedAt: new Date() })
    .onConflictDoUpdate({ target: askMemory.userId, set: { notes: clean, asksSinceUpdate: 0, updatedAt: new Date() } });
}

// Called after every answer (fire and forget).
export async function noteAsk(userId: string, question: string): Promise<void> {
  const [row] = await db
    .insert(askMemory)
    .values({ userId, notes: "", asksSinceUpdate: 1 })
    .onConflictDoUpdate({ target: askMemory.userId, set: { asksSinceUpdate: sql`${askMemory.asksSinceUpdate} + 1` } })
    .returning({ count: askMemory.asksSinceUpdate });
  if (EXPLICIT.test(question) || (row?.count ?? 0) >= UPDATE_EVERY) await learn(userId);
}

// Thumbs up/down on an answer (the latest one with this question).
export async function rateAsk(params: { userId: string; question: string; rating: 1 | -1; note?: string | null }): Promise<boolean> {
  const [row] = await db
    .select({ id: askLog.id })
    .from(askLog)
    .where(
      and(
        eq(askLog.userId, params.userId),
        eq(askLog.question, params.question.trim().slice(0, 2000)),
        gt(askLog.createdAt, new Date(Date.now() - 7 * 86_400_000))
      )
    )
    .orderBy(desc(askLog.createdAt))
    .limit(1);
  if (!row) return false;
  await db
    .update(askLog)
    .set({ rating: params.rating, feedbackNote: params.note?.trim().slice(0, 1000) || null })
    .where(eq(askLog.id, row.id));
  void learn(params.userId).catch((err) => console.error("[askMemory] learning after feedback failed:", err));
  return true;
}

let anthropic: Anthropic | null = null;
function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return (anthropic ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: meteredFetch("ask_memory") }));
}

const LEARN_SYSTEM = `You keep a short private note about how one person likes to work with Anchor.AI, their AI assistant for deals, meetings, financial models and decks. You're given the current note and their recent questions, the answers they got, and any feedback.

Rewrite the note so the assistant serves them better next time. Keep only what is durable and useful:
- How they like answers: length, format (bullets, tables, prose), tone, level of detail, language.
- Units and conventions: currency, number formats, fiscal year, date style.
- How they like models and decks: periods, layout, scenarios, brand colours, slide count, what to always include.
- Corrections they made and facts they stated about their work, deals, company or role ("Amanyara has 73 keys", "I report to the owners' board").
- What they asked to always or never do. Feedback marked "down" says what to avoid; "up" says what worked.

Rules: one fact per bullet, each a short plain sentence starting with "- ". At most 15 bullets. Keep earlier bullets unless the new material contradicts or replaces them. Don't record one-off questions, secrets, passwords or sensitive personal details. Don't invent anything. If nothing durable is new, return the current note unchanged. Reply with the note only, no heading.`;

async function learn(userId: string): Promise<void> {
  const ai = client();
  if (!ai) return;
  const [current, recent] = await Promise.all([
    getAskMemory(userId),
    db
      .select({ question: askLog.question, answer: askLog.answer, rating: askLog.rating, feedbackNote: askLog.feedbackNote })
      .from(askLog)
      .where(eq(askLog.userId, userId))
      .orderBy(desc(askLog.createdAt))
      .limit(RECENT_ASKS),
  ]);
  if (!recent.length) return;
  const conversation = recent
    .reverse()
    .map((a) =>
      [
        `Q: ${a.question}`,
        `A: ${a.answer.replace(/\s+/g, " ").slice(0, 500)}`,
        a.rating ? `Feedback: ${a.rating > 0 ? "up" : "down"}${a.feedbackNote ? ` — ${a.feedbackNote}` : ""}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
  const message = await withAiUser({ userId }, () =>
    ai.messages.create({
      model: MODEL,
      max_tokens: 1200,
      output_config: { effort: "low" },
      system: LEARN_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Current note:\n${current ?? "(empty)"}\n\nRecent questions, answers and feedback (oldest first):\n\n${conversation}`,
        },
      ],
    })
  );
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const bullets = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .slice(0, 15)
    .join("\n");
  // Nothing usable back: keep the old note, just reset the counter.
  await setAskMemory(userId, bullets || current || "");
}
