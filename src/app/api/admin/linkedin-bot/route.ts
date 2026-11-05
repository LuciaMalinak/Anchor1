import { NextRequest, NextResponse } from "next/server";
import { desc, gte, or, eq } from "drizzle-orm";
import { db } from "@/db";
import { linkedinBotItems } from "@/db/schema";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { pageAppConfigured } from "@/lib/linkedinBot/api";
import { normalizeSettings } from "@/lib/linkedinBot/settings";
import { canPost, loadBot, updateBot } from "@/lib/linkedinBot/run";

// The LinkedIn bot's state for its admin page, and saving its settings.
export async function GET() {
  if (!(await requireAppOwnerApi())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bot = await loadBot();
  const since = new Date(Date.now() - 14 * 24 * 3600_000);
  const items = await db
    .select()
    .from(linkedinBotItems)
    .where(or(gte(linkedinBotItems.createdAt, since), eq(linkedinBotItems.status, "scheduled")))
    .orderBy(desc(linkedinBotItems.createdAt))
    .limit(120);
  return NextResponse.json({
    configured: pageAppConfigured(),
    connected: Boolean(bot.orgUrn && bot.accessToken),
    viaZapier: Boolean(normalizeSettings(bot.settings).zapierWebhookUrl),
    canPost: canPost(bot),
    orgName: bot.orgName,
    tokenExpiresAt: bot.tokenExpiresAt,
    canRefresh: Boolean(bot.refreshToken),
    // Without a refresh token the connection simply runs out (LinkedIn's
    // tokens last 60 days), so warn 10 days ahead.
    tokenExpiresSoon: Boolean(
      bot.tokenExpiresAt && !bot.refreshToken && bot.tokenExpiresAt.getTime() - Date.now() < 10 * 24 * 3600_000,
    ),
    settings: normalizeSettings(bot.settings),
    lastPlannedOn: bot.lastPlannedOn,
    lastError: bot.lastError,
    engagement: bot.engagement,
    items,
  });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAppOwnerApi())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { settings?: Record<string, unknown>; disconnect?: boolean };
  if (body.disconnect) {
    await updateBot({ orgUrn: null, orgName: null, accessToken: null, refreshToken: null, tokenExpiresAt: null, refreshExpiresAt: null });
    return NextResponse.json({ ok: true });
  }
  const bot = await loadBot();
  const settings = normalizeSettings({ ...normalizeSettings(bot.settings), ...(body.settings ?? {}) });
  await updateBot({ settings });
  return NextResponse.json({ ok: true, settings });
}
