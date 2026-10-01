"use client";

// Lets Ask Anchor start an in-person recording ("start recording this
// meeting"). Recording needs the microphone recorder that lives on the
// deal page (useMicRecorder in DealTabs.tsx), so that recorder registers
// itself here per deal, and askActions.ts calls it. Not registered —
// e.g. asking from the Focus window or another page — means there's no
// recorder to start from where the person is.
const starters = new Map<string, () => Promise<string | null>>();

export function registerRecordingStarter(dealId: string, start: () => Promise<string | null>): () => void {
  starters.set(dealId, start);
  return () => {
    if (starters.get(dealId) === start) starters.delete(dealId);
  };
}

// Resolves to null once recording, or to why it couldn't start.
export async function startRecording(dealId: string): Promise<string | null> {
  const start = starters.get(dealId);
  if (!start) return "Open this deal's page to start recording from there.";
  return start();
}
