import { RecordClient } from "./RecordClient";

export const metadata = { title: "Record — Anchor.AI" };

// The phone app's Record tab: one big button for recording an in-person
// meeting from the phone's microphone, optionally on a deal.
export default function RecordPage() {
  return <RecordClient />;
}
