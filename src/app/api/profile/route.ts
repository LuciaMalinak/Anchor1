import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { saveUserAvatar } from "@/lib/storage";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB — a photo, not a document
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const formData = await req.formData();
  const updates: Partial<typeof users.$inferInsert> = {};

  const name = formData.get("name");
  if (typeof name === "string") {
    updates.name = name.trim() || null;
  }
  const title = formData.get("title");
  if (typeof title === "string") {
    updates.title = title.trim() || null;
  }
  const phone = formData.get("phone");
  if (typeof phone === "string") {
    updates.phone = phone.trim() || null;
  }
  const linkedin = formData.get("linkedin");
  if (typeof linkedin === "string") {
    updates.linkedin = linkedin.trim() || null;
  }
  const department = formData.get("department");
  if (typeof department === "string") {
    updates.department = department.trim() || null;
  }
  const otherInfo = formData.get("otherInfo");
  if (typeof otherInfo === "string") {
    updates.otherInfo = otherInfo.trim() || null;
  }
  const dailyDigestOptIn = formData.get("dailyDigestOptIn");
  if (typeof dailyDigestOptIn === "string") {
    updates.dailyDigestOptIn = dailyDigestOptIn === "true";
  }

  const photo = formData.get("photo");
  if (photo instanceof File && photo.size > 0) {
    if (!ALLOWED_TYPES.includes(photo.type)) {
      return NextResponse.json({ error: "Use a JPG, PNG, WEBP, or GIF image" }, { status: 400 });
    }
    if (photo.size > MAX_AVATAR_BYTES) {
      return NextResponse.json({ error: "Photo is too large (5MB max)" }, { status: 400 });
    }
    const buffer = Buffer.from(await photo.arrayBuffer());
    await saveUserAvatar(session.user.id, photo.name, buffer);
    // Cache-bust so the new photo shows immediately instead of a
    // previously-cached image at the same URL.
    updates.image = `/api/avatars/${session.user.id}?t=${Date.now()}`;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, session.user.id))
    .returning();

  return NextResponse.json({
    user: {
      id: updated.id,
      name: updated.name,
      title: updated.title,
      image: updated.image,
      email: updated.email,
      phone: updated.phone,
      linkedin: updated.linkedin,
      department: updated.department,
      otherInfo: updated.otherInfo,
      dailyDigestOptIn: updated.dailyDigestOptIn,
    },
  });
}
