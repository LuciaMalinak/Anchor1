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
  phone: string | null;
  linkedin: string | null;
  department: string | null;
  otherInfo: string | null;
};

const DEPARTMENTS = [
  "Sales",
  "Marketing",
  "Customer Success",
  "Product",
  "Engineering",
  "Finance",
  "Operations",
  "Executive / Leadership",
  "Other",
];

export function ProfileClient({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name || "");
  const [title, setTitle] = useState(profile.title || "");
  const [phone, setPhone] = useState(profile.phone || "");
  const [linkedin, setLinkedin] = useState(profile.linkedin || "");
  const [department, setDepartment] = useState(profile.department || "");
  const [otherInfo, setOtherInfo] = useState(profile.otherInfo || "");
  const [preview, setPreview] = useState<string | null>(profile.image);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/profile/delete", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't delete your account");
      // A full navigation (not router.push) is deliberate — this just
      // cleared the session cookie and every cached client-side bit of
      // "who's signed in" state needs to reset, not just the URL.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete your account");
      setDeleting(false);
    }
  }

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
      formData.set("phone", phone);
      formData.set("linkedin", linkedin);
      formData.set("department", department);
      formData.set("otherInfo", otherInfo);
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="">Select…</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Phone number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 123-4567"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">LinkedIn</label>
          <input
            type="url"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            placeholder="https://linkedin.com/in/yourname"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500">Other info</label>
          <textarea
            value={otherInfo}
            onChange={(e) => setOtherInfo(e.target.value)}
            placeholder="Anything else your team should know — timezone, focus areas, etc."
            rows={3}
            className="resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
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

      {/* Intentionally low-key — no danger-zone box, no red border — this
          isn't something anyone should stumble into while editing their
          name. It's still fully functional, just not the first thing on
          the page. */}
      <div className="mt-4 flex justify-end">
        {!showDelete ? (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="text-xs text-slate-300 hover:text-slate-400"
          >
            Delete account
          </button>
        ) : (
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-slate-50 p-4 text-right">
            <p className="text-left text-xs text-slate-500">
              This signs you out everywhere, removes your profile info, and — if you&apos;re the
              only person on your team — deletes your team&apos;s deals and data too. This can&apos;t
              be undone.
            </p>
            <p className="mt-2 text-left text-xs text-slate-500">
              Type <span className="font-mono font-semibold text-slate-700">DELETE</span> to
              confirm.
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand"
            />
            {deleteError && <p className="mt-2 text-left text-xs text-red-600">{deleteError}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowDelete(false);
                  setDeleteConfirmText("");
                  setDeleteError(null);
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteConfirmText !== "DELETE" || deleting}
                onClick={handleDelete}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-default disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Permanently delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
