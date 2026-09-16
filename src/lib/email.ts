import { Resend } from "resend";

// Shared sender for anything Anchor emails besides the magic-link sign-in
// (Auth.js's Resend provider handles that one itself) — team invites and
// "send summary to team" recaps.
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new Error("Email isn't configured (missing RESEND_API_KEY or EMAIL_FROM).");
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) {
    throw new Error(error.message || "Failed to send email");
  }
}
