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
  // Whether we've already turned on "launch at login" once, on this
  // machine, by default. Tracked so a user who later turns it off (via
  // the tray menu) doesn't get overridden back to on next launch — see
  // main.ts's tray setup.
  launchAtLoginDefaultApplied?: boolean;
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
      launchAtLoginDefaultApplied: Boolean(parsed.launchAtLoginDefaultApplied),
    };
  } catch {
    return { apiBase: DEFAULT_API_BASE, token: null };
  }
}

export function saveConfig(config: Config): void {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
}
