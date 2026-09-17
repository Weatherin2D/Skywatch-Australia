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
  "wss://ws7.blitzortung.org",
  "wss://ws8.blitzortung.org",
] as const;

export type ClientLightningHandle = {
  stop: () => void;
};

function pickHost(index: number) {
  return WS_HOSTS[index % WS_HOSTS.length]!;
}

/**
 * Start a live Blitzortung socket. Calls `onStrike` for each in-bounds strike.
 * Automatically reconnects with host rotation.
 */
export function startClientLightningFeed(
  onStrike: (strike: LightningStrike) => void,
): ClientLightningHandle {
  let stopped = false;
  let hostIndex = 0;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = (delayMs: number) => {
    clearReconnect();
    if (stopped) return;
    reconnectTimer = setTimeout(() => {
      hostIndex += 1;
      connect();
    }, delayMs);
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

  const connect = () => {
    if (stopped) return;
    clearReconnect();
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }

    const host = pickHost(hostIndex);
    try {
      ws = new WebSocket(host);
    } catch {
      scheduleReconnect(4000);
      return;
    }

    const socket = ws;
    socket.addEventListener("open", () => {
      if (stopped || ws !== socket) return;
      try {
        socket.send(JSON.stringify({ a: 111 }));
      } catch {
        scheduleReconnect(3000);
      }
    });

    socket.addEventListener("message", (ev) => {
      if (stopped || ws !== socket) return;
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
          if (stopped || ws !== socket) return;
          handleRaw(new TextDecoder("latin1").decode(ab));
        });
      }
    });

    socket.addEventListener("close", () => {
      if (stopped || ws !== socket) return;
      ws = null;
      scheduleReconnect(2500);
    });

    socket.addEventListener("error", () => {
      if (stopped || ws !== socket) return;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    });
  };

  connect();

  return {
    stop: () => {
      stopped = true;
      clearReconnect();
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }
    },
  };
}
