"use client";

import { useState } from "react";
import { WelcomeSplash } from "./WelcomeSplash";

// Thin client wrapper so the server-rendered dashboard page can decide
// *whether* to show the one-time splash (from the DB) without itself
// needing to be a client component. Marks it seen the moment the
// animation finishes, so a refresh (or visiting again) never replays it.
export function WelcomeGate({ show, name }: { show: boolean; name: string | null }) {
  const [visible, setVisible] = useState(show);

  if (!visible) return null;

  return (
    <WelcomeSplash
      name={name}
      onDone={() => {
        setVisible(false);
        fetch("/api/profile/welcome-seen", { method: "POST" }).catch(() => {});
      }}
    />
  );
}
