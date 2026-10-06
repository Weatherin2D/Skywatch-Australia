/** Browser-side mirror of the server publish cooldown (UX only). */

export const CLIENT_PUBLISH_COOLDOWN_SEC = 20 * 60;

const STORAGE_KEY = "skywatch-community-cooldowns-v1";

type CooldownMap = {
  postUntil?: number;
  commentUntil?: number;
};

function readMap(): CooldownMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CooldownMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: CooldownMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

export function markClientCooldown(
  channel: "post" | "comment",
  cooldownSec = CLIENT_PUBLISH_COOLDOWN_SEC,
) {
  const map = readMap();
  const until = Date.now() + Math.max(1, cooldownSec) * 1000;
  if (channel === "post") map.postUntil = until;
  else map.commentUntil = until;
  writeMap(map);
}

export function getClientCooldownRemainingSec(
  channel: "post" | "comment",
): number {
  const map = readMap();
  const until = channel === "post" ? map.postUntil : map.commentUntil;
  if (!until) return 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

export function formatCooldownClock(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}
