import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { salesLeads } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { APP_OWNER_EMAILS } from "@/lib/appOwner";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// "Contact sales" from /contact-sales and the billing page: saved for
// Admin → Billing and emailed to the app owner. Anyone can send it.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string | undefined>;
  // A hidden field people never see; bots fill it in.
  if (body.website) return NextResponse.json({ ok: true });
  const email = (body.email ?? "").trim().toLowerCase().slice(0, 200);
  // The free-trial page asks for an email only.
  const name = (body.name ?? "").trim().slice(0, 120) || email;
  const company = (body.company ?? "").trim().slice(0, 200);
  const teamSize = (body.teamSize ?? "").trim().slice(0, 40);
  const message = (body.message ?? "").trim().slice(0, 4000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  }
  const session = await auth();
  await db.insert(salesLeads).values({
    name,
    email,
    company: company || null,
    teamSize: teamSize || null,
    message: message || null,
    userId: session?.user?.id ?? null,
  });
  try {
    await sendEmail({
      to: APP_OWNER_EMAILS,
      subject: `Anchor sales request: ${name}${company ? ` (${company})` : ""}`,
      html: `<p><b>${esc(name)}</b> &lt;${esc(email)}&gt; wants to talk to sales.</p>
<p>Company: ${esc(company || "-")}<br>Team size: ${esc(teamSize || "-")}</p>
<p>${esc(message || "(no message)").replace(/\n/g, "<br>")}</p>
<p>Reply to this person at ${esc(email)}. All requests are also in Admin → Billing.</p>`,
    });
  } catch (err) {
    // Saved either way; the email is a convenience.
    console.error("[contact-sales] email failed:", err);
  }
  return NextResponse.json({ ok: true });
}
