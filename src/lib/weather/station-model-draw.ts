/**
 * Canvas renderer for classic meteorological station models
 * (temp / dewpoint / pressure / wind / clouds / present weather / tendency).
 */

import type {
  PresentWeather,
  PressureTendency,
  WeatherStation,
} from "@/lib/weather/stations";
import {
  formatStationPressure,
  formatStationTemp,
} from "@/lib/weather/stations";

const SIZE = 96;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 7;

function longBarbKmh(speed: number): { flags: number; longs: number; shorts: number } {
  // Diagram uses kph bands; approximate WMO-style packing with 50-kt flags ≈ 93 kph.
  let rem = Math.max(0, speed);
  const flags = Math.floor((rem + 2) / 93);
  rem -= flags * 93;
  const longs = Math.floor((rem + 2) / 19);
  rem -= longs * 19;
  const shorts = rem >= 4 ? 1 : 0;
  return { flags, longs, shorts };
}

function drawCloudCover(
  ctx: CanvasRenderingContext2D,
  pct: number | null,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8,14,28,0.55)";
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "#e8eef9";
  ctx.stroke();

  if (pct == null) {
    // Obscured / missing
    ctx.beginPath();
    ctx.moveTo(CX - R * 0.55, CY - R * 0.55);
    ctx.lineTo(CX + R * 0.55, CY + R * 0.55);
    ctx.moveTo(CX + R * 0.55, CY - R * 0.55);
    ctx.lineTo(CX - R * 0.55, CY + R * 0.55);
    ctx.strokeStyle = "#e8eef9";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    return;
  }

  const p = Math.max(0, Math.min(100, pct));
  if (p <= 5) {
    ctx.restore();
    return;
  }
  if (p <= 15) {
    ctx.beginPath();
    ctx.moveTo(CX, CY - R);
    ctx.lineTo(CX, CY + R);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(CX, CY);
  // Fill clockwise from top by sky cover fraction.
  const start = -Math.PI / 2;
  const sweep = (Math.PI * 2 * p) / 100;
  ctx.arc(CX, CY, R - 0.6, start, start + sweep, false);
  ctx.closePath();
  ctx.fillStyle = "#e8eef9";
  ctx.fill();
  ctx.restore();
}

