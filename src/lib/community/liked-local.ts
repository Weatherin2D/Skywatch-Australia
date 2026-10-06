const KEY = "skywatch-community-liked-v1";

export function readLikedPostIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function writeLikedPostIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify([...ids]));
}
