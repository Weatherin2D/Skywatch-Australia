import type { LightningStrike } from "@/lib/weather/lightning";
import { LIGHTNING_AU_BOUNDS } from "@/lib/weather/lightning";

const WS_HOSTS = [
  "wss://ws1.blitzortung.org",
  "wss://ws7.blitzortung.org",
  "wss://ws8.blitzortung.org",
] as const;

const WINDOW_SEC = 30 * 60;
const MAX_BUFFER = 2500;

type FeedStatus = "connecting" | "live" | "reconnecting" | "error";

export type LiveLightningSnapshot = {
  strikes: LightningStrike[];
  status: FeedStatus;
  connectedHost: string | null;
  generated: number;
  receivedTotal: number;
  windowMinutes: number;
  attribution: string;
  source: "blitzortung";
};

type GlobalFeed = {
  strikes: Map<string, LightningStrike>;
  status: FeedStatus;
  host: string | null;
  receivedTotal: number;
  ws: WebSocket | null;
  hostIndex: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pruneTimer: ReturnType<typeof setInterval> | null;
  started: boolean;
};

const g = globalThis as typeof globalThis & {
  __skywatchBlitzFeed?: GlobalFeed;
};

function getState(): GlobalFeed {
  if (!g.__skywatchBlitzFeed) {
    g.__skywatchBlitzFeed = {
      strikes: new Map(),
      status: "connecting",
      host: null,
      receivedTotal: 0,
      ws: null,
      hostIndex: 0,
      reconnectTimer: null,
      pruneTimer: null,
      started: false,
    };
  }
  return g.__skywatchBlitzFeed;
}

/** Blitzortung payloads are LZW-compressed binary strings that still start with `{`. */
function decodeLzw(binaryStr: string): string {
  const dict: Record<number, string> = {};
  let currChar = binaryStr.charAt(0);
  let oldPhrase = currChar;
  const out = [currChar];
  let code = 256;
  let phrase: string;

  for (let i = 1; i < binaryStr.length; i++) {
    const currCode = binaryStr.charCodeAt(i);
    if (currCode < 256) {
      phrase = binaryStr.charAt(i);
    } else {
      phrase =
        Object.prototype.hasOwnProperty.call(dict, currCode)
          ? dict[currCode]!
          : oldPhrase + currChar;
    }
    out.push(phrase);
    currChar = phrase.charAt(0);
    dict[code] = oldPhrase + currChar;
    code++;
    oldPhrase = phrase;
  }

  return out.join("");
}

function parseStrikeMessage(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(decodeLzw(raw)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function inAuBounds(lat: number, lon: number) {
  return (
    lat >= LIGHTNING_AU_BOUNDS.south &&
    lat <= LIGHTNING_AU_BOUNDS.north &&
    lon >= LIGHTNING_AU_BOUNDS.west &&
    lon <= LIGHTNING_AU_BOUNDS.east
  );
}

function toStrike(obj: Record<string, unknown>): LightningStrike | null {
  const lat = Number(obj.lat);
  const lon = Number(obj.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!inAuBounds(lat, lon)) return null;

  // time is nanoseconds since epoch (precision loss is fine for whole seconds)
  const timeNs = Number(obj.time);
  if (!Number.isFinite(timeNs) || timeNs <= 0) return null;
  const time = Math.floor(timeNs / 1e9);
  const now = Math.floor(Date.now() / 1000);
  if (time < now - WINDOW_SEC - 60 || time > now + 120) return null;

  const polarityRaw = Number(obj.pol);
  const polarity = polarityRaw > 0 ? 1 : polarityRaw < 0 ? -1 : 0;
  const mcg = Number(obj.mcg);
  const mds = Number(obj.mds);
  const intensity = Number.isFinite(mcg)
    ? Math.min(80, Math.max(4, mcg / 4))
    : Number.isFinite(mds)
      ? Math.min(80, Math.max(4, mds / 400))
      : 20;

  const id = `bz-${time}-${lat.toFixed(4)}-${lon.toFixed(4)}`;
  return {
    id,
    time,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    polarity,
    intensity: Math.round(intensity * 10) / 10,
  };
}

function prune(state: GlobalFeed) {
  const cutoff = Math.floor(Date.now() / 1000) - WINDOW_SEC;
  for (const [id, strike] of state.strikes) {
    if (strike.time < cutoff) state.strikes.delete(id);
  }
  if (state.strikes.size > MAX_BUFFER) {
    const sorted = [...state.strikes.values()].sort((a, b) => a.time - b.time);
    const drop = sorted.length - MAX_BUFFER;
    for (let i = 0; i < drop; i++) {
      state.strikes.delete(sorted[i]!.id);
    }
  }
}

function scheduleReconnect(state: GlobalFeed, delayMs: number) {
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.status = "reconnecting";
  state.reconnectTimer = setTimeout(() => {
    state.hostIndex = (state.hostIndex + 1) % WS_HOSTS.length;
    connect(state);
  }, delayMs);
}

function connect(state: GlobalFeed) {
  if (state.ws) {
    try {
      state.ws.close();
    } catch {
      /* ignore */
    }
    state.ws = null;
  }

  const host = WS_HOSTS[state.hostIndex]!;
  state.status = "connecting";
  state.host = host;

  let ws: WebSocket;
  try {
    ws = new WebSocket(host);
  } catch {
    scheduleReconnect(state, 4000);
    return;
  }
  state.ws = ws;

  ws.addEventListener("open", () => {
    if (state.ws !== ws) return;
    state.status = "live";
    try {
      ws.send(JSON.stringify({ a: 111 }));
    } catch {
      scheduleReconnect(state, 3000);
    }
  });

  ws.addEventListener("message", (ev) => {
    if (state.ws !== ws) return;
    const raw = typeof ev.data === "string" ? ev.data : null;
    if (!raw) return;
    const obj = parseStrikeMessage(raw);
    if (!obj) return;
    state.receivedTotal += 1;
    const strike = toStrike(obj);
    if (!strike) return;
    state.strikes.set(strike.id, strike);
  });

  ws.addEventListener("close", () => {
    if (state.ws !== ws) return;
    state.ws = null;
    scheduleReconnect(state, 2500);
  });

  ws.addEventListener("error", () => {
    if (state.ws !== ws) return;
    state.status = "error";
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
}

/** Ensure the live Blitzortung subscriber is running (idempotent). */
export function ensureLightningFeed() {
  const state = getState();
  if (state.started) return;
  state.started = true;
  connect(state);
  state.pruneTimer = setInterval(() => prune(state), 15_000);
}

export function getLiveLightningSnapshot(): LiveLightningSnapshot {
  ensureLightningFeed();
  const state = getState();
  prune(state);
  const strikes = [...state.strikes.values()].sort((a, b) => b.time - a.time);
  return {
    strikes,
    status: state.status,
    connectedHost: state.host,
    generated: Math.floor(Date.now() / 1000),
    receivedTotal: state.receivedTotal,
    windowMinutes: 30,
    source: "blitzortung",
    attribution:
      "Live lightning © Blitzortung.org / LightningMaps.org (CC BY-SA)",
  };
}
