import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ProfileClient } from "./ProfileClient";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id));
  if (!user) return null;

  return (
    <ProfileClient
      profile={{ id: user.id, name: user.name, title: user.title, email: user.email, image: user.image }}
    />
  );
}
