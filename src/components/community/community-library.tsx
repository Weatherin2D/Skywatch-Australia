"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatEventDate } from "@/lib/community/format";
import {
  readLikedPostIds,
  writeLikedPostIds,
} from "@/lib/community/liked-local";
import type {
  CommunityImageAsset,
  CommunityPost,
  PictureFormatFilter,
} from "@/lib/community/types";
import { cn } from "@/lib/utils";

export type LibrarySort =
  | "newest"
  | "event-new"
  | "event-old"
  | "most-liked"
  | "most-comments";

function pictureKind(contentType: string): PictureFormatFilter | "other" {
  const t = contentType.toLowerCase();
  if (t.includes("jpeg") || t.includes("jpg")) return "jpeg";
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  return "other";
}

function postImages(post: CommunityPost): CommunityImageAsset[] {
  if (Array.isArray(post.images) && post.images.length > 0) return post.images;
  return [
    {
      id: post.id,
      imageUrl: post.imageUrl,
      contentType: post.contentType,
      imagePath: post.imagePath,
    },
  ];
}

function sortPosts(posts: CommunityPost[], sort: LibrarySort): CommunityPost[] {
  const next = [...posts];
  if (sort === "newest") {
    next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } else if (sort === "event-new") {
    next.sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));
  } else if (sort === "event-old") {
    next.sort((a, b) => (a.eventDate > b.eventDate ? 1 : -1));
  } else if (sort === "most-liked") {
    next.sort((a, b) => b.likes - a.likes || (a.createdAt < b.createdAt ? 1 : -1));
  } else {
    next.sort(
      (a, b) =>
        b.comments.length - a.comments.length ||
        (a.createdAt < b.createdAt ? 1 : -1),
    );
  }
  return next;
}

