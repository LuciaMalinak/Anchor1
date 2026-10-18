// Whether a speaker on a call is the Anchor user themselves, so their own
// questions aren't answered as if the client asked them. Calls label
// people however the meeting app does ("Lucia Malinak", "Lucia M",
// "Lucia's iPhone", "LM"), so this checks the account's name, the name in
// its email address, and every name they've marked with "That's me" in
// the live panel (users.callNames).

export type CallIdentity = { name: string | null; email: string | null; callNames: string[] | null };

export function normalizeSpeaker(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]s (iphone|ipad|phone|android|pixel|galaxy|macbook|laptop|pc|computer)\b.*$/, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "lucia.malinak@gmail.com" -> "lucia malinak"
function nameFromEmail(email: string): string {
  return normalizeSpeaker(email.split("@")[0].replace(/[._-]+/g, " ").replace(/\d+/g, ""));
}

export function isSelfSpeaker(speaker: string | null | undefined, me: CallIdentity): boolean {
  if (!speaker) return false;
  const said = normalizeSpeaker(speaker);
  if (!said) return false;
  if ((me.callNames ?? []).some((n) => normalizeSpeaker(n) === said)) return true;

  const names = [me.name, me.email ? nameFromEmail(me.email) : null]
    .filter((n): n is string => Boolean(n))
    .map(normalizeSpeaker)
    .filter(Boolean);
  for (const full of names) {
    if (said === full) return true;
    const [first, ...rest] = full.split(" ");
    const last = rest.at(-1);
    const parts = said.split(" ");
    // "Lucia" / "Lucia M" / "Lucia Malinak (Anchor)": same first name, and
    // any surname given starts the same way.
    if (first && first.length > 1 && parts[0] === first) {
      if (parts.length === 1 || !last || last.startsWith(parts.at(-1)![0])) return true;
    }
  }
  return false;
}
