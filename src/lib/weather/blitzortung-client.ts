"use client";

/**
 * Browser-side Blitzortung WebSocket — complements the server feed.
 * Connecting from the user's network improves Oceania/AU delivery versus
 * relying solely on a remote cloud host.
 */

import {
  decodeBlitzLzw,
  inLightningBounds,
  parseStrikeMessage,
  toStrike,
} from "@/lib/weather/blitzortung-parse";
import type { LightningStrike } from "@/lib/weather/lightning";

const WS_HOSTS = [
  "wss://ws1.blitzortung.org",
  "wss://ws3.blitzortung.org",
  "wss://ws6.blitzortung.org",
  "wss://ws7.blitzortung.org",
  "wss://ws8.blitzortung.org",
] as const;

export type ClientLightningHandle = {
  stop: () => void;
};

/**
 * Start live Blitzortung sockets on every host in parallel.
 * Oceania delivery varies by server; multi-host listening fills gaps.
 */
export function startClientLightningFeed(
  onStrike: (strike: LightningStrike) => void,
): ClientLightningHandle {
  let stopped = false;
  const sockets = new Map<string, WebSocket>();
  const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearReconnect = (host: string) => {
    const t = reconnectTimers.get(host);
    if (t) clearTimeout(t);
    reconnectTimers.delete(host);
  };

  const scheduleReconnect = (host: string, delayMs: number) => {
    clearReconnect(host);
    if (stopped) return;
    reconnectTimers.set(
      host,
      setTimeout(() => {
        reconnectTimers.delete(host);
        connect(host);
      }, delayMs),
    );
  };

  const handleRaw = (raw: string) => {
    let obj = parseStrikeMessage(raw);
    if (!obj) {
      try {
        obj = JSON.parse(decodeBlitzLzw(raw)) as Record<string, unknown>;
      } catch {
        return;
      }
    }
    const lat = Number(obj.lat);
    const lon = Number(obj.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!inLightningBounds(lat, lon)) return;
    const strike = toStrike(obj);
    if (strike) onStrike(strike);
  };

  const connect = (host: string) => {
    if (stopped) return;
    clearReconnect(host);
    const prev = sockets.get(host);
    if (prev) {
      try {
        prev.close();
      } catch {
        /* ignore */
      }
      sockets.delete(host);
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(host);
    } catch {
      scheduleReconnect(host, 4000);
      return;
    }
    sockets.set(host, ws);

    ws.addEventListener("open", () => {
      if (stopped || sockets.get(host) !== ws) return;
      try {
        ws.send(JSON.stringify({ a: 111 }));
      } catch {
        scheduleReconnect(host, 3000);
      }
    });

    ws.addEventListener("message", (ev) => {
      if (stopped || sockets.get(host) !== ws) return;
      if (typeof ev.data === "string") {
        handleRaw(ev.data);
        return;
      }
      if (ev.data instanceof ArrayBuffer) {
        handleRaw(new TextDecoder("latin1").decode(ev.data));
        return;
      }
      if (typeof Blob !== "undefined" && ev.data instanceof Blob) {
        void ev.data.arrayBuffer().then((ab) => {
          if (stopped || sockets.get(host) !== ws) return;
          handleRaw(new TextDecoder("latin1").decode(ab));
        });
      }
    });

    ws.addEventListener("close", () => {
      if (stopped || sockets.get(host) !== ws) return;
      sockets.delete(host);
      scheduleReconnect(host, 2500);
    });

    ws.addEventListener("error", () => {
      if (stopped || sockets.get(host) !== ws) return;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    });
  };

  for (const host of WS_HOSTS) connect(host);

  return {
    stop: () => {
      stopped = true;
      for (const host of WS_HOSTS) clearReconnect(host);
      for (const ws of sockets.values()) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      sockets.clear();
    },
  };
}
