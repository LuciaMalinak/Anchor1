import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { deals, tasks, users } from "@/db/schema";
import type { ServerTool } from "@/lib/liveAssist";
import { authorizeDeal } from "@/lib/dealAccess";
import { resolvePeople } from "@/lib/askCalendarTools";
import { createGmailDraft } from "@/lib/integrations/gmailDraft";
import { NeedsGooglePermissionError } from "@/lib/integrations/google";
import { ConnectionExpiredError } from "@/lib/integrations/oauthConnection";

// Ask Anchor doing two everyday things itself instead of telling the
// person to: "add that to my to-dos" (add_task, on the same to-do list as
// the home page and the deal's to-dos) and "write a draft email to…"
// (draft_email, saved in Gmail drafts; never sent).

// The deal a name refers to, among the deals this person can see.
async function findDeal(userId: string, name: unknown): Promise<{ id: string; name: string; teamId: string } | null | "ambiguous"> {
  if (typeof name !== "string" || !name.trim()) return null;
  const [me] = await db.select({ teamId: users.teamId }).from(users).where(eq(users.id, userId));
  if (!me?.teamId) return null;
  const candidates = await db
    .select({ id: deals.id, name: deals.name, teamId: deals.teamId })
    .from(deals)
    .where(and(eq(deals.teamId, me.teamId), ilike(deals.name, `%${name.trim().replace(/[%_]/g, "")}%`)))
    .limit(5);
  const access = await Promise.all(candidates.map((d) => authorizeDeal(userId, d.id)));
  const visible = candidates.filter((_, i) => access[i]);
  const exact = visible.filter((d) => d.name.toLowerCase() === name.trim().toLowerCase());
  if (exact.length === 1) return exact[0];
  if (visible.length === 1) return visible[0];
  return visible.length > 1 ? "ambiguous" : null;
}

function addTaskTool(userId: string): ServerTool {
  return {
    tool: {
      name: "add_task",
      description:
        "Add one or more to-dos to the person's Anchor.AI to-do list (shown on their home page, and on the deal when it's about a deal). Use it whenever they say add this to my to-dos / tasks / list, remind me to, or don't let me forget. Each to-do is a short action starting with a verb.",
      input_schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: 'The to-do, e.g. "Send NDA to John Decorato and confirm my role on the Static Partners opportunity".' },
                due: { type: "string", description: "When it's due, in words, if they said (e.g. \"by Friday\")." },
                owner: { type: "string", description: "Who it's for, if not the person themselves." },
              },
              required: ["text"],
            },
          },
          deal_name: { type: "string", description: "The deal these are for, if any." },
        },
        required: ["items"],
      },
    },
    async run(input) {
      const [me] = await db.select({ teamId: users.teamId }).from(users).where(eq(users.id, userId));
      if (!me?.teamId) return "Couldn't find the person's team, so nothing was added.";
      const deal = await findDeal(userId, input.deal_name);
      if (deal === "ambiguous") {
        return `Several deals match "${String(input.deal_name)}". Ask which one, then call add_task again. Nothing was added.`;
      }
      const items = (Array.isArray(input.items) ? input.items : [])
        .map((i) => (i && typeof i === "object" ? (i as Record<string, unknown>) : {}))
        .filter((i) => typeof i.text === "string" && i.text.trim())
        .slice(0, 10);
      if (!items.length) return "No to-do text given. Nothing was added.";
      const rows = items.map((i) => {
        const due = typeof i.due === "string" && i.due.trim() ? ` (${i.due.trim()})` : "";
        return {
          teamId: deal?.teamId ?? me.teamId!,
          dealId: deal?.id ?? null,
          text: `${String(i.text).trim()}${due}`.slice(0, 500),
          ownerLabel: typeof i.owner === "string" && i.owner.trim() ? i.owner.trim().slice(0, 80) : null,
          source: "manual",
          createdByUserId: userId,
        };
      });
      await db.insert(tasks).values(rows);
      return `Added ${rows.length} to-do${rows.length === 1 ? "" : "s"}${deal ? ` on "${deal.name}"` : ""}: ${rows
        .map((r) => `"${r.text}"`)
        .join("; ")}. They're on the home page to-do list${deal ? " and the deal's to-dos" : ""}.`;
    },
  };
}

