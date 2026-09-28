import type { Metadata } from "next";
import "./globals.css";
import { UpdateBanner } from "@/components/UpdateBanner";
import { getAppVersion } from "@/lib/appVersion";

// Deliberately not using next/font/google here — it needs a live fetch to
// Google Fonts at build time, which isn't reachable from every environment
// (this sandbox included). The system font stack below renders instantly
// everywhere and looks fine; swap in a real webfont later if the brand
// needs it.

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
