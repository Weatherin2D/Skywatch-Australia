"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatEventDate } from "@/lib/community/format";
import type { CommunityPost } from "@/lib/community/types";
import { cn } from "@/lib/utils";

export type LibrarySort = "newest" | "event-new" | "event-old";

function sortPosts(posts: CommunityPost[], sort: LibrarySort): CommunityPost[] {
  const next = [...posts];
  if (sort === "newest") {
    next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } else if (sort === "event-new") {
    next.sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));
  } else {
    next.sort((a, b) => (a.eventDate > b.eventDate ? 1 : -1));
  }
  return next;
}

export function CommunityLibrary({
  posts,
  className,
}: {
  posts: CommunityPost[];
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("newest");
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? posts.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.author.toLowerCase().includes(q),
        )
      : posts;
    return sortPosts(base, sort);
  }, [posts, query, sort]);

  const activeIndex = activeId
    ? filtered.findIndex((p) => p.id === activeId)
    : -1;
  const active = activeIndex >= 0 ? filtered[activeIndex] : null;

  function openAt(id: string) {
    setActiveId(id);
  }

  function closeViewer() {
    setActiveId(null);
  }

  function step(delta: number) {
    if (filtered.length === 0 || activeIndex < 0) return;
    const next =
      (activeIndex + delta + filtered.length) % filtered.length;
    setActiveId(filtered[next]!.id);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-white">
            Photo library
          </h2>
          <p className="text-xs text-white/55">
            Browse community weather photos
            {posts.length > 0 ? ` · ${filtered.length} of ${posts.length}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1 sm:flex-none">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title or author"
              className="h-8 border-white/15 bg-white/5 pl-8 text-white placeholder:text-white/35"
              aria-label="Search photo library"
            />
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
            className="h-8 rounded-lg border border-white/15 bg-[#0f172a] px-2 text-xs font-semibold text-white/85"
            aria-label="Sort photo library"
          >
            <option value="newest">Newest posted</option>
            <option value="event-new">Newest event</option>
            <option value="event-old">Oldest event</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-10 text-center">
          <p className="font-semibold text-white">
            {posts.length === 0 ? "No posts yet" : "No matching photos"}
          </p>
          <p className="mt-1 text-sm text-white/55">
            {posts.length === 0
              ? "Be the first to share a weather moment."
              : "Try a different search."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((post) => (
            <li key={post.id}>
              <button
                type="button"
                onClick={() => openAt(post.id)}
                className="group w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] text-left transition hover:border-[var(--cyan)]/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.imageUrl}
                  alt={post.title}
                  className="aspect-[4/3] w-full object-cover bg-[#0a1628] transition duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                />
                <div className="space-y-1 p-3">
                  <h3 className="text-sm font-semibold text-white">
                    {post.title}
                  </h3>
                  <p className="text-xs text-white/60">
                    {post.author}
                    <span className="mx-1.5 text-white/30">·</span>
                    {formatEventDate(post.eventDate)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {active ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={active.title}
          onClick={closeViewer}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0a1224] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {active.title}
                </p>
                <p className="text-xs text-white/55">
                  {active.author}
                  <span className="mx-1.5 text-white/30">·</span>
                  {formatEventDate(active.eventDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeViewer}
                className="rounded-lg border border-white/15 p-1.5 text-white/70 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/40 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={active.imageUrl}
                alt={active.title}
                className="max-h-[70vh] w-auto max-w-full object-contain"
              />
              {filtered.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : null}
            </div>
            <p className="px-4 py-2 text-center text-[11px] text-white/45">
              {activeIndex + 1} / {filtered.length}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
