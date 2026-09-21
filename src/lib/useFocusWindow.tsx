"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { FocusWindow } from "@/app/focus/[meetingId]/FocusWindow";
import { openFocusWindow as openFocusWindowPopup } from "@/lib/focusWindow";
import { isFocusPipSupported, copyStylesInto } from "@/lib/focusWindowPip";
import type { FocusWidgetKey } from "@/lib/focusWidgets";

type FocusContext = {
  meetingTitle: string;
  dealId: string | null;
  dealName: string | null;
  stage: string | null;
  primaryContactName: string | null;
  primaryContactRole: string | null;
  decisionBoundaries: string | null;
  initialWidgets: FocusWidgetKey[];
};

type PipSession = {
  meetingId: string;
  pipWindow: Window;
  container: HTMLElement;
  context: FocusContext;
};

const WIDTH = 460;
const HEIGHT = 720;

// Opens (or refocuses) the Focus window for a live meeting, preferring a
// REAL always-on-top window via the Document Picture-in-Picture API
// (Chrome/Edge, and newer Firefox) — the browser keeps it floating above
// every other app on screen, Zoom or Teams included, which an ordinary
// popup can't do (it just sits in the normal window stack and can get
// covered). Falls back to the plain popup (src/lib/focusWindow.ts)
// everywhere else — Safari, older browsers, or if anything about the PiP
// path fails partway through.
//
// Mount exactly ONE instance of this hook for the whole app (see
// LiveMeetingWatcher, itself mounted once in the dashboard layout) and
// render its `portal` there. Every other "open the Focus window" trigger
// (the During tab's button, the dashboard-wide "just went live" banner)
// should call requestFocusWindow() from focusWindowBus.ts instead of its
// own copy of this hook — a second instance would tear its own PiP
// session down the moment the component that opened it unmounts (e.g.
// navigating off the deal page), instead of it surviving like the
// ordinary popup already does.
export function useFocusWindow() {
  const [session, setSession] = useState<PipSession | null>(null);

  const open = useCallback(async (meetingId: string) => {
    if (!isFocusPipSupported()) {
      openFocusWindowPopup(meetingId);
      return;
    }
    try {
      const res = await fetch(`/api/meetings/${meetingId}/focus-context`);
      if (!res.ok) throw new Error("Couldn't load this meeting's Focus window context");
      const context: FocusContext = await res.json();

      const pip = window.documentPictureInPicture;
      if (!pip) throw new Error("Picture-in-Picture unavailable");
      const pipWindow = await pip.requestPictureInPicture({ width: WIDTH, height: HEIGHT });

      copyStylesInto(pipWindow.document);
      pipWindow.document.title = "Anchor — Focus";
      pipWindow.document.body.style.margin = "0";
      const container = pipWindow.document.createElement("div");
      pipWindow.document.body.appendChild(container);

      setSession({ meetingId, pipWindow, container, context });

      // The one-shot "this PiP window just closed" signal — either the
      // person closed it themselves, or FocusWindow's own auto-close
      // (see its onClose prop below) called pipWindow.close(). Either
      // way, drop the session so a later open() starts fresh.
      pipWindow.addEventListener(
        "pagehide",
        () => setSession((cur) => (cur?.pipWindow === pipWindow ? null : cur)),
        { once: true }
      );
    } catch (err) {
      console.error("Focus window: Picture-in-Picture failed, falling back to a popup:", err);
      openFocusWindowPopup(meetingId);
    }
  }, []);

  const portal =
    session &&
    createPortal(
      <FocusWindow
        meetingId={session.meetingId}
        meetingTitle={session.context.meetingTitle}
        dealId={session.context.dealId}
        dealName={session.context.dealName}
        stage={session.context.stage}
        primaryContactName={session.context.primaryContactName}
        primaryContactRole={session.context.primaryContactRole}
        decisionBoundaries={session.context.decisionBoundaries}
        initialWidgets={session.context.initialWidgets}
        onClose={() => session.pipWindow.close()}
      />,
      session.container
    );

  return { open, portal };
}
