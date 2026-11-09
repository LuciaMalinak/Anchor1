import { NextRequest, NextResponse } from "next/server";
import { runBackup } from "@/lib/backup";

// Daily full database backup (src/lib/backup.ts). Called by
// .github/workflows/backup.yml with ?key=CRON_SECRET; the server also
// runs it once a day by itself.
async function handle(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("x-cron-key");
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const result = await runBackup();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = handle;
export const POST = handle;
export const maxDuration = 300;
