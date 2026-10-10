"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Images, Loader2 } from "lucide-react";
import { formatEventDate } from "@/lib/community/format";
import type { CommunityPost } from "@/lib/community/types";

const FEATURED_LIMIT = 4;

export function HomeCommunityPanel() {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void fetch("/api/community", { cache: "no-store", signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load photos (${res.status})`);
        const json = (await res.json()) as { posts?: CommunityPost[] };
        if (ac.signal.aborted) return;
        setPosts(
          Array.isArray(json.posts) ? json.posts.slice(0, FEATURED_LIMIT) : [],
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setPosts([]);
        setLoading(false);
        setError(
          err instanceof Error ? err.message : "Could not load community photos.",
        );
      });
    return () => ac.abort();
  }, []);

  return (
    <section className="animate-fade-up space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--cyan)]/15 text-[var(--cyan)]">
            <Images className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-white">
              Community photos
            </h2>
            <p className="text-xs text-white/55">
              Weather moments shared by CloudCountry readers.
            </p>
          </div>
        </div>
        <Link
          href="/community"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cyan)] hover:underline"
        >
          Browse library
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-1 py-6 text-sm text-white/55">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading community photos…
        </div>
      ) : null}

      {!loading && error ? (
        <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {!loading && !error && posts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 px-3 py-6 text-center">
          <p className="text-sm font-semibold text-white">No photos yet</p>
          <p className="mt-1 text-xs text-white/55">
            Share a storm, fog bank, or rainbow on Community.
          </p>
          <Link
            href="/community"
            className="mt-3 inline-flex text-xs font-semibold text-[var(--cyan)] hover:underline"
          >
            Post a photo
          </Link>
        </div>
      ) : null}

      {!loading && !error && posts.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href="/community"
                className="group block overflow-hidden rounded-xl border border-white/10 bg-[#0a1628] transition hover:border-[var(--cyan)]/40"
              >
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.imageUrl}
                    alt={post.title}
                    className="aspect-[4/3] w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                  {Array.isArray(post.images) && post.images.length > 1 ? (
                    <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                      {post.images.length}
                    </span>
                  ) : null}
                </div>
                <div className="space-y-0.5 p-2">
                  <p className="truncate text-xs font-semibold text-white">
                    {post.title}
                  </p>
                  <p className="truncate text-[10px] text-white/55">
                    {post.author} · {formatEventDate(post.eventDate)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
