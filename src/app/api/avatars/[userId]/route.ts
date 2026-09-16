import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { readUserAvatar } from "@/lib/storage";

const EXT_TO_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  // Signed-in gate only — teammates see each other's photos across the
  // app (team list, deal activity), so this isn't scoped to "your own
  // avatar only" the way the profile PATCH route is.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { userId } = await params;
  const avatar = await readUserAvatar(userId);
  if (!avatar) {
    return NextResponse.json({ error: "No photo" }, { status: 404 });
  }

  const ext = avatar.fileName.slice(avatar.fileName.lastIndexOf(".")).toLowerCase();
  const contentType = EXT_TO_TYPE[ext] || "application/octet-stream";

  return new NextResponse(new Uint8Array(avatar.data), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
