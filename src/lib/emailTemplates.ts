// Branded HTML for the magic-link sign-in email — replaces Auth.js's
// default unbranded template (see the Resend provider's custom
// sendVerificationRequest in src/auth.ts). Table-based layout and inline
// styles throughout, since that's what actually renders consistently
// across email clients (Gmail, Apple Mail, Outlook) — no flexbox/grid,
// no <style> blocks relied on for anything structural.
export function signInEmailHtml({ url, host }: { url: string; host: string }) {
  const logoUrl = `${process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? ""}/email-logo.png`;
  const brand = "#12294a";
  const accent = "#b4531f";

  return `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background-color:${brand};padding:28px 32px;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;padding-right:10px;">
                      <img src="${logoUrl}" width="32" height="32" alt="Anchor" style="display:block;border-radius:7px;" />
                    </td>
                    <td style="vertical-align:middle;">
                      <span style="font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.01em;">Anchor</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 32px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.14em;color:${accent};text-transform:uppercase;">
                  SIGN IN
                </p>
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${brand};font-weight:600;">
                  Sign in to ${host}
                </h1>
                <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#475569;">
                  Click the button below to sign in. This link works once and expires shortly, so
                  use it soon.
                </p>
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:8px;background-color:${accent};">
                      <a href="${url}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                        Sign in to Anchor
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">
                  Didn&rsquo;t request this? You can safely ignore this email — no account changes
                  will be made.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-size:11px;color:#94a3b8;">Anchor &middot; ${host}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function signInEmailText({ url, host }: { url: string; host: string }) {
  return `Sign in to ${host}\n${url}\n\n`;
}
