import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAskMemory, setAskMemory } from "@/lib/askMemory";

// What Ask Anchor has learned about the signed-in person (askMemory.ts):
// read it, edit it, or clear it. Only ever their own.
async function userId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ notes: (await getAskMemory(id)) ?? "" });
}

export async function PUT(req: NextRequest) {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { notes?: unknown };
  if (typeof body.notes !== "string") return NextResponse.json({ error: "Missing notes" }, { status: 400 });
  await setAskMemory(id, body.notes);
  return NextResponse.json({ notes: (await getAskMemory(id)) ?? "" });
}

export async function DELETE() {
  const id = await userId();
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  await setAskMemory(id, "");
  return NextResponse.json({ notes: "" });
}