function draftEmailTool(userId: string): ServerTool {
  return {
    tool: {
      name: "draft_email",
      description:
        "Write an email and save it as a draft in the person's Gmail, ready for them to review and send. Never sends it. Use it whenever they ask you to write, draft, prepare or send an email or follow-up. Recipients can be email addresses or names of their contacts or teammates.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "array", items: { type: "string" }, description: "Emails, or names of contacts / teammates. May be empty if they haven't said who." },
          cc: { type: "array", items: { type: "string" } },
          subject: { type: "string" },
          body: {
            type: "string",
            description: "The full email in plain text: greeting, body and sign-off with the person's first name. Written in their voice, specific to the call or deal.",
          },
        },
        required: ["to", "subject", "body"],
      },
    },
    async run(input) {
      const subject = typeof input.subject === "string" ? input.subject.trim().slice(0, 300) : "";
      const body = typeof input.body === "string" ? input.body.trim() : "";
      if (!subject || !body) return "An email needs a subject and a body. Nothing was saved.";
      const [to, cc] = await Promise.all([
        resolvePeople(userId, Array.isArray(input.to) ? input.to : []),
        resolvePeople(userId, Array.isArray(input.cc) ? input.cc : []),
      ]);
      const ambiguous = [...to.ambiguous, ...cc.ambiguous];
      if (ambiguous.length) {
        return `Not saved yet: ${ambiguous.join("; ")}. Ask which address to use, then call draft_email again.`;
      }
      try {
        const { openUrl } = await createGmailDraft(userId, { to: to.emails, cc: cc.emails, subject, body: body.slice(0, 20_000) });
        const missing = [...to.missing, ...cc.missing];
        return [
          `Saved to Gmail drafts${to.emails.length ? `, to ${to.emails.join(", ")}` : " with no recipient yet"}${cc.emails.length ? `, cc ${cc.emails.join(", ")}` : ""}. Subject: "${subject}".`,
          missing.length ? `No email address on file for ${missing.join(", ")}: they need to add it in Gmail before sending.` : "",
          `Open drafts: ${openUrl}`,
        ]
          .filter(Boolean)
          .join("\n");
      } catch (err) {
        if (err instanceof NeedsGooglePermissionError) {
          return `Not saved: Anchor.AI needs permission to save Gmail drafts. Show the email in your reply, and give them this link to allow it, then offer to save it: [Allow Gmail drafts](/api/integrations/google/connect?add=gmail_compose&returnTo=%2Fdashboard)`;
        }
        if (err instanceof ConnectionExpiredError) {
          return `Not saved: ${err.message} Show the email in your reply, and give them this link to reconnect Google, then offer to save it: [Reconnect Google](/api/integrations/google/connect?add=gmail_compose&returnTo=%2Fdashboard)`;
        }
        throw err;
      }
    },
  };
}

export const EMAIL_TASK_RULES = `To-dos and emails: you can do both yourself — never tell the person to do them, and never say you don't have a to-do list or can't write to their email.
- When they ask you to add something to their to-dos, tasks or list, or to remind them, call add_task with short, specific to-dos (include who and what from the context, and the deal when there is one). Then confirm in one line.
- When they ask you to write, draft or prepare an email or follow-up, write it in their voice from what you know (the call, the deal, the emails) and save it with draft_email. Then show the email in your reply and say it's in their Gmail drafts with the link. It's never sent; they send it themselves.
- When "that" or "it" refers to something you just suggested (a to-do list, an email), use exactly that.`;

export function emailTaskTools(userId: string): ServerTool[] {
  return [addTaskTool(userId), draftEmailTool(userId)];
}
