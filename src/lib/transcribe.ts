import { AssemblyAI } from "assemblyai";

export type Utterance = {
  speakerLabel: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type TranscriptResult = {
  fullText: string;
  utterances: Utterance[];
};

// Accepts either the raw audio bytes (what processMeeting.ts passes,
// having already fetched them via storage.ts's readStoredFile — works the
// same way regardless of whether they came from local disk or R2) or a
// public URL string (used by scripts/test-real-transcription.ts to hit a
// sample file directly). The AssemblyAI SDK accepts both.
export async function transcribeAudioFile(
  audio: Buffer | string
): Promise<TranscriptResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ASSEMBLYAI_API_KEY is not set. Get a free key at https://www.assemblyai.com and add it to .env.local"
    );
  }

  const client = new AssemblyAI({ apiKey });

  const transcript = await client.transcripts.transcribe({
    audio,
    speaker_labels: true,
  });

  if (transcript.status === "error") {
    throw new Error(`Transcription failed: ${transcript.error}`);
  }

  const utterances: Utterance[] = (transcript.utterances ?? []).map((u) => ({
    speakerLabel: `Speaker ${u.speaker}`,
    text: u.text,
    startMs: u.start,
    endMs: u.end,
  }));

  return {
    fullText: transcript.text ?? "",
    utterances,
  };
}
