// Tiny local config store — just the two things this app needs to
// remember between launches: which Anchor account it's recording into
// (the bearer token from the Integrations page, see
// src/lib/apiToken.ts in the main repo) and which server to talk to.
// Deliberately not using anything fancier (electron-store, a real db)
// for Phase 1 — this is one JSON file in Electron's own per-user data
// directory.
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

export const DEFAULT_API_BASE = "https://anchor-be6o.onrender.com";

type Config = {
  apiBase: string;
  token: string | null;
  // Set when the person turns "launch at login" off in the tray menu —
  // otherwise main.ts turns it back on at every launch, since the app can
  // only notice calls while it's running.
  launchAtLoginOptOut?: boolean;
  // Email of the Anchor account the token belongs to, shown as
  // "Connected as …". Fetched from /api/desktop/me when connecting.
  accountEmail?: string | null;
  // The one-time value sent with the last "Sign in to Anchor" click (see
  // startSignIn in main.ts). A connect link carrying the same value is
  // accepted without asking; kept on disk so it survives the app being
  // relaunched by the link itself.
  pendingSignIn?: { state: string; createdAt: number } | null;
  // Set just before the app restarts itself to install an update (see
  // installUpdateWhenIdle in main.ts), so the relaunch can stay in the
  // menu bar instead of popping its window open when it wasn't open before.
  restartedForUpdate?: { windowWasVisible: boolean } | null;
};

function configPath(): string {
  return path.join(app.getPath("userData"), "anchor-desktop-config.json");
}

export function loadConfig(): Config {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      apiBase: typeof parsed.apiBase === "string" && parsed.apiBase ? parsed.apiBase : DEFAULT_API_BASE,
      token: typeof parsed.token === "string" ? parsed.token : null,
      launchAtLoginOptOut: parsed.launchAtLoginOptOut === true,
      accountEmail: typeof parsed.accountEmail === "string" ? parsed.accountEmail : null,
      pendingSignIn:
        parsed.pendingSignIn &&
        typeof parsed.pendingSignIn.state === "string" &&
        typeof parsed.pendingSignIn.createdAt === "number"
          ? { state: parsed.pendingSignIn.state, createdAt: parsed.pendingSignIn.createdAt }
          : null,
      restartedForUpdate:
        parsed.restartedForUpdate && typeof parsed.restartedForUpdate.windowWasVisible === "boolean"
          ? { windowWasVisible: parsed.restartedForUpdate.windowWasVisible }
          : null,
    };
  } catch {
    return { apiBase: DEFAULT_API_BASE, token: null };
  }
}

export function saveConfig(config: Config): void {
  // Swallows write failures (disk full, permissions, sandbox
  // restriction) instead of throwing. Most call sites are inside
  // ipcMain.handle, which would catch this fine on its own, but
  // main.ts's handleDeepLink calls this directly from a raw Electron
  // "open-url"/second-instance event listener — an uncaught throw there
  // isn't caught by anything and can crash the whole main process over
  // what should only ever fail one connect attempt.
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    console.error(`[anchor-desktop] Couldn't save config: ${err instanceof Error ? err.message : err}`);
  }
}
