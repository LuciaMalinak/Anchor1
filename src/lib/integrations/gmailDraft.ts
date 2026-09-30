// Saves a Gmail DRAFT. Never sends: the user reviews and sends it from
// Gmail themselves. Needs the gmail.compose permission, which is asked for
// the first time someone clicks "Save to Gmail drafts" (see config.ts).
import { googlePost, requireGoogleScope } from "./google";
import { buildMime, type DraftInput } from "./gmailMime";

export async function createGmailDraft(userId: string, draft: DraftInput) {
  const connection = await requireGoogleScope(userId, "gmail_compose");
  const raw = Buffer.from(buildMime(draft), "utf8").toString("base64url");
  await googlePost(connection, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    message: { raw },
  });
  // Gmail has no stable link to a single draft, so open the Drafts folder,
  // in the right account if the user is signed in to several.
  const account = connection.externalAccountEmail;
  return {
    openUrl: account
      ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#drafts`
      : "https://mail.google.com/mail/#drafts",
  };
}