function drawWind(
  ctx: CanvasRenderingContext2D,
  dirDeg: number | null,
  speedKmh: number | null,
) {
  if (speedKmh != null && speedKmh < 1) {
    // Calm — concentric circle
    ctx.beginPath();
    ctx.arc(CX, CY, R + 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = "#e8eef9";
    ctx.lineWidth = 1.1;
    ctx.stroke();
    return;
  }
  if (dirDeg == null || speedKmh == null) return;

  // Staff points toward the direction the wind is FROM (meteorological).
  const rad = ((dirDeg - 90) * Math.PI) / 180;
  const len = 28;
  const tipX = CX + Math.cos(rad) * len;
  const tipY = CY + Math.sin(rad) * len;
  const baseX = CX + Math.cos(rad) * (R + 1);
  const baseY = CY + Math.sin(rad) * (R + 1);

  ctx.strokeStyle = "#e8eef9";
  ctx.fillStyle = "#e8eef9";
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  const { flags, longs, shorts } = longBarbKmh(speedKmh);
  const px = -Math.sin(rad); // perpendicular
  const py = Math.cos(rad);
  let t = 0; // distance back from tip along staff
  const step = 4.2;

  const placeBarb = (barbLen: number, solid: boolean) => {
    const sx = tipX - Math.cos(rad) * t;
    const sy = tipY - Math.sin(rad) * t;
    const ex = sx + px * barbLen;
    const ey = sy + py * barbLen;
    if (solid) {
      // Flag pennant
      const midX = tipX - Math.cos(rad) * (t + 3.2);
      const midY = tipY - Math.sin(rad) * (t + 3.2);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.lineTo(midX, midY);
      ctx.closePath();
      ctx.fill();
      t += step + 1.5;
    } else {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      t += step;
    }
  };

  for (let i = 0; i < flags; i++) placeBarb(11, true);
  for (let i = 0; i < longs; i++) placeBarb(11, false);
  for (let i = 0; i < shorts; i++) placeBarb(6, false);
}

function drawPresentWeather(
  ctx: CanvasRenderingContext2D,
  weather: PresentWeather,
) {
  if (weather === "clear") return;
  const x = CX - 18;
  const y = CY;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#e8eef9";
  ctx.strokeStyle = "#e8eef9";
  ctx.lineWidth = 1.2;

  const dots = (n: number, gap = 3.2) => {
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc((i - (n - 1) / 2) * gap, 0, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const stars = (n: number) => {
    for (let i = 0; i < n; i++) {
      const sx = (i - (n - 1) / 2) * 4;
      ctx.beginPath();
      ctx.moveTo(sx, -2.4);
      ctx.lineTo(sx, 2.4);
      ctx.moveTo(sx - 2.4, 0);
      ctx.lineTo(sx + 2.4, 0);
      ctx.moveTo(sx - 1.6, -1.6);
      ctx.lineTo(sx + 1.6, 1.6);
      ctx.moveTo(sx - 1.6, 1.6);
      ctx.lineTo(sx + 1.6, -1.6);
      ctx.stroke();
    }
  };

  switch (weather) {
    case "rain-light":
      dots(2);
      break;
    case "rain-mod":
      dots(3);
      break;
    case "rain-heavy":
      dots(4);
      break;
    case "rain-shower":
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(3.5, 3);
      ctx.lineTo(-3.5, 3);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -5.5, 1.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "snow-light":
      stars(2);
      break;
    case "snow-mod":
      stars(3);
      break;
    case "snow-heavy":
      stars(4);
      break;
    case "snow-shower":
      ctx.beginPath();
      ctx.moveTo(0, -1);
      ctx.lineTo(3.5, 4);
      ctx.lineTo(-3.5, 4);
      ctx.closePath();
      ctx.stroke();
      stars(1);
      break;
    case "ice-pellets":
      ctx.beginPath();
      ctx.moveTo(0, -3.5);
      ctx.lineTo(3.5, 3);
      ctx.lineTo(-3.5, 3);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0.5, 1.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "fog":
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-5, i * 2.4);
        ctx.lineTo(5, i * 2.4);
        ctx.stroke();
      }
      break;
    case "thunderstorm":
      ctx.beginPath();
      ctx.moveTo(-1, -5);
      ctx.lineTo(3, -5);
      ctx.lineTo(0, 0);
      ctx.lineTo(4, 0);
      ctx.lineTo(-3, 6);
      ctx.lineTo(-0.5, 1);
      ctx.lineTo(-4, 1);
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.restore();
}

function drawTendency(
  ctx: CanvasRenderingContext2D,
  tendency: PressureTendency | null,
) {
  if (!tendency) return;
  const x = CX + 16;
  const y = CY + 10;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#e8eef9";
  ctx.lineWidth = 1.3;
  ctx.lineCap = "round";
  ctx.beginPath();
  switch (tendency) {
    case "rising":
      ctx.moveTo(-4, 3);
      ctx.lineTo(4, -3);
      break;
    case "falling":
      ctx.moveTo(-4, -3);
      ctx.lineTo(4, 3);
      break;
    case "steady":
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
      break;
    case "rising-then-falling":
      ctx.moveTo(-4, 2);
      ctx.lineTo(0, -3);
      ctx.lineTo(4, 2);
      break;
    case "falling-then-rising":
      ctx.moveTo(-4, -2);
      ctx.lineTo(0, 3);
      ctx.lineTo(4, -2);
      break;
    case "rising-then-steady":
      ctx.moveTo(-4, 3);
      ctx.lineTo(0, -2);
      ctx.lineTo(4, -2);
      break;
    case "falling-then-steady":
      ctx.moveTo(-4, -3);
      ctx.lineTo(0, 2);
      ctx.lineTo(4, 2);
      break;
  }
  ctx.stroke();
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign = "left",
) {
  if (!text) return;
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(7,11,22,0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#f4f8ff";
  ctx.fillText(text, x, y);
}

export function drawStationModel(
  ctx: CanvasRenderingContext2D,
  station: WeatherStation,
) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  drawWind(ctx, station.windDirDeg, station.windSpeedKmh);
  drawCloudCover(ctx, station.cloudCoverPct);
  drawPresentWeather(ctx, station.presentWeather);
  drawTendency(ctx, station.pressureTendency);

  drawLabel(ctx, formatStationTemp(station.temperatureC), CX - 14, CY - 16, "right");
  drawLabel(ctx, formatStationTemp(station.dewpointC), CX - 14, CY + 16, "right");
  drawLabel(ctx, formatStationPressure(station.pressureHpa), CX + 14, CY - 16, "left");
  if (station.pressureChangeTenths != null) {
    drawLabel(
      ctx,
      String(station.pressureChangeTenths),
      CX + 14,
      CY + 1,
      "left",
    );
  }
}

export const STATION_MODEL_SIZE = SIZE;

export function stationModelDataUrl(station: WeatherStation): string {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  drawStationModel(ctx, station);
  return canvas.toDataURL("image/png");
}
