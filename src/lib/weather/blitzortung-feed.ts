/**
 * Live lightning for the Australian region.
 *
 * Sources (merged):
 *  1. Blitzortung public WebSockets (all hosts in parallel)
 *  2. Community MQTT proxy (blitzortung.ha.sed.pl) geohash topics for Oceania
 *
 * The public WS alone under-delivers Oceania/AU strikes from remote servers;
 * MQTT + multi-host listening keeps the rolling 30‑min window populated.
 */

import mqtt, { type MqttClient } from "mqtt";
import type { LightningStrike } from "@/lib/weather/lightning";
import {
  parseStrikeMessage,
  toStrike,
} from "@/lib/weather/blitzortung-parse";
import { fetchLightningMapsBackfill } from "@/lib/weather/lightningmaps-backfill";

const WS_HOSTS = [
  "wss://ws1.blitzortung.org",
  "wss://ws3.blitzortung.org",
  "wss://ws5.blitzortung.org",
  "wss://ws6.blitzortung.org",
  "wss://ws7.blitzortung.org",
  "wss://ws8.blitzortung.org",
] as const;

const MQTT_URL = "mqtt://blitzortung.ha.sed.pl:1883";
/** Geohash prefixes covering Australia / nearby Indian & Pacific oceans. */
const MQTT_GEOHASH_PREFIXES = ["p", "q", "r", "t"] as const;

const WINDOW_SEC = 24 * 60 * 60;
const MAX_BUFFER = 25_000;

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
  backfillTimer: ReturnType<typeof setInterval> | null;
  started: boolean;
};

const g = globalThis as typeof globalThis & {
  __skywatchBlitzFeedV7?: GlobalFeed;
};

function getState(): GlobalFeed {
  if (!g.__skywatchBlitzFeedV7) {
    g.__skywatchBlitzFeedV7 = {
      strikes: new Map(),
      status: "connecting",
      host: null,
      receivedTotal: 0,
      receivedInBounds: 0,
      sockets: new Map(),
      mqtt: null,
      reconnectTimers: new Map(),
      pruneTimer: null,
      backfillTimer: null,
      started: false,
    };
  }
  return g.__skywatchBlitzFeedV7;
}

function ingest(state: GlobalFeed, obj: Record<string, unknown>) {
  state.receivedTotal += 1;
  const strike = toStrike(obj);
  if (!strike) return;
  state.receivedInBounds += 1;
  state.strikes.set(strike.id, strike);
  state.status = "live";
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

async function runBackfill(state: GlobalFeed) {
  try {
    const { strikes } = await fetchLightningMapsBackfill();
    for (const strike of strikes) {
      const prev = state.strikes.get(strike.id);
      if (!prev || strike.time >= prev.time) {
        state.strikes.set(strike.id, strike);
        if (!prev) state.receivedInBounds += 1;
      }
    }
  } catch (err) {
    console.error("lightning backfill error", err);
  }
}

/** Ensure live subscribers are running (idempotent). */
export function ensureLightningFeed() {
  const state = getState();
  if (state.started) return;
  state.started = true;
  state.status = "connecting";
  for (const host of WS_HOSTS) {
    connectWs(state, host);
  }
  connectMqtt(state);
  state.pruneTimer = setInterval(() => prune(state), 15_000);
  void runBackfill(state);
  state.backfillTimer = setInterval(() => {
    void runBackfill(state);
  }, 30_000);
}

export function getLiveLightningSnapshot(): LiveLightningSnapshot {
  ensureLightningFeed();
  const state = getState();
  prune(state);
  const strikes = [...state.strikes.values()].sort((a, b) => b.time - a.time);
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
      "Live lightning © Blitzortung.org / LightningMaps.org (CC BY-SA)",
  };
}
