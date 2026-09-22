// Shared between the upload side (src/app/api/admin/desktop-app/upload-url)
// and the download side (src/app/api/download/desktop-app/[platform]) so
// the two can never drift out of sync on where a given platform's build
// actually lives in R2.
export const DESKTOP_APP_PLATFORMS = {
  mac: {
    key: "desktop-app/mac/Anchor-Desktop-mac.zip",
    contentType: "application/zip",
    downloadFilename: "Anchor Desktop.zip",
  },
  win: {
    key: "desktop-app/win/Anchor-Desktop-Setup.exe",
    contentType: "application/x-msdownload",
    downloadFilename: "Anchor Desktop Setup.exe",
  },
} as const;

export type DesktopAppPlatform = keyof typeof DESKTOP_APP_PLATFORMS;

export function isDesktopAppPlatform(value: string): value is DesktopAppPlatform {
  return value === "mac" || value === "win";
}
