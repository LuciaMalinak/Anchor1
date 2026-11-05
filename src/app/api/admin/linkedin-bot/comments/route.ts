import { NextRequest, NextResponse } from "next/server";
import { requireAppOwnerApi } from "@/lib/adminAccess";
import { createCommentDraft } from "@/lib/linkedinBot/run";

// Comment options for a post pasted in from LinkedIn.
export async function POST(req: NextRequest) {
  if (!(await requireAppOwnerApi())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { postText?: string; author?: string; url?: string };
  const postText = (body.postText ?? "").trim();
  if (postText.length < 20) return NextResponse.json({ error: "Paste the post's text first." }, { status: 400 });
  const url = (body.url ?? "").trim();
  if (url && !/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\//i.test(url)) {
    return NextResponse.json({ error: "That isn't a LinkedIn link." }, { status: 400 });
  }
  try {
    const item = await createCommentDraft({ postText, author: (body.author ?? "").trim().slice(0, 120), url });
    return NextResponse.json({ item });
  } catch (err) {
    console.error("[linkedinBot] comment drafts failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
