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

// The small YAML feed files electron-updater's "generic" provider polls
// (see src/app/api/desktop-app/updates/[file]/route.ts) — electron-builder
// generates these automatically alongside the installer at package time
// (release/latest-mac.yml, release/latest.yml). They get uploaded the same
// way the installers do, at these fixed keys.
export const DESKTOP_APP_UPDATE_FEEDS = {
  "latest-mac.yml": {
    key: "desktop-app/mac/latest-mac.yml",
    contentType: "text/yaml",
  },
  "latest.yml": {
    key: "desktop-app/win/latest.yml",
    contentType: "text/yaml",
  },
} as const;

export type DesktopAppUpdateFeed = keyof typeof DESKTOP_APP_UPDATE_FEEDS;

export function isDesktopAppUpdateFeed(value: string): value is DesktopAppUpdateFeed {
  return value === "latest-mac.yml" || value === "latest.yml";
}
