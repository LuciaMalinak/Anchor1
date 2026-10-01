"use client";

import { useEffect, useState } from "react";

// Shows a time in the viewer's own time zone (the server doesn't know it).
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setText(
        new Date(iso).toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      )
    );
    return () => cancelAnimationFrame(id);
  }, [iso]);
  return <time dateTime={iso}>{text ?? new Date(iso).toISOString().slice(0, 10)}</time>;
}
