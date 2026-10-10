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
    const headline = `Lightning punching ${top.label}`;
    const detail = `${top.ratePerMin}/min · ${top.strikes15m} strikes in 15 min — CloudCountry is watching the cells.`;
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
    const detail = `National network: ${opts.storm!.total15m} strikes / 15 min. Tap in for the live map.`;
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
    const detail = `ECMWF sees about ${Math.round(rain * 10) / 10} mm today — compare models side by side.`;
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
    const detail = `ECMWF max today · stay cool and keep an eye on the afternoon sky.`;
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
    const detail = `Models lean ~${Math.round(rain * 10) / 10} mm — scrub the ECMWF rain field for the pattern.`;
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
    eyebrow: "CloudCountry moment",
    headline: `Quiet skies near ${place}`,
    detail:
      "No strong lightning clusters right now — explore radar, satellite, and ECMWF models while it’s calm.",
    shareText: `Quiet skies near ${place} on CloudCountry — live radar, lightning and ECMWF models.`,
    href: "/models",
    mood: "calm",
  };
}
