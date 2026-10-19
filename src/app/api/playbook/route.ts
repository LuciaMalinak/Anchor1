import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { teachAnswer } from "@/lib/answerPlaybook";
import { playbookAccess } from "@/lib/playbookAccess";

// Add an answer to the team's playbook by hand (the Playbook page).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const access = await playbookAccess(session.user.id);
  if (!access) return NextResponse.json({ error: "Join or create a team first." }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";
  const dealId = typeof body.dealId === "string" && body.dealId ? body.dealId : null;
  if (!question || !answer) return NextResponse.json({ error: "Write both the question and the answer." }, { status: 400 });
  if (dealId && !access.dealIds.has(dealId)) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const entry = await teachAnswer({ teamId: access.teamId, dealId, question, answer, userId: session.user.id });
  return NextResponse.json({ entry });
}
