/**
 * Cinematic one-liner “moments” for home share cards — consumer delight, not
 * a second forecast product.
 */

import type { ModelComparisonPayload } from "@/lib/weather/models";
import type { StormActivityPayload } from "@/lib/weather/storm-activity";

export type SkywatchMoment = {
  eyebrow: string;
  headline: string;
  detail: string;
  shareText: string;
  href: string;
  mood: "storm" | "rain" | "heat" | "calm";
};

function rainMm(models: ModelComparisonPayload | null): number | null {
  const v = models?.models?.ecmwf?.metrics?.rainMm;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function maxTemp(models: ModelComparisonPayload | null): number | null {
  const v = models?.models?.ecmwf?.metrics?.maxTempC;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function buildSkywatchMoment(opts: {
  placeName: string;
  storm: StormActivityPayload | null;
  models: ModelComparisonPayload | null;
}): SkywatchMoment {
  const place = opts.placeName || "Australia";
  const top = opts.storm?.hotspots[0] ?? null;
  const rain = rainMm(opts.models);
  const hot = maxTemp(opts.models);

  if (top && top.ratePerMin >= 2) {
    const headline = `Lightning detected near ${top.label}`;
    const detail = `About ${top.ratePerMin} detections per minute, with ${top.strikes15m} in the past 15 minutes. View the live map for details.`;
    return {
      eyebrow: "Live moment",
      headline,
      detail,
      shareText: `${headline}. ${detail}`,
      href: "/radar?lightning=1",
      mood: "storm",
    };
  }

  if (top && (opts.storm?.total15m ?? 0) >= 20) {
    const headline = `Storms lighting up ${top.label}`;
    const detail = `The lightning network recorded ${opts.storm!.total15m} strikes in the past 15 minutes. View the live map for details.`;
    return {
      eyebrow: "Live moment",
      headline,
      detail,
      shareText: `${headline}. ${detail}`,
      href: "/radar?lightning=1",
      mood: "storm",
    };
  }

  if (rain != null && rain >= 5) {
    const headline = `Wet day shaping up for ${place}`;
    const detail = `The forecast shows about ${Math.round(rain * 10) / 10} mm of rain today. Compare forecasts to see how they differ.`;
    return {
      eyebrow: "Near you",
      headline,
      detail,
      shareText: `${headline}. ${detail}`,
      href: "/model-comparison",
      mood: "rain",
    };
  }

  if (hot != null && hot >= 32) {
    const headline = `Heat building toward ${Math.round(hot)}° in ${place}`;
    const detail = `The forecast maximum is ${Math.round(hot)}° today. Stay cool and keep an eye on the afternoon sky.`;
    return {
      eyebrow: "Near you",
      headline,
      detail,
      shareText: `${headline}. ${detail}`,
      href: `/models?product=temperature_2m`,
      mood: "heat",
    };
  }

  if (rain != null && rain >= 1) {
    const headline = `A few showers in the mix for ${place}`;
    const detail = `Forecasts suggest about ${Math.round(rain * 10) / 10} mm of rain. View the map to see where showers may fall.`;
    return {
      eyebrow: "Near you",
      headline,
      detail,
      shareText: `${headline}. ${detail}`,
      href: "/models?product=precipitation",
      mood: "rain",
    };
  }

  return {
    eyebrow: "Weather near you",
    headline: `Quiet skies near ${place}`,
    detail:
      "No strong lightning activity right now. Explore radar, satellite images, and forecasts while it’s calm.",
    shareText: `Quiet skies near ${place} on StormFront Australia — live radar, lightning and forecasts.`,
    href: "/models",
    mood: "calm",
  };
}
