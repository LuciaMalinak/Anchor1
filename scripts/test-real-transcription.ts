/**
 * Smoke test: run the app's real transcribeAudioFile() against a public
 * sample audio URL, using the real AssemblyAI key. Proves the key works
 * and the integration code is correct, independent of the DB pipeline
 * (already verified separately with fake data).
 *
 * Run with: npx tsx scripts/test-real-transcription.ts
 */
import { transcribeAudioFile } from "../src/lib/transcribe";

async function main() {
  console.log("Submitting a public sample audio file to AssemblyAI...\n");
  const result = await transcribeAudioFile("https://assembly.ai/wildfires.mp3");

  console.log(`Utterance count: ${result.utterances.length}`);
  console.log(`Full text length: ${result.fullText.length} chars\n`);
  console.log("First 3 utterances:");
  for (const u of result.utterances.slice(0, 3)) {
    console.log(`  [${u.speakerLabel}] (${u.startMs}-${u.endMs}ms): ${u.text}`);
  }
  console.log("\nFirst 300 chars of full text:");
  console.log(result.fullText.slice(0, 300));
}

main().catch((err) => {
  console.error("FAILED:", err.message || err);
  process.exit(1);
});
