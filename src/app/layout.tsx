import type { Metadata } from "next";
import "./globals.css";
import { UpdateBanner } from "@/components/UpdateBanner";
import { getAppVersion } from "@/lib/appVersion";

// No web fonts: Anchor uses the system font (see globals.css), which renders
// instantly everywhere.

export const metadata: Metadata = {
  title: "Anchor",
  description: "Meeting context that carries forward.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <UpdateBanner initialVersion={getAppVersion()} />
      </body>
    </html>
  );
}
