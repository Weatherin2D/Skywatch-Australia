import { NextRequest, NextResponse } from "next/server";
import * as forecast from "@/server/api/forecast";
import * as weatherFrame from "@/server/api/weather-frame";
import * as weatherLightning from "@/server/api/weather-lightning";
import * as weatherMaps from "@/server/api/weather-maps";
import * as weatherSynoptic from "@/server/api/weather-synoptic";
import * as weatherSynopticFrame from "@/server/api/weather-synoptic-frame";
import * as weatherWarnings from "@/server/api/weather-warnings";
import * as weatherLocations from "@/server/api/weather-locations";
import * as weatherLocationForecast from "@/server/api/weather-location-forecast";
import * as weatherCapitals from "@/server/api/weather-capitals";
import * as weatherStormActivity from "@/server/api/weather-storm-activity";
import * as weatherStormCells from "@/server/api/weather-storm-cells";
import * as weatherModels from "@/server/api/weather-models";
import * as weatherEcmwfMap from "@/server/api/weather-ecmwf-map";
import * as weatherEcmwfMapFrame from "@/server/api/weather-ecmwf-map-frame";
import * as weatherEcmwfMapPoint from "@/server/api/weather-ecmwf-map-point";
import * as weatherUpperAir from "@/server/api/weather-upper-air";
import * as weatherSounding from "@/server/api/weather-sounding";
import * as weatherRadarTile from "@/server/api/weather-radar-tile";
import * as weatherRisk from "@/server/api/weather-risk";
import * as weatherRiskImage from "@/server/api/weather-risk-image";
import * as weatherRiskProbe from "@/server/api/weather-risk-probe";
import * as weatherClimate from "@/server/api/weather-climate";
import * as weatherEnsemble from "@/server/api/weather-ensemble";
import * as weatherCrossSection from "@/server/api/weather-cross-section";
import * as weatherHazards from "@/server/api/weather-hazards";
import * as weatherArchive from "@/server/api/weather-archive";
import * as weatherArchiveFrame from "@/server/api/weather-archive-frame";
import * as weatherArchiveSynoptic from "@/server/api/weather-archive-synoptic";
import * as weatherArchiveLightning from "@/server/api/weather-archive-lightning";
import * as weatherArchiveIngest from "@/server/api/weather-archive-ingest";
import * as community from "@/server/api/community";
import * as communityImage from "@/server/api/community-image";
import * as communityLike from "@/server/api/community-like";
import * as communityComment from "@/server/api/community-comment";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 120;

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response> | Response;

type RouteHandlers = {
  GET?: Handler;
  POST?: Handler;
  PUT?: Handler;
  PATCH?: Handler;
  DELETE?: Handler;
};

const ROUTES: Record<string, RouteHandlers> = {
  forecast: forecast as RouteHandlers,
  "weather/frame": weatherFrame as RouteHandlers,
  "weather/lightning": weatherLightning as RouteHandlers,
  "weather/maps": weatherMaps as RouteHandlers,
  "weather/synoptic": weatherSynoptic as RouteHandlers,
  "weather/synoptic/frame": weatherSynopticFrame as RouteHandlers,
  "weather/warnings": weatherWarnings as RouteHandlers,
  "weather/locations": weatherLocations as RouteHandlers,
  "weather/forecast": weatherLocationForecast as RouteHandlers,
  "weather/capitals": weatherCapitals as RouteHandlers,
  "weather/storm-activity": weatherStormActivity as RouteHandlers,
  "weather/storm-cells": weatherStormCells as RouteHandlers,
  "weather/models": weatherModels as RouteHandlers,
  "weather/ecmwf-map": weatherEcmwfMap as RouteHandlers,
  "weather/ecmwf-map/frame": weatherEcmwfMapFrame as RouteHandlers,
  "weather/ecmwf-map/point": weatherEcmwfMapPoint as RouteHandlers,
  "weather/upper-air": weatherUpperAir as RouteHandlers,
  "weather/sounding": weatherSounding as RouteHandlers,
  "weather/radar-tile": weatherRadarTile as RouteHandlers,
  "weather/risk": weatherRisk as RouteHandlers,
  "weather/risk-image": weatherRiskImage as RouteHandlers,
  "weather/risk-probe": weatherRiskProbe as RouteHandlers,
  "weather/climate": weatherClimate as RouteHandlers,
  "weather/ensemble": weatherEnsemble as RouteHandlers,
  "weather/cross-section": weatherCrossSection as RouteHandlers,
  "weather/hazards": weatherHazards as RouteHandlers,
  "weather/archive": weatherArchive as RouteHandlers,
  "weather/archive/frame": weatherArchiveFrame as RouteHandlers,
  "weather/archive/synoptic": weatherArchiveSynoptic as RouteHandlers,
  "weather/archive/lightning": weatherArchiveLightning as RouteHandlers,
  "weather/archive/ingest": weatherArchiveIngest as RouteHandlers,
  community: community as RouteHandlers,
  "community/image": communityImage as RouteHandlers,
  "community/like": communityLike as RouteHandlers,
  "community/comment": communityComment as RouteHandlers,
};

function resolve(
  slug: string[] | undefined,
  method: string,
): Handler | null {
  const parts = slug ?? [];
  const key = parts.join("/");
  let route = ROUTES[key];
  // /api/weather/warnings/:id → same handler (reads id from path)
  if (
    !route &&
    parts.length === 3 &&
    parts[0] === "weather" &&
    parts[1] === "warnings"
  ) {
    route = ROUTES["weather/warnings"];
  }
  // /api/weather/forecast/:geohash
  if (
    !route &&
    parts.length === 3 &&
    parts[0] === "weather" &&
    parts[1] === "forecast"
  ) {
    route = ROUTES["weather/forecast"];
  }
  if (!route) return null;
  const handler = route[method as keyof RouteHandlers];
  return handler ?? null;
}

async function dispatch(
  request: NextRequest,
  ctx: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await ctx.params;
  const handler = resolve(slug, request.method);
  if (!handler) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Support both (req) => … and () => … route handlers.
  if (handler.length === 0) {
    return (handler as () => Promise<Response> | Response)();
  }
  return handler(request);
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ slug?: string[] }> },
) {
  return dispatch(request, ctx);
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug?: string[] }> },
) {
  return dispatch(request, ctx);
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ slug?: string[] }> },
) {
  return dispatch(request, ctx);
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ slug?: string[] }> },
) {
  return dispatch(request, ctx);
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ slug?: string[] }> },
) {
  return dispatch(request, ctx);
}
