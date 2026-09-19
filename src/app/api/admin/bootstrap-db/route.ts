import { NextRequest, NextResponse } from "next/server";
import { rawClient } from "@/db";

/**
 * ONE-TIME SETUP ROUTE — delete this file right after using it once.
 *
 * Adds the two columns the deal-sharing/chat-targeting feature needs
 * (deal.restricted, deal_message.recipientUserIds) to the already-running
 * production database. Same reasoning as the very first bootstrap route
 * this project used to create its tables: this sandbox can't reach
 * Postgres directly, only the already-deployed app can, so the DDL runs
 * from inside a route hit once after deploy instead of from a local
 * `drizzle-kit push`.
 *
 * Guarded by a one-time secret (freshly generated, not reused from any
 * earlier bootstrap route) and safe to call more than once — every
 * statement is an IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so a second
 * call is a no-op that reports what's already there.
 */
const SETUP_KEY = "5572edca3e3b761de650412f0377680c9396d764d5120f2a";

const DDL = `
ALTER TABLE public.deal
  ADD COLUMN IF NOT EXISTS "restricted" boolean NOT NULL DEFAULT false;

ALTER TABLE public.deal_message
  ADD COLUMN IF NOT EXISTS "recipientUserIds" jsonb;
`;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== SETUP_KEY) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    await rawClient.unsafe(DDL);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to run schema DDL", detail: String(err) },
      { status: 500 }
    );
  }

  const columns = await rawClient`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'deal' and column_name = 'restricted')
        or (table_name = 'deal_message' and column_name = 'recipientUserIds'))
  `;

  return NextResponse.json({ ok: true, columns });
}
