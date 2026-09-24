/**
 * Live lightning for the Australian region — Blitzortung (open network).
 *
 * Windy.com switched to commercial Nowcast LINET (not publicly available).
 * We use Blitzortung — the same open network Windy used before LINET — with
 * real strike timestamps so the IR loop shows accurate storm motion.
 *
 * Sources:
 *  1. Blitzortung public WebSockets (all hosts in parallel)
 *  2. Community MQTT proxy (blitzortung.ha.sed.pl) geohash topics for Oceania
 *
 * No LightningMaps PNG “age inventing” — that polluted the buffer with fake
 * times and made every satellite frame look the same.
 */

import { promises as fs } from "fs";
import path from "path";
import mqtt, { type MqttClient } from "mqtt";
import type { LightningStrike } from "@/lib/weather/lightning";
import {
  parseStrikeMessage,
  toStrike,
} from "@/lib/weather/blitzortung-parse";

const WS_HOSTS = [
  "wss://ws1.blitzortung.org",
  "wss://ws2.blitzortung.org",
  "wss://ws3.blitzortung.org",
  "wss://ws4.blitzortung.org",
  "wss://ws5.blitzortung.org",
  "wss://ws6.blitzortung.org",
  "wss://ws7.blitzortung.org",
  "wss://ws8.blitzortung.org",
] as const;

const MQTT_URL = "mqtt://blitzortung.ha.sed.pl:1883";
/** Geohash prefixes covering Australia / nearby Indian & Pacific oceans. */
const MQTT_GEOHASH_PREFIXES = ["p", "q", "r", "s", "t"] as const;

const WINDOW_SEC = 24 * 60 * 60;
const MAX_BUFFER = 40_000;
const PERSIST_PATH = path.join(
  process.env.TMPDIR || "/tmp",
  "skywatch-lightning-strikes.json",
);
const PERSIST_EVERY_MS = 12_000;

type FeedStatus = "connecting" | "live" | "reconnecting" | "error";

export type LiveLightningSnapshot = {
  strikes: LightningStrike[];
  status: FeedStatus;
  connectedHost: string | null;
  generated: number;
  receivedTotal: number;
  receivedInBounds: number;
  windowMinutes: number;
  attribution: string;
  source: "blitzortung";
};

type GlobalFeed = {
  strikes: Map<string, LightningStrike>;
  status: FeedStatus;
  host: string | null;
  receivedTotal: number;
  receivedInBounds: number;
  sockets: Map<string, WebSocket>;
  mqtt: MqttClient | null;
  reconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
  pruneTimer: ReturnType<typeof setInterval> | null;
  persistTimer: ReturnType<typeof setInterval> | null;
  started: boolean;
  persistDirty: boolean;
};

const g = globalThis as typeof globalThis & {
  __skywatchBlitzFeedV9?: GlobalFeed;
};

function getState(): GlobalFeed {
  if (!g.__skywatchBlitzFeedV9) {
    g.__skywatchBlitzFeedV9 = {
      strikes: new Map(),
      status: "connecting",
      host: null,
      receivedTotal: 0,
      receivedInBounds: 0,
      sockets: new Map(),
      mqtt: null,
      reconnectTimers: new Map(),
      pruneTimer: null,
      persistTimer: null,
      started: false,
      persistDirty: false,
    };
  }
  return g.__skywatchBlitzFeedV9;
}

function isRealStrikeId(id: string) {
  // Drop legacy LightningMaps PNG inventions (lm-*) — inaccurate ages.
  return !id.startsWith("lm-");
}

function ingest(state: GlobalFeed, obj: Record<string, unknown>) {
  state.receivedTotal += 1;
  const strike = toStrike(obj);
  if (!strike) return;
  if (!isRealStrikeId(strike.id)) return;
  state.receivedInBounds += 1;
  state.strikes.set(strike.id, strike);
  state.status = "live";
  state.persistDirty = true;
}

function prune(state: GlobalFeed) {
  const cutoff = Math.floor(Date.now() / 1000) - WINDOW_SEC;
  for (const [id, strike] of state.strikes) {
    if (!isRealStrikeId(id) || strike.time < cutoff) {
      state.strikes.delete(id);
      state.persistDirty = true;
    }
  }
  if (state.strikes.size > MAX_BUFFER) {
    const sorted = [...state.strikes.values()].sort((a, b) => a.time - b.time);
    const drop = sorted.length - MAX_BUFFER;
    for (let i = 0; i < drop; i++) {
      state.strikes.delete(sorted[i]!.id);
    }
    state.persistDirty = true;
  }
}

async function loadPersisted(state: GlobalFeed) {
  try {
    const raw = await fs.readFile(PERSIST_PATH, "utf8");
    const parsed = JSON.parse(raw) as { strikes?: LightningStrike[] };
    if (!Array.isArray(parsed.strikes)) return;
    const cutoff = Math.floor(Date.now() / 1000) - WINDOW_SEC;
    let n = 0;
    for (const s of parsed.strikes) {
      if (!s?.id || !isRealStrikeId(s.id)) continue;
      if (!Number.isFinite(s.time) || s.time < cutoff) continue;
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
      state.strikes.set(s.id, s);
      n += 1;
    }
    if (n > 0) {
      state.receivedInBounds = Math.max(state.receivedInBounds, n);
      console.info(`[lightning] restored ${n} persisted Blitzortung strikes`);
    }
  } catch {
    /* no persist file yet */
  }
}

