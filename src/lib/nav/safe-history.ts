/**
 * History helpers that refuse to rewrite the URL after the user has already
 * navigated away (e.g. via a Next.js <Link>). Shareable query sync that always
 * replaceState'd back to /models or /radar was leaving nav buttons "dead".
 */

/** Replace the current history entry only while still on `path`. */
export function replaceUrlIfOnPath(path: string, nextUrl: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.pathname !== path) return false;

  let pathname = nextUrl;
  let search = "";
  let hash = "";
  try {
    const u = new URL(nextUrl, window.location.origin);
    pathname = u.pathname;
    search = u.search;
    hash = u.hash;
  } catch {
    const hashIdx = nextUrl.indexOf("#");
    const withHash = hashIdx >= 0 ? nextUrl.slice(0, hashIdx) : nextUrl;
    hash = hashIdx >= 0 ? nextUrl.slice(hashIdx) : "";
    const qIdx = withHash.indexOf("?");
    pathname = qIdx >= 0 ? withHash.slice(0, qIdx) : withHash;
    search = qIdx >= 0 ? withHash.slice(qIdx) : "";
  }

  // Never allow a "query sync" helper to change the route.
  if (pathname !== path) return false;

  const next = `${pathname}${search}${hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === next) return false;

  window.history.replaceState(window.history.state, "", next);
  return true;
}