function postMatchesText(post: CommunityPost, q: string): boolean {
  if (!q) return true;
  const hay = [
    post.title,
    post.author,
    post.caption,
    ...post.comments.map((c) => `${c.author} ${c.text}`),
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

export function CommunityLibrary({
  posts,
  adminDeleteConfigured,
  onPostsChange,
  className,
}: {
  posts: CommunityPost[];
  adminDeleteConfigured: boolean;
  onPostsChange: (posts: CommunityPost[]) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("newest");
  const [pictureFilter, setPictureFilter] =
    useState<PictureFormatFilter>("all");
  const [textFilter, setTextFilter] = useState<"all" | "with-caption" | "with-comments">(
    "all",
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const [commentAuthor, setCommentAuthor] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [adminSignedIn, setAdminSignedIn] = useState(false);
  const [adminSignInSecret, setAdminSignInSecret] = useState("");
  const [adminSignInError, setAdminSignInError] = useState<string | null>(null);
  const [pendingDeletePost, setPendingDeletePost] = useState<CommunityPost | null>(
    null,
  );
  const [deleteConfirmSecret, setDeleteConfirmSecret] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setLikedIds(readLikedPostIds());
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = posts.filter((p) => {
      if (!postMatchesText(p, q)) return false;
      if (
        pictureFilter !== "all" &&
        !postImages(p).some((img) => pictureKind(img.contentType) === pictureFilter)
      ) {
        return false;
      }
      if (textFilter === "with-caption" && !p.caption.trim()) return false;
      if (textFilter === "with-comments" && p.comments.length === 0) return false;
      if (dateFrom && p.eventDate < dateFrom) return false;
      if (dateTo && p.eventDate > dateTo) return false;
      return true;
    });
    return sortPosts(base, sort);
  }, [posts, query, sort, pictureFilter, textFilter, dateFrom, dateTo]);

  const activeIndex = activeId
    ? filtered.findIndex((p) => p.id === activeId)
    : -1;
  const active = activeIndex >= 0 ? filtered[activeIndex] : null;
  const activePhotos = active ? postImages(active) : [];
  const safePhotoIndex =
    activePhotos.length === 0
      ? 0
      : Math.min(photoIndex, activePhotos.length - 1);
  const activePhoto = activePhotos[safePhotoIndex] ?? null;

  function replacePost(next: CommunityPost) {
    onPostsChange(posts.map((p) => (p.id === next.id ? next : p)));
  }

  function openAt(id: string) {
    setActiveId(id);
    setPhotoIndex(0);
    setCommentError(null);
    setActionError(null);
  }

  function closeViewer() {
    setActiveId(null);
    setPhotoIndex(0);
    setCommentError(null);
    setActionError(null);
  }

  function stepPost(delta: number) {
    if (filtered.length === 0 || activeIndex < 0) return;
    const next = (activeIndex + delta + filtered.length) % filtered.length;
    setActiveId(filtered[next]!.id);
    setPhotoIndex(0);
    setCommentError(null);
    setActionError(null);
  }

  function stepPhoto(delta: number) {
    if (activePhotos.length <= 1) {
      stepPost(delta);
      return;
    }
    setPhotoIndex(
      (safePhotoIndex + delta + activePhotos.length) % activePhotos.length,
    );
  }

  async function toggleLike(post: CommunityPost) {
    if (likeBusy) return;
    const already = likedIds.has(post.id);
    const action = already ? "unlike" : "like";
    setLikeBusy(post.id);
    setActionError(null);
    try {
      const res = await fetch("/api/community/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, action }),
      });
      const json = (await res.json()) as { post?: CommunityPost; error?: string };
      if (!res.ok) throw new Error(json.error || `Like failed (${res.status})`);
      if (json.post) replacePost(json.post);
      const nextLiked = new Set(likedIds);
      if (already) nextLiked.delete(post.id);
      else nextLiked.add(post.id);
      setLikedIds(nextLiked);
      writeLikedPostIds(nextLiked);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update like.");
    } finally {
      setLikeBusy(null);
    }
  }

  async function submitComment(post: CommunityPost) {
    setCommentBusy(true);
    setCommentError(null);
    try {
      const res = await fetch("/api/community/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: post.id,
          author: commentAuthor.trim(),
          text: commentText.trim(),
        }),
      });
      const json = (await res.json()) as { post?: CommunityPost; error?: string };
      if (!res.ok) throw new Error(json.error || `Comment failed (${res.status})`);
      if (json.post) replacePost(json.post);
      setCommentText("");
    } catch (err) {
      setCommentError(
        err instanceof Error ? err.message : "Could not add comment.",
      );
    } finally {
      setCommentBusy(false);
    }
  }

  function signInAdmin() {
    if (!adminSignInSecret.trim()) {
      setAdminSignInError("Enter the admin secret to continue.");
      return;
    }
    setAdminSignedIn(true);
    setAdminPanelOpen(false);
    setAdminSignInSecret("");
    setAdminSignInError(null);
    setActionError(null);
  }

  function signOutAdmin() {
    setAdminSignedIn(false);
    setAdminPanelOpen(false);
    setAdminSignInSecret("");
    setAdminSignInError(null);
    cancelPendingDelete();
  }

  function requestDelete(post: CommunityPost) {
    setPendingDeletePost(post);
    setDeleteConfirmSecret("");
    setDeleteError(null);
  }

  function cancelPendingDelete() {
    setPendingDeletePost(null);
    setDeleteConfirmSecret("");
    setDeleteError(null);
  }

  async function confirmDelete() {
    const post = pendingDeletePost;
    if (!post) return;
    const secret = deleteConfirmSecret.trim();
    if (!secret) {
      setDeleteError("Enter the admin secret to delete this post.");
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/community?id=${encodeURIComponent(post.id)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-community-admin-secret": secret,
        },
        body: JSON.stringify({ id: post.id, secret }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || `Delete failed (${res.status})`);
      onPostsChange(posts.filter((p) => p.id !== post.id));
      cancelPendingDelete();
      if (activeId === post.id) closeViewer();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete post.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-white">
            Photo library
          </h2>
          <p className="text-xs text-white/55">
            Filter by text and picture · like and comment
            {posts.length > 0 ? ` · ${filtered.length} of ${posts.length}` : ""}
          </p>
        </div>
        {adminDeleteConfigured ? (
          <button
            type="button"
            onClick={() => {
              if (adminSignedIn) signOutAdmin();
              else setAdminPanelOpen((v) => !v);
            }}
            className="text-[11px] font-semibold text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
          >
            {adminSignedIn
              ? "Sign out admin"
              : adminPanelOpen
                ? "Hide admin"
                : "Admin"}
          </button>
        ) : null}
      </div>

      {adminDeleteConfigured && adminPanelOpen && !adminSignedIn ? (
        <form
          className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            signInAdmin();
          }}
        >
          <Label className="text-xs text-amber-100/90">
            Admin sign-in (shows delete controls on every post)
          </Label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="password"
              value={adminSignInSecret}
              onChange={(e) => {
                setAdminSignInSecret(e.target.value);
                setAdminSignInError(null);
              }}
              placeholder="Admin secret"
              className="h-8 border-white/15 bg-black/20 text-white"
              autoComplete="off"
            />
            <Button
              type="submit"
              className="h-8 shrink-0 bg-amber-400 text-[#1a1200] hover:bg-amber-300"
            >
              Sign in
            </Button>
          </div>
          {adminSignInError ? (
            <p className="mt-1.5 text-xs text-red-300" role="alert">
              {adminSignInError}
            </p>
          ) : null}
        </form>
      ) : null}

      {adminDeleteConfigured && adminSignedIn ? (
        <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-100/90">
          Admin mode on — tap the red <span className="font-bold">X</span> on a
          post, then enter the secret again to delete.
        </div>
      ) : null}

      <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="relative sm:col-span-2 lg:col-span-1">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-white/45">
            Text text
          </span>
          <Search
            className="pointer-events-none absolute bottom-2 left-2.5 h-3.5 w-3.5 text-white/40"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title, author, caption, comments"
            className="h-8 border-white/15 bg-white/5 pl-8 text-white placeholder:text-white/35"
            aria-label="Search photo library text"
          />
        </label>

        <label>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-white/45">
            Picture format
          </span>
          <select
            value={pictureFilter}
            onChange={(e) =>
              setPictureFilter(e.target.value as PictureFormatFilter)
            }
            className="h-8 w-full rounded-lg border border-white/15 bg-[#0f172a] px-2 text-xs font-semibold text-white/85"
          >
            <option value="all">All pictures</option>
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
            <option value="webp">WebP</option>
          </select>
        </label>

        <label>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-white/45">
            Text content
          </span>
          <select
            value={textFilter}
            onChange={(e) =>
              setTextFilter(
                e.target.value as "all" | "with-caption" | "with-comments",
              )
            }
            className="h-8 w-full rounded-lg border border-white/15 bg-[#0f172a] px-2 text-xs font-semibold text-white/85"
          >
            <option value="all">Any text</option>
            <option value="with-caption">Has caption</option>
            <option value="with-comments">Has comments</option>
          </select>
        </label>

        <label>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-white/45">
            Event from
          </span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 border-white/15 bg-white/5 text-white"
          />
        </label>

        <label>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-white/45">
            Event to
          </span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 border-white/15 bg-white/5 text-white"
          />
        </label>

        <label>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-white/45">
            Sort
          </span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
            className="h-8 w-full rounded-lg border border-white/15 bg-[#0f172a] px-2 text-xs font-semibold text-white/85"
          >
            <option value="newest">Newest posted</option>
            <option value="event-new">Newest event</option>
            <option value="event-old">Oldest event</option>
            <option value="most-liked">Most liked</option>
            <option value="most-comments">Most comments</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-10 text-center">
          <p className="font-semibold text-white">
            {posts.length === 0 ? "No posts yet" : "No matching photos"}
          </p>
          <p className="mt-1 text-sm text-white/55">
            {posts.length === 0
              ? "Be the first to share a weather moment."
              : "Try clearing some filters."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((post) => {
            const liked = likedIds.has(post.id);
            return (
              <li key={post.id}>
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                  {adminSignedIn && adminDeleteConfigured ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete(post);
                      }}
                      className="absolute right-1 top-1 z-20 flex h-14 w-14 items-center justify-center rounded-xl bg-red-600 text-white shadow-lg shadow-red-950/50 ring-2 ring-red-300/80 transition hover:scale-105 hover:bg-red-500 active:scale-95 sm:h-16 sm:w-16"
                      aria-label={`Delete “${post.title}”`}
                      title="Delete post"
                    >
                      <X
                        className="h-10 w-10 stroke-[3.5] sm:h-12 sm:w-12"
                        aria-hidden
                      />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openAt(post.id)}
                    className="group block w-full text-left"
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={post.imageUrl}
                        alt={post.title}
                        className="aspect-[4/3] w-full object-cover bg-[#0a1628] transition duration-300 group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                      {postImages(post).length > 1 ? (
                        <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold text-white">
                          {postImages(post).length} photos
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-1 p-3 pb-2">
                      <h3 className="text-sm font-semibold text-white">
                        {post.title}
                      </h3>
                      {post.caption ? (
                        <p className="line-clamp-2 text-xs text-white/55">
                          {post.caption}
                        </p>
                      ) : null}
                      <p className="text-xs text-white/60">
                        {post.author}
                        <span className="mx-1.5 text-white/30">·</span>
                        {formatEventDate(post.eventDate)}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 px-3 pb-3">
                    <button
                      type="button"
                      onClick={() => void toggleLike(post)}
                      disabled={likeBusy === post.id}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition",
                        liked
                          ? "border-rose-400/40 bg-rose-500/15 text-rose-200"
                          : "border-white/15 text-white/70 hover:border-white/30 hover:text-white",
                      )}
                    >
                      <Heart
                        className={cn("h-3.5 w-3.5", liked && "fill-current")}
                      />
                      {post.likes}
                    </button>
                    <button
                      type="button"
                      onClick={() => openAt(post.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-1 text-[11px] font-semibold text-white/70 hover:border-white/30 hover:text-white"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      {post.comments.length}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pendingDeletePost ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete"
          onClick={cancelPendingDelete}
        >
          <form
            className="w-full max-w-md rounded-2xl border border-red-400/40 bg-[#140a0a] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
          >
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white">
                <X className="h-9 w-9 stroke-[3.5]" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white">Delete post?</h3>
                <p className="mt-1 text-sm text-white/65">
                  Permanently remove{" "}
                  <span className="font-semibold text-white">
                    “{pendingDeletePost.title}”
                  </span>
                  . Enter the admin secret again to confirm.
                </p>
              </div>
            </div>
            <Label className="text-xs text-red-100/80">Admin secret</Label>
            <Input
              type="password"
              value={deleteConfirmSecret}
              onChange={(e) => {
                setDeleteConfirmSecret(e.target.value);
                setDeleteError(null);
              }}
              placeholder="Enter secret to delete"
              className="mt-1 h-10 border-red-400/30 bg-black/30 text-white"
              autoComplete="off"
              autoFocus
            />
            {deleteError ? (
              <p className="mt-2 text-xs text-red-300" role="alert">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={cancelPendingDelete}
                disabled={deleteBusy}
                className="h-9 text-white/70 hover:bg-white/10 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={deleteBusy}
                className="h-9 bg-red-600 text-white hover:bg-red-500"
              >
                {deleteBusy ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

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
              <div className="flex shrink-0 items-center gap-1.5">
                {adminSignedIn && adminDeleteConfigured ? (
                  <button
                    type="button"
                    onClick={() => requestDelete(active)}
                    disabled={deleteBusy}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-600 text-white shadow-md ring-2 ring-red-300/70 transition hover:bg-red-500"
                    aria-label="Delete post"
                    title="Delete post"
                  >
                    <X className="h-8 w-8 stroke-[3.5]" aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={closeViewer}
                  className="rounded-lg border border-white/15 p-1.5 text-white/70 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="relative flex items-center justify-center bg-black/40 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activePhoto?.imageUrl ?? active.imageUrl}
                  alt={
                    activePhotos.length > 1
                      ? `${active.title} (${safePhotoIndex + 1}/${activePhotos.length})`
                      : active.title
                  }
                  className="max-h-[42vh] w-auto max-w-full object-contain"
                />
                {activePhotos.length > 1 || filtered.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => stepPhoto(-1)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70"
                      aria-label={
                        activePhotos.length > 1
                          ? "Previous photo in album"
                          : "Previous post"
                      }
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => stepPhoto(1)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-black/50 p-2 text-white hover:bg-black/70"
                      aria-label={
                        activePhotos.length > 1
                          ? "Next photo in album"
                          : "Next post"
                      }
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                ) : null}
                {activePhotos.length > 1 ? (
                  <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white">
                    {safePhotoIndex + 1} / {activePhotos.length}
                  </span>
                ) : null}
              </div>
              {activePhotos.length > 1 ? (
                <div className="flex gap-1.5 overflow-x-auto px-3 pt-2">
                  {activePhotos.map((img, i) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setPhotoIndex(i)}
                      className={cn(
                        "h-14 w-14 shrink-0 overflow-hidden rounded-lg border",
                        i === safePhotoIndex
                          ? "border-[var(--cyan)]"
                          : "border-white/15 opacity-80 hover:opacity-100",
                      )}
                      aria-label={`Show photo ${i + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.imageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              ) : null}
              {filtered.length > 1 ? (
                <div className="flex items-center justify-between gap-2 px-4 pt-2 text-[11px] text-white/50">
                  <button
                    type="button"
                    onClick={() => stepPost(-1)}
                    className="hover:text-white"
                  >
                    ← Prev post
                  </button>
                  <span>
                    Post {activeIndex + 1} of {filtered.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => stepPost(1)}
                    className="hover:text-white"
                  >
                    Next post →
                  </button>
                </div>
              ) : null}

              <div className="space-y-3 px-4 py-3">
                {active.caption ? (
                  <p className="text-sm text-white/75">{active.caption}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleLike(active)}
                    disabled={likeBusy === active.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      likedIds.has(active.id)
                        ? "border-rose-400/40 bg-rose-500/15 text-rose-200"
                        : "border-white/15 text-white/80 hover:border-white/30",
                    )}
                  >
                    <Heart
                      className={cn(
                        "h-3.5 w-3.5",
                        likedIds.has(active.id) && "fill-current",
                      )}
                    />
                    {active.likes} {active.likes === 1 ? "like" : "likes"}
                  </button>
                  <span className="text-[11px] text-white/45">
                    {activeIndex + 1} / {filtered.length}
                  </span>
                </div>

                {actionError ? (
                  <p className="text-xs text-red-300" role="alert">
                    {actionError}
                  </p>
                ) : null}

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                    Comments ({active.comments.length})
                  </h3>
                  {active.comments.length === 0 ? (
                    <p className="text-xs text-white/45">No comments yet.</p>
                  ) : (
                    <ul className="max-h-40 space-y-2 overflow-y-auto">
                      {active.comments.map((c) => (
                        <li
                          key={c.id}
                          className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2"
                        >
                          <p className="text-xs font-semibold text-white/85">
                            {c.author}
                          </p>
                          <p className="mt-0.5 text-xs text-white/70">{c.text}</p>
                        </li>
                      ))}
                    </ul>
                  )}

                  <form
                    className="grid gap-2 sm:grid-cols-[140px_1fr_auto]"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitComment(active);
                    }}
                  >
                    <Input
                      value={commentAuthor}
                      onChange={(e) => setCommentAuthor(e.target.value)}
                      placeholder="Your name"
                      maxLength={60}
                      required
                      className="h-8 border-white/15 bg-white/5 text-white placeholder:text-white/35"
                    />
                    <Input
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Add a comment"
                      maxLength={400}
                      required
                      className="h-8 border-white/15 bg-white/5 text-white placeholder:text-white/35"
                    />
                    <Button
                      type="submit"
                      disabled={commentBusy}
                      className="h-8 bg-[var(--cyan)] text-[#041018] hover:bg-[var(--cyan-soft)]"
                    >
                      {commentBusy ? "…" : "Post"}
                    </Button>
                  </form>
                  {commentError ? (
                    <p className="text-xs text-red-300" role="alert">
                      {commentError}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
