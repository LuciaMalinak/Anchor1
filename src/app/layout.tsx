import type { Metadata } from "next";
import "./globals.css";
import { UpdateBanner } from "@/components/UpdateBanner";
import { getAppVersion } from "@/lib/appVersion";

// Fonts come from Google Fonts at page load rather than next/font/google,
// which needs a live fetch to Google at build time that isn't reachable
// from every build environment. globals.css falls back to close system
// fonts (Iowan Old Style / Georgia, the system sans, Menlo) until these
// arrive or if they never do.
const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap";

export const metadata: Metadata = {
  title: "Anchor",
  description: "Meeting context that carries forward.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS_URL} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <UpdateBanner initialVersion={getAppVersion()} />
      </body>
    </html>
  );
}
