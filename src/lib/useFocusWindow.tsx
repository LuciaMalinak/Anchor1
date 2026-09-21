"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { FocusWindow } from "@/app/focus/[meetingId]/FocusWindow";
import { openFocusWindow as openFocusWindowPopup } from "@/lib/focusWindow";
import { isFocusPipSupported, copyStylesInto } from "@/lib/focusWindowPip";
import type { FocusWidgetKey } from "@/lib/focusWidgets";
import type { PendingFocusWindow } from "@/lib/focusWindowBus";

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
  // Both null while a pre-opened (pending) window is still waiting on its
  // real meeting — see openPending() below.
  meetingId: string | null;
  pipWindow: Window;
  container: HTMLElement;
  context: FocusContext | null;
  loadError: string | null;
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

  // Wires up a freshly-opened PiP window (styles, title, mount point,
  // close tracking) — shared by open() and openPending() below.
  function mountPipWindow(pipWindow: Window) {
    copyStylesInto(pipWindow.document);
    pipWindow.document.title = "Anchor — Focus";
    pipWindow.document.body.style.margin = "0";
    const container = pipWindow.document.createElement("div");
    pipWindow.document.body.appendChild(container);
    // The one-shot "this PiP window just closed" signal — either the
    // person closed it themselves, or FocusWindow's own auto-close
    // (see its onClose prop below) called pipWindow.close(). Either way,
    // drop the session so a later open() starts fresh.
    pipWindow.addEventListener(
      "pagehide",
      () => setSession((cur) => (cur?.pipWindow === pipWindow ? null : cur)),
      { once: true }
    );
    return container;
  }

  const open = useCallback(async (meetingId: string) => {
    if (!isFocusPipSupported()) {
      openFocusWindowPopup(meetingId);
      return;
    }
    try {
      // Called before any `await` so the click that triggered this
      // (the "Focus window" button, the "just went live" banner/
      // notification) is still "fresh" enough for the browser to allow
      // it — see openPending()'s comment for why this ordering matters.
      const pip = window.documentPictureInPicture;
      if (!pip) throw new Error("Picture-in-Picture unavailable");
      const pipWindowPromise = pip.requestPictureInPicture({ width: WIDTH, height: HEIGHT });
      const contextPromise = fetch(`/api/meetings/${meetingId}/focus-context`).then((res) => {
        if (!res.ok) throw new Error("Couldn't load this meeting's Focus window context");
        return res.json() as Promise<FocusContext>;
      });
      const [pipWindow, context] = await Promise.all([pipWindowPromise, contextPromise]);

      const container = mountPipWindow(pipWindow);
      setSession({ meetingId, pipWindow, container, context, loadError: null });
    } catch (err) {
      console.error("Focus window: Picture-in-Picture failed, falling back to a popup:", err);
      openFocusWindowPopup(meetingId);
    }
  }, []);

  // Opens a blank Focus window immediately (no meeting yet), for a "Join
  // meeting" click that doesn't have a meeting id until its own fetch to
  // /api/meetings/join comes back — by then the click that started it all
  // is no longer "fresh" enough for the browser to allow a NEW
  // Picture-in-Picture window (it requires transient activation: the
  // direct, synchronous result of a click, not something an `await`
  // later in the same handler can still claim). Opening the window right
  // away, before that fetch even starts, sidesteps the problem — this
  // just needs to be called synchronously from inside the click handler.
  // See src/lib/focusWindowBus.ts's requestFocusWindowPending() for how a
  // button elsewhere in the app reaches this without holding its own
  // session.
  const openPending = useCallback((): PendingFocusWindow => {
    if (!isFocusPipSupported()) {
      // No real always-on-top window on this browser — the best this can
      // do is open the ordinary popup once the meeting id is known,
      // exactly like open() already falls back to.
      return {
        attach: (meetingId: string) => openFocusWindowPopup(meetingId),
        cancel: () => {},
      };
    }

    const pip = window.documentPictureInPicture;
    if (!pip) {
      // isFocusPipSupported() just said this existed — treat a race
      // here the same as "not supported" rather than throwing.
      return {
        attach: (meetingId: string) => openFocusWindowPopup(meetingId),
        cancel: () => {},
      };
    }

    let cancelled = false;
    const pipWindowPromise = pip.requestPictureInPicture({ width: WIDTH, height: HEIGHT });

    pipWindowPromise
      .then((pipWindow) => {
        if (cancelled) {
          pipWindow.close();
          return;
        }
        const container = mountPipWindow(pipWindow);
        setSession({ meetingId: null, pipWindow, container, context: null, loadError: null });
      })
      .catch((err) => {
        console.error("Focus window: couldn't pre-open Picture-in-Picture:", err);
      });

    return {
      attach: (meetingId: string) => {
        if (cancelled) return;
        pipWindowPromise
          .then(async (pipWindow) => {
            const res = await fetch(`/api/meetings/${meetingId}/focus-context`);
            if (!res.ok) throw new Error("Couldn't load this meeting's Focus window context");
            const context: FocusContext = await res.json();
            setSession((cur) =>
              cur?.pipWindow === pipWindow ? { ...cur, meetingId, context, loadError: null } : cur
            );
          })
          .catch((err) => {
            console.error("Focus window: pre-opened window couldn't load its meeting:", err);
            setSession((cur) =>
              cur?.pipWindow.closed === false
                ? { ...cur, loadError: "Couldn't load this meeting here — check the During tab instead." }
                : cur
            );
          });
      },
      cancel: () => {
        cancelled = true;
        pipWindowPromise.then((w) => w.close()).catch(() => {});
        setSession((cur) => {
          if (!cur || cur.meetingId !== null) return cur;
          cur.pipWindow.close();
          return null;
        });
      },
    };
  }, []);

  const portal =
    session &&
    createPortal(
      session.meetingId && session.context ? (
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
        />
      ) : (
        // Pre-opened via openPending() and still waiting on attach() —
        // shown for the brief moment between the click and the join
        // request actually coming back.
        <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 p-6 text-center">
          <p className="text-sm font-medium text-slate-900">Anchor — Focus</p>
          <p className="text-xs text-slate-500">
            {session.loadError ?? "Connecting to your meeting…"}
          </p>
        </div>
      ),
      session.container
    );

  return { open, openPending, portal };
}
