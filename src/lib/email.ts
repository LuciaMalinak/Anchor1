// Shared sender for everything Anchor emails — team invites, "send
// summary to team" recaps, AND magic-link sign-in (src/auth.ts's
// sendVerificationRequest calls this same function too, despite that
// provider still being imported from next-auth's "Resend" preset — see
// its comment for why the name is misleading now).
//
// Uses SendGrid rather than Resend: Resend's shared sender stays in
// "sandbox mode" (can only deliver to the account owner's own address)
// until a full domain is verified, which blocks every invite to anyone
// but the account owner. SendGrid's single-sender verification — proving
// ownership of one address, no domain required — is enough to send to
// any recipient on its free tier, which is what this account is set up
// with. See SENDGRID_API_KEY / SENDGRID_FROM_EMAIL in Render.
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Email isn't configured (missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL).");
  }

  const recipients = Array.isArray(to) ? to : [to];
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: recipients.map((email) => ({ email })) }],
      from: { email: from },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });

  if (!res.ok) {
    // SendGrid's error body is {"errors": [{"message": "..."}]} — fall
    // back to the raw text if it doesn't parse as that shape, so a
    // caller catching this always gets something readable rather than
    // "[object Object]".
    const body = await res.json().catch(() => null);
    const message = body?.errors?.[0]?.message;
    throw new Error(message || `SendGrid error (${res.status})`);
  }
}
