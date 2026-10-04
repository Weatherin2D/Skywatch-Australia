/** Lightweight share helpers — Web Share when available, clipboard otherwise. */

export type SharePayload = {
  title: string;
  text: string;
  url?: string;
};

export async function shareContent(
  payload: SharePayload,
): Promise<"shared" | "copied" | "failed"> {
  const url =
    payload.url ??
    (typeof window !== "undefined" ? window.location.href : undefined);
  const text = url ? `${payload.text}\n${url}` : payload.text;

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: payload.title,
        text: payload.text,
        url,
      });
      return "shared";
    } catch (err) {
      // User cancel — don't fall through as failure noise.
      if (err instanceof DOMException && err.name === "AbortError") {
        return "failed";
      }
    }
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    /* ignore */
  }
  return "failed";
}

export function absoluteAppUrl(pathWithQuery: string): string {
  if (typeof window === "undefined") return pathWithQuery;
  try {
    return new URL(pathWithQuery, window.location.origin).toString();
  } catch {
    return pathWithQuery;
  }
}
