import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticateBearer } from "@/lib/apiToken";

// Which Anchor account a desktop token belongs to. The desktop app calls
// this right after receiving a token from a connect link, to show
// "Connected as …" and, when it didn't start that sign-in itself, to ask
// "Connect to <email>?" before switching accounts (see handleDeepLink in
// desktop/src/main.ts).
export async function GET(req: NextRequest) {
  const userId = await authenticateBearer(req);
  if (!userId) {
    return NextResponse.json({ error: "Invalid or missing desktop token" }, { status: 401 });
  }
  const [user] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) {
    return NextResponse.json({ error: "Invalid or missing desktop token" }, { status: 401 });
  }
  return NextResponse.json({ email: user.email, name: user.name });
}
