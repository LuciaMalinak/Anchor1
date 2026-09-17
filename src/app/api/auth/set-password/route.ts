import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/sign-in", req.url), { status: 303 });
  }

  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  const backHere = (error: string) => {
    const url = new URL("/welcome/set-password", req.url);
    url.searchParams.set("error", error);
    return NextResponse.redirect(url, { status: 303 });
  };

  if (password.length < 8) {
    return backHere("short");
  }
  if (password !== confirmPassword) {
    return backHere("mismatch");
  }

  const passwordHash = await hashPassword(password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, session.user.id));

  return NextResponse.redirect(new URL("/dashboard", req.url), { status: 303 });
}
