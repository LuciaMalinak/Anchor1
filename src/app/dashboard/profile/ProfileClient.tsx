"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type Profile = {
  id: string;
  name: string | null;
  title: string | null;
  email: string;
  image: string | null;
};

export function ProfileClient({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name || "");
  const [title, setTitle] = useState(profile.title || "");
  const [preview, setPreview] = useState<string | null>(profile.image);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPreview(URL.createObjectURL(file));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const formData = new FormData();
      formData.set("name", name);
      formData.set("title", title);
      const file = fileInputRef.current?.files?.[0];
      if (file) formData.set("photo", file);

      const res = await fetch("/api/profile", { method: "PATCH", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save");
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const initial = (name || profile.email)[0]?.toUpperCase() || "?";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Your profile</h1>
        <p className="text-sm text-slate-500">
          Shown to your teammates on shared deals and the team page.
        </p>
      </div>

      <form onSubmit={handleSave} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="h-24 bg-gradient-to-r from-brand to-brand-dark" />
        <div className="flex flex-col gap-5 px-6 pb-6">
          <div className="-mt-10 flex items-end gap-4">
            {preview ? (
              <Image
                src={preview}
                alt=""
                width={80}
                height={80}
                unoptimized
                className="h-20 w-20 rounded-full border-4 border-white object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-brand text-2xl font-semibold text-white shadow-sm">
                {initial}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mb-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
            >
              Change photo
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              className="hidden"
            />
          </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Title / role</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Account Executive"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Email</label>
          <p className="text-sm text-slate-500">{profile.email}</p>
        </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-xs text-emerald-600">Saved ✓</span>}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </form>
    </div>
  );
}
