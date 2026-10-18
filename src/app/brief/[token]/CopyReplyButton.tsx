"use client";

import { useState } from "react";

// Copies a suggested reply from the brief page, to paste into the email.
export function CopyReplyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked: the text is on screen to select by hand.
        }
      }}
      className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
    >
      {copied ? "Copied" : "Copy reply"}
    </button>
  );
}
