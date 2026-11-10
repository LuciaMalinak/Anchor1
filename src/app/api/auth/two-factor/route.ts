import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { auth } from "@/auth";
import { db } from "@/db";
import { teams, users } from "@/db/schema";
import { sessionCookieName } from "@/lib/auth/password";
import {
  generateRecoveryCodes,
  generateSecret,
  markSessionVerified,
  otpauthUrl,
  spendRecoveryCode,
  verifyCode,
} from "@/lib/auth/twoFactor";
import { logDataChange } from "@/lib/dataChangeLog";

// Two-step verification settings for the signed-in person (Profile, and
// /welcome/two-factor when their team requires it), and the team owner's
// "require it for everyone" switch. See src/lib/auth/twoFactor.ts.

async function load() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  if (!user) return null;
  const [team] = user.teamId ? await db.select().from(teams).where(eq(teams.id, user.teamId)) : [];
  return { user, team: team ?? null, isOwner: Boolean(team && team.ownerUserId === user.id) };
}

function status(ctx: NonNullable<Awaited<ReturnType<typeof load>>>) {
  return {
    enabled: Boolean(ctx.user.twoFactorEnabledAt),
    recoveryCodesLeft: ctx.user.twoFactorRecoveryHashes?.length ?? 0,
    teamRequires: Boolean(ctx.team?.requireTwoFactor),
    isOwner: ctx.isOwner,
  };
}

export async function GET() {
  const ctx = await load();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(status(ctx));
}

export async function POST(req: NextRequest) {
  const ctx = await load();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; code?: string; on?: boolean };
  const { user } = ctx;
  const code = typeof body.code === "string" ? body.code.trim() : "";

  switch (body.action) {
    // New secret for the authenticator app; not enforced until confirmed.
    case "start": {
      if (user.twoFactorEnabledAt) return NextResponse.json({ error: "Two-step verification is already on." }, { status: 400 });
      const secret = generateSecret();
      await db.update(users).set({ twoFactorSecret: secret }).where(eq(users.id, user.id));
      const url = otpauthUrl(secret, user.email ?? "account");
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
      return NextResponse.json({ secret, qr });
    }
    case "enable": {
      if (user.twoFactorEnabledAt) return NextResponse.json({ error: "Two-step verification is already on." }, { status: 400 });
      if (!user.twoFactorSecret || !verifyCode(user.twoFactorSecret, code)) {
        return NextResponse.json({ error: "That code didn't match. Check the time on your phone and try the newest code." }, { status: 400 });
      }
      const { codes, hashes } = generateRecoveryCodes();
      await db
        .update(users)
        .set({ twoFactorEnabledAt: new Date(), twoFactorRecoveryHashes: hashes })
        .where(eq(users.id, user.id));
      // This sign-in just proved it; every other one will be asked.
      const token = req.cookies.get(sessionCookieName())?.value;
      if (token) await markSessionVerified(token);
      await logDataChange({ action: "two_factor_enabled", actorUserId: user.id, actorEmail: user.email, teamId: user.teamId, targetId: user.id });
      return NextResponse.json({ ...status({ ...ctx, user: { ...user, twoFactorEnabledAt: new Date(), twoFactorRecoveryHashes: hashes } }), recoveryCodes: codes });
    }
    case "disable": {
      if (!user.twoFactorEnabledAt) return NextResponse.json(status(ctx));
      if (ctx.team?.requireTwoFactor) {
        return NextResponse.json({ error: "Your team requires two-step verification, so it can't be turned off." }, { status: 400 });
      }
      const ok = (user.twoFactorSecret && verifyCode(user.twoFactorSecret, code)) || spendRecoveryCode(user.twoFactorRecoveryHashes, code);
      if (!ok) return NextResponse.json({ error: "Enter a current code from your authenticator app (or a recovery code) to turn it off." }, { status: 400 });
      await db
        .update(users)
        .set({ twoFactorEnabledAt: null, twoFactorSecret: null, twoFactorRecoveryHashes: null })
        .where(eq(users.id, user.id));
      await logDataChange({ action: "two_factor_disabled", actorUserId: user.id, actorEmail: user.email, teamId: user.teamId, targetId: user.id });
      return NextResponse.json(status({ ...ctx, user: { ...user, twoFactorEnabledAt: null, twoFactorRecoveryHashes: null } }));
    }
    case "recovery-codes": {
      if (!user.twoFactorEnabledAt || !user.twoFactorSecret || !verifyCode(user.twoFactorSecret, code)) {
        return NextResponse.json({ error: "Enter a current code from your authenticator app to get new recovery codes." }, { status: 400 });
      }
      const { codes, hashes } = generateRecoveryCodes();
      await db.update(users).set({ twoFactorRecoveryHashes: hashes }).where(eq(users.id, user.id));
      return NextResponse.json({ ...status({ ...ctx, user: { ...user, twoFactorRecoveryHashes: hashes } }), recoveryCodes: codes });
    }
    // Team owner: require it for everyone on the team.
    case "require": {
      if (!ctx.isOwner || !ctx.team) return NextResponse.json({ error: "Only the team owner can change this." }, { status: 403 });
      if (body.on && !user.twoFactorEnabledAt) {
        return NextResponse.json({ error: "Turn on two-step verification for yourself first." }, { status: 400 });
      }
      await db.update(teams).set({ requireTwoFactor: Boolean(body.on) }).where(eq(teams.id, ctx.team.id));
      await logDataChange({
        action: body.on ? "team_two_factor_required" : "team_two_factor_optional",
        actorUserId: user.id,
        actorEmail: user.email,
        teamId: ctx.team.id,
        targetId: ctx.team.id,
      });
      return NextResponse.json(status({ ...ctx, team: { ...ctx.team, requireTwoFactor: Boolean(body.on) } }));
    }
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
