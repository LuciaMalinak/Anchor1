// The first "Save to Gmail drafts" / "Add to calendar" click sends the
// user to Google to grant permission, which reloads the meeting page and
// would lose the edited email or chosen invite. The component stashes what
// it was doing here just before the redirect and finishes it on return.
// Kept in sessionStorage (this tab only) and handed back at most once, so a
// declined permission can't send anyone round in a loop.
const MAX_AGE_MS = 15 * 60_000;

function key(kind: string, meetingId: string) {
  return `anchor.pendingGoogle.${kind}.${meetingId}`;
}

export function stashPendingGoogleAction(kind: string, meetingId: string, data: unknown) {
  try {
    sessionStorage.setItem(key(kind, meetingId), JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Storage blocked: the redirect still works, they just redo the click.
  }
}

export function takePendingGoogleAction<T>(kind: string, meetingId: string): T | null {
  try {
    const raw = sessionStorage.getItem(key(kind, meetingId));
    if (!raw) return null;
    sessionStorage.removeItem(key(kind, meetingId));
    const { at, data } = JSON.parse(raw);
    return typeof at === "number" && Date.now() - at < MAX_AGE_MS ? (data as T) : null;
  } catch {
    return null;
  }
}
