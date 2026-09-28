// A small, curated set of personal accent colors a teammate can pick for
// their own view of the dashboard — deliberately a fixed palette rather
// than a free color picker, same reasoning as src/lib/industries.ts's
// accent colors, so nobody ends up with a color that's illegible against
// the UI's white/slate backgrounds. Purely cosmetic and purely personal:
// picking one only changes what that person sees (see users.colorTheme in
// schema.ts), never the team's shared industry accent other teammates see.
export type ColorThemeKey = "default" | "ocean" | "forest" | "sunset" | "berry" | "slate";

export type ColorTheme = {
  key: ColorThemeKey;
  label: string;
  accent: string;
  accentDark: string;
};

export const COLOR_THEMES: ColorTheme[] = [
  // "default" isn't rendered as its own swatch (see ColorThemePicker) —
  // it's what clearing the override back to null falls through to, i.e.
  // whatever the team's industry accent already is, or the app's base
  // brand color when there's no industry set either.
  { key: "default", label: "Default", accent: "#b4531f", accentDark: "#904218" },
  { key: "ocean", label: "Ocean", accent: "#1D4ED8", accentDark: "#1E3A8A" },
  { key: "forest", label: "Forest", accent: "#15803D", accentDark: "#14532D" },
  { key: "sunset", label: "Sunset", accent: "#EA580C", accentDark: "#C2410C" },
  { key: "berry", label: "Berry", accent: "#A21CAF", accentDark: "#701A75" },
  { key: "slate", label: "Slate", accent: "#334155", accentDark: "#1E293B" },
];

export const COLOR_THEME_BY_KEY: Record<ColorThemeKey, ColorTheme> = Object.fromEntries(
  COLOR_THEMES.map((t) => [t.key, t])
) as Record<ColorThemeKey, ColorTheme>;

export function isColorThemeKey(value: string): value is ColorThemeKey {
  return value in COLOR_THEME_BY_KEY;
}