async function savePersisted(state: GlobalFeed) {
  if (!state.persistDirty) return;
  state.persistDirty = false;
  try {
    const strikes = [...state.strikes.values()]
      .filter((s) => isRealStrikeId(s.id))
      .sort((a, b) => b.time - a.time)
      .slice(0, MAX_BUFFER);
    await fs.writeFile(
      PERSIST_PATH,
      JSON.stringify({ savedAt: Date.now(), strikes }),
      "utf8",
    );
  } catch (err) {
    console.error("lightning persist failed", err);
  }
}

function scheduleWsReconnect(state: GlobalFeed, host: string, delayMs: number) {
  const existing = state.reconnectTimers.get(host);
  if (existing) clearTimeout(existing);
  state.status = "reconnecting";
  state.reconnectTimers.set(
    host,
    setTimeout(() => {
      state.reconnectTimers.delete(host);
      connectWs(state, host);
    }, delayMs),
  );
}

function connectWs(state: GlobalFeed, host: string) {
  const prev = state.sockets.get(host);
  if (prev) {
    try {
      prev.close();
    } catch {
      /* ignore */
    }
    state.sockets.delete(host);
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(host);
  } catch {
    scheduleWsReconnect(state, host, 4000);
    return;
  }
  state.sockets.set(host, ws);
  if (!state.host) state.host = host;

  ws.addEventListener("open", () => {
    if (state.sockets.get(host) !== ws) return;
    state.status = "live";
    state.host = host;
    try {
      ws.send(JSON.stringify({ a: 111 }));
    } catch {
      scheduleWsReconnect(state, host, 3000);
    }
  });

  ws.addEventListener("message", (ev) => {
    if (state.sockets.get(host) !== ws) return;
    let raw: string | null = null;
    if (typeof ev.data === "string") {
      raw = ev.data;
    } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(ev.data)) {
      raw = ev.data.toString("binary");
    } else if (ev.data instanceof ArrayBuffer) {
      raw = Buffer.from(ev.data).toString("binary");
    }
    if (!raw) return;
    const obj = parseStrikeMessage(raw);
    if (!obj) return;
    ingest(state, obj);
  });

  ws.addEventListener("close", () => {
    if (state.sockets.get(host) !== ws) return;
    state.sockets.delete(host);
    scheduleWsReconnect(state, host, 2500);
  });

  ws.addEventListener("error", () => {
    if (state.sockets.get(host) !== ws) return;
    state.status = "error";
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
}

function connectMqtt(state: GlobalFeed) {
  if (state.mqtt) {
    try {
      state.mqtt.end(true);
    } catch {
      /* ignore */
    }
    state.mqtt = null;
  }

  const client = mqtt.connect(MQTT_URL, {
    clientId: `skywatch-${Math.random().toString(16).slice(2, 10)}`,
    clean: true,
    connectTimeout: 12_000,
    reconnectPeriod: 5000,
    keepalive: 30,
  });
  state.mqtt = client;

  client.on("connect", () => {
    state.status = "live";
    for (const prefix of MQTT_GEOHASH_PREFIXES) {
      const topic = `blitzortung/1.1/${prefix}/#`;
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) console.error("lightning mqtt subscribe failed", topic, err);
      });
    }
  });

  client.on("message", (_topic, payload) => {
    try {
      const obj = JSON.parse(payload.toString()) as Record<string, unknown>;
      ingest(state, obj);
    } catch {
      /* ignore non-JSON */
    }
  });

  client.on("error", (err) => {
    console.error("lightning mqtt error", err.message);
  });

  client.on("close", () => {
    if (state.mqtt === client) {
      state.status = state.sockets.size > 0 ? "live" : "reconnecting";
    }
  });
}

/** Ensure live subscribers are running (idempotent). */
export function ensureLightningFeed() {
  const state = getState();
  if (state.started) return;
  state.started = true;
  state.status = "connecting";
  void loadPersisted(state).then(() => prune(state));
  for (const host of WS_HOSTS) {
    connectWs(state, host);
  }
  connectMqtt(state);
  state.pruneTimer = setInterval(() => prune(state), 15_000);
  state.persistTimer = setInterval(() => {
    void savePersisted(state);
  }, PERSIST_EVERY_MS);
}

/**
 * Snapshot for API responses. Uses only real Blitzortung timestamps so each
 * satellite frame filters accurately (Windy-style absolute-time trail).
 */
export async function getLiveLightningSnapshot(): Promise<LiveLightningSnapshot> {
  ensureLightningFeed();
  const state = getState();
  // Brief wait on empty cold start so WS/MQTT can deliver first strikes.
  if (state.strikes.size < 5) {
    await new Promise((r) => setTimeout(r, 1200));
  }
  prune(state);
  const strikes = [...state.strikes.values()]
    .filter((s) => isRealStrikeId(s.id))
    .sort((a, b) => b.time - a.time);
  const liveHosts = [...state.sockets.entries()]
    .filter(([, ws]) => ws.readyState === WebSocket.OPEN)
    .map(([h]) => h);
  return {
    strikes,
    status: state.status,
    connectedHost: liveHosts[0] ?? state.host,
    generated: Math.floor(Date.now() / 1000),
    receivedTotal: state.receivedTotal,
    receivedInBounds: state.receivedInBounds,
    windowMinutes: Math.round(WINDOW_SEC / 60),
    source: "blitzortung",
    attribution:
      "Live lightning © Blitzortung.org (CC BY-SA) — open network (Windy uses commercial Nowcast LINET)",
  };
}
