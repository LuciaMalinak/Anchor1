// Ambient types for the experimental Document Picture-in-Picture API
// (Chrome/Edge 116+, Firefox 151+; still missing from TypeScript's
// built-in DOM lib as of this writing). Only the pieces Anchor actually
// uses — see src/lib/useFocusWindow.ts, which is the one place this
// matters: opening the Focus window as a real always-on-top window that
// floats above other apps (Zoom, Teams) instead of an ordinary popup.
export {};

declare global {
  interface DocumentPictureInPicture extends EventTarget {
    requestPictureInPicture(options?: { width?: number; height?: number }): Promise<Window>;
    readonly window: Window | null;
  }

  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}
