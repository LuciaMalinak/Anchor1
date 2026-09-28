"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DASHBOARD_SECTIONS, type DashboardSectionKey } from "@/lib/dashboardSections";
import { COLOR_THEMES, type ColorThemeKey } from "@/lib/colorThemes";

const SECTION_LABEL: Record<DashboardSectionKey, string> = Object.fromEntries(
  DASHBOARD_SECTIONS.map((s) => [s.key, s.label])
) as Record<DashboardSectionKey, string>;

// Lets each teammate reorder their own home dashboard sections and pick a
// personal accent color — up/down buttons rather than drag-and-drop so
// this works identically on a trackpad, a touchscreen, or a screen
// reader, and nothing can end up stuck mid-drag. Purely personal: saving
// only ever changes what THIS person sees (users.dashboardLayout /
// users.colorTheme in schema.ts), never a teammate's view or the team's
// shared industry accent.
export function DashboardCustomize({
  initialOrder,
  initialColorTheme,
}: {
  initialOrder: DashboardSectionKey[];
  initialColorTheme: ColorThemeKey | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(initialOrder);
  const [colorTheme, setColorTheme] = useState<ColorThemeKey | null>(initialColorTheme);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    saving === false &&
    (order.join(",") !== initialOrder.join(",") || (colorTheme ?? "default") !== (initialColorTheme ?? "default"));

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/dashboard-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardLayout: order, colorTheme: colorTheme ?? "default" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save your layout");
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your layout");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setOrder(DASHBOARD_SECTIONS.map((s) => s.key));
    setColorTheme(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-brand"
      >
        Customize dashboard
      </button>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Customize your dashboard</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Just for you — reordering or recoloring here doesn&apos;t change what your teammates see.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setOrder(initialOrder);
            setColorTheme(initialColorTheme);
            setError(null);
          }}
          className="shrink-0 text-xs font-medium text-slate-400 hover:text-slate-600"
        >
          Close
        </button>
      </div>

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.1em] text-slate-400">SECTION ORDER</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {order.map((key, i) => (
              <li
                key={key}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                {SECTION_LABEL[key]}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${SECTION_LABEL[key]} up`}
                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === order.length - 1}
                    aria-label={`Move ${SECTION_LABEL[key]} down`}
                    className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-[11px] font-semibold tracking-[0.1em] text-slate-400">ACCENT COLOR</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {COLOR_THEMES.filter((t) => t.key !== "default").map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setColorTheme(t.key)}
                title={t.label}
                aria-label={t.label}
                aria-pressed={colorTheme === t.key}
                className={`h-8 w-8 rounded-full border-2 transition ${
                  colorTheme === t.key ? "border-slate-900 scale-110" : "border-white shadow-sm hover:scale-105"
                }`}
                style={{ backgroundColor: t.accent }}
              />
            ))}
            <button
              type="button"
              onClick={() => setColorTheme(null)}
              className={`rounded-full border px-3 text-xs font-medium transition ${
                !colorTheme || colorTheme === "default"
                  ? "border-slate-900 text-slate-900"
                  : "border-slate-300 text-slate-500 hover:border-slate-400"
              }`}
            >
              Default
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            &quot;Default&quot; follows your team&apos;s industry color (Team page), or Anchor&apos;s standard
            color if none is set.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={handleReset} className="text-sm font-medium text-slate-500 hover:text-slate-700">
          Reset to default
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </section>
  );
}
