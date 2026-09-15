/**
 * Runs the app's real summarizeMeeting() and mergeContactMemory() against
 * the live Anthropic API, using a realistic but synthetic test transcript
 * (api.anthropic.com is reachable from this sandbox, unlike AssemblyAI).
 *
 * Run with: npx tsx scripts/test-real-summarize.ts
 */
import { summarizeMeeting, mergeContactMemory } from "../src/lib/summarize";
import type { Utterance } from "../src/lib/transcribe";

const utterances: Utterance[] = [
  { speakerLabel: "Speaker A", text: "Hi, thanks for hopping on — this is Alex from Anchor.", startMs: 0, endMs: 3000 },
  { speakerLabel: "Speaker B", text: "Good to meet you Alex, I'm Priya, I run ops at BrightPath Logistics.", startMs: 3000, endMs: 7000 },
  { speakerLabel: "Speaker A", text: "Great. So last time we spoke you mentioned budget wasn't locked yet — where's that landed?", startMs: 7000, endMs: 12000 },
  { speakerLabel: "Speaker B", text: "It's approved now, actually. Finance signed off last week. We'd want to start with a 10-seat pilot for the ops team.", startMs: 12000, endMs: 19000 },
  { speakerLabel: "Speaker A", text: "That's great news. I can get a pilot agreement over to you by Friday. Anything else you need from our side first?", startMs: 19000, endMs: 25000 },
  { speakerLabel: "Speaker B", text: "Just confirmation on data retention — our security team wants meeting data deleted after 90 days, not kept indefinitely.", startMs: 25000, endMs: 32000 },
  { speakerLabel: "Speaker A", text: "Understood, I'll get that in writing in the agreement. I'll also loop in our security lead so your team can ask questions directly.", startMs: 32000, endMs: 39000 },
  { speakerLabel: "Speaker B", text: "Perfect. Send the agreement and we can probably kick off pilot access next week.", startMs: 39000, endMs: 44000 },
];

async function main() {
  console.log("=== Calling live Anthropic API: summarizeMeeting() ===\n");
  const summary = await summarizeMeeting(utterances);
  console.log(JSON.stringify(summary, null, 2));

  const priya = summary.speakers.find((s) => s.inferredName?.toLowerCase().includes("priya"));
  if (!priya) {
    console.log("\n(Model did not identify Priya by name — stopping before the memory-merge test.)");
    return;
  }

  console.log("\n=== Calling live Anthropic API: mergeContactMemory() ===");
  console.log("(simulating that Anchor already knew Priya from a prior meeting)\n");
  const merged = await mergeContactMemory({
    contactName: "Priya",
    priorSummary: "Priya runs ops at BrightPath Logistics. As of the intro call, budget for a pilot was not yet approved; she was still getting internal sign-off.",
    meetingCount: 2,
    newNote: priya.note,
  });
  console.log(JSON.stringify(merged, null, 2));
}

main().catch((err) => {
  console.error("FAILED:", err.message || err);
  process.exit(1);
});
