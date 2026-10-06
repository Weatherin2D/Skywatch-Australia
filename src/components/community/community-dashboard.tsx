"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ImagePlus, Loader2, Upload, X } from "lucide-react";
import { CommunityLibrary } from "@/components/community/community-library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CommunityPost, StorageStatus } from "@/lib/community/types";

const MAX_PHOTOS = 8;

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type PreviewItem = { file: File; url: string };

export function CommunityDashboard() {
  const formId = useId();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [adminDeleteConfigured, setAdminDeleteConfigured] = useState(false);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [caption, setCaption] = useState("");
  const [eventDate, setEventDate] = useState(todayLocalISO);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);

  const loadPosts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/community", {
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error(`Could not load posts (${res.status})`);
      const json = (await res.json()) as {
        posts?: CommunityPost[];
        adminDeleteConfigured?: boolean;
        storage?: StorageStatus;
      };
      if (signal?.aborted) return;
      setPosts(Array.isArray(json.posts) ? json.posts : []);
      setAdminDeleteConfigured(Boolean(json.adminDeleteConfigured));
      setStorage(json.storage ?? null);
      setLoading(false);
    } catch (err) {
      if (signal?.aborted) return;
      setPosts([]);
      setLoading(false);
      setListError(
        err instanceof Error ? err.message : "Could not load community posts.",
      );
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void loadPosts(ac.signal);
    return () => ac.abort();
  }, [loadPosts]);

  useEffect(() => {
    const next = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setPreviews(next);
    return () => {
      for (const item of next) URL.revokeObjectURL(item.url);
    };
  }, [files]);

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setFormError(null);
    setFormOk(null);
    setFiles((prev) => {
      const incoming = Array.from(list);
      const merged = [...prev];
      for (const file of incoming) {
        if (merged.length >= MAX_PHOTOS) break;
        if (!file.type.startsWith("image/")) continue;
        merged.push(file);
      }
      return merged;
    });
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFormError(null);
    setFormOk(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormOk(null);
    if (files.length === 0) {
      setFormError("Choose at least one weather photo to upload.");
      return;
    }
    setSubmitting(true);
    try {
      const body = new FormData();
      body.set("title", title.trim());
      body.set("author", author.trim());
      body.set("caption", caption.trim());
      body.set("eventDate", eventDate);
      for (const file of files) {
        body.append("images", file);
      }
      const res = await fetch("/api/community", {
        method: "POST",
        body,
      });
      const json = (await res.json()) as {
        post?: CommunityPost;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || `Upload failed (${res.status})`);
      }
      if (json.post) {
        setPosts((prev) => [json.post!, ...prev]);
      } else {
        await loadPosts();
      }
      setTitle("");
      setAuthor("");
      setCaption("");
      setEventDate(todayLocalISO());
      setFiles([]);
      setFormOk(
        files.length > 1
          ? `Posted ${files.length} photos — thanks for sharing.`
          : "Posted — thanks for sharing.",
      );
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not publish post.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-6 px-3 py-5 sm:px-4 sm:py-6 lg:px-5">
      <div className="animate-fade-up space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
          Community
        </h1>
        <p className="max-w-2xl text-sm text-white/70 sm:text-base">
          Share photos of weather that has happened across Australia — storms,
          fog, rainbows, and more. Filter, like, and comment in the library.
        </p>
        {storage ? (
          <p
            className={
              storage.durable
                ? "text-xs text-emerald-300/90"
                : "text-xs text-amber-200/90"
            }
          >
            Storage: {storage.backend}
            {storage.durable ? " · durable across deploys" : " · not durable yet"}
            {" — "}
            {storage.detail}
          </p>
        ) : null}
      </div>

      <section
        className="animate-fade-up-delay sw-panel space-y-4 p-4 sm:p-5"
        aria-labelledby={`${formId}-heading`}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--cyan)]/15 text-[var(--cyan)]">
            <ImagePlus className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2
              id={`${formId}-heading`}
              className="text-base font-semibold text-white"
            >
              New weather post
            </h2>
            <p className="mt-0.5 text-xs text-white/55">
              Title, one or more photos, optional caption, your name, and when
              it happened.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${formId}-title`} className="text-white/80">
              Title
            </Label>
            <Input
              id={`${formId}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              required
              placeholder="Shelf cloud over Ballarat"
              className="border-white/15 bg-white/5 text-white placeholder:text-white/35"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${formId}-caption`} className="text-white/80">
              Caption{" "}
              <span className="font-normal text-white/45">(optional)</span>
            </Label>
            <Input
              id={`${formId}-caption`}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={280}
              placeholder="What were the conditions like?"
              className="border-white/15 bg-white/5 text-white placeholder:text-white/35"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-author`} className="text-white/80">
              Author
            </Label>
            <Input
              id={`${formId}-author`}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              maxLength={60}
              required
              placeholder="Your name"
              className="border-white/15 bg-white/5 text-white placeholder:text-white/35"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-date`} className="text-white/80">
              Date
            </Label>
            <Input
              id={`${formId}-date`}
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              required
              className="border-white/15 bg-white/5 text-white"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${formId}-image`} className="text-white/80">
              Photos
            </Label>
            <Input
              id={`${formId}-image`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
              className="border-white/15 bg-white/5 text-white file:mr-3 file:text-white/80"
            />
            <p className="text-[11px] text-white/45">
              JPEG, PNG or WebP · up to {MAX_PHOTOS} photos · max 5 MB each
              {files.length > 0
                ? ` · ${files.length} selected`
                : ""}
            </p>
            {previews.length > 0 ? (
              <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {previews.map((item, index) => (
                  <li
                    key={`${item.file.name}-${index}`}
                    className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0a1628]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={`Selected upload ${index + 1}`}
                      className="aspect-[4/3] w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="absolute right-1.5 top-1.5 rounded-full border border-white/20 bg-black/60 p-1 text-white hover:bg-black/80"
                      aria-label={`Remove photo ${index + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    {index === 0 ? (
                      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white/90">
                        Cover
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {formError ? (
            <p className="sm:col-span-2 text-sm text-red-300" role="alert">
              {formError}
            </p>
          ) : null}
          {formOk ? (
            <p className="sm:col-span-2 text-sm text-[var(--cyan)]" role="status">
              {formOk}
            </p>
          ) : null}

          <div className="sm:col-span-2">
            <Button
              type="submit"
              disabled={submitting}
              className="bg-[var(--cyan)] text-[#041018] hover:bg-[var(--cyan-soft)]"
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                  Publishing…
                </>
              ) : (
                <>
                  <Upload data-icon="inline-start" />
                  {files.length > 1
                    ? `Publish ${files.length} photos`
                    : "Publish post"}
                </>
              )}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby={`${formId}-gallery`} className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-sm text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading photo library…
          </div>
        ) : null}

        {!loading && listError ? (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-6 text-sm text-red-100">
            <p className="font-semibold">Couldn’t load photo library</p>
            <p className="mt-1 text-white/70">{listError}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 border-white/20 text-white"
              onClick={() => void loadPosts()}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {!loading && !listError ? (
          <CommunityLibrary
            posts={posts}
            adminDeleteConfigured={adminDeleteConfigured}
            onPostsChange={setPosts}
          />
        ) : null}
      </section>
    </div>
  );
}
