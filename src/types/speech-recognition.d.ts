// Minimal ambient types for the Web Speech API's SpeechRecognition —
// used by useMicRecorder (src/components/MicRecorder.tsx) to live-
// transcribe an in-person recording in the browser. Not part of
// TypeScript's standard DOM lib (it's non-standard/vendor-prefixed on
// most browsers), so this declares just enough of it to use safely.
// Supported in Chrome/Edge (as webkitSpeechRecognition) and newer
// Firefox; unsupported browsers simply skip live transcription — the
// actual recording (MediaRecorder) never depends on this.
//
// Everything lives inside `declare global` (rather than as bare
// top-level interfaces) because this file has an `export {}`, which
// makes it a module — without `declare global`, these types would only
// be visible within this file instead of everywhere else that uses
// `SpeechRecognition` as a type name.
export {};

declare global {
  interface SpeechRecognitionResultAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface SpeechRecognitionResult {
    readonly length: number;
    readonly isFinal: boolean;
    item(index: number): SpeechRecognitionResultAlternative;
    [index: number]: SpeechRecognitionResultAlternative;
  }

  interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message: string;
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
    onend: ((this: SpeechRecognition, ev: Event) => void) | null;
  }

  interface Window {
    SpeechRecognition?: { new (): SpeechRecognition };
    webkitSpeechRecognition?: { new (): SpeechRecognition };
  }
}
