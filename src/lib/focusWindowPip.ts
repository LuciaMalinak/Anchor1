"use client";

// Helpers for opening the Focus window as a real, always-on-top window
// via the Document Picture-in-Picture API — see useFocusWindow.ts for
// where these get used. Split out on their own since neither needs React.

export function isFocusPipSupported(): boolean {
  return typeof window !== "undefined" && Boolean(window.documentPictureInPicture);
}

// A Picture-in-Picture window is a genuinely separate `Document` — it
// inherits none of the styles from the page that opened it. Without this,
// every Tailwind class in FocusWindow would render completely unstyled.
// This is the pattern Chrome's own Document Picture-in-Picture docs
// recommend: copy each stylesheet across, inlining its rules where
// possible and falling back to a plain <link> for anything that throws
// reading .cssRules (a cross-origin stylesheet, mainly).
export function copyStylesInto(targetDocument: Document) {
  Array.from(document.styleSheets).forEach((styleSheet) => {
    try {
      const rules = Array.from(styleSheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      const style = targetDocument.createElement("style");
      style.textContent = rules;
      targetDocument.head.appendChild(style);
    } catch {
      if (styleSheet.href) {
        const link = targetDocument.createElement("link");
        link.rel = "stylesheet";
        link.href = styleSheet.href;
        targetDocument.head.appendChild(link);
      }
    }
  });
}
