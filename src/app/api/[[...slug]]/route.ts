import { NextRequest, NextResponse } from "next/server";
import * as adminDays from "@/server/api/admin-days";
import * as adminLogin from "@/server/api/admin-login";
import * as adminLogout from "@/server/api/admin-logout";
import * as adminSession from "@/server/api/admin-session";
import * as adminUpload from "@/server/api/admin-upload";
import * as forecast from "@/server/api/forecast";
import * as weatherFrame from "@/server/api/weather-frame";
import * as weatherLightning from "@/server/api/weather-lightning";
import * as weatherMaps from "@/server/api/weather-maps";
import * as weatherSynoptic from "@/server/api/weather-synoptic";
import * as weatherSynopticFrame from "@/server/api/weather-synoptic-frame";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 60;

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response> | Response;

type RouteHandlers = {
  GET?: Handler;
  POST?: Handler;
  PUT?: Handler;
  PATCH?: Handler;
  DELETE?: Handler;
};

const ROUTES: Record<string, RouteHandlers> = {
  "admin/days": adminDays as RouteHandlers,
  "admin/login": adminLogin as RouteHandlers,
  "admin/logout": adminLogout as RouteHandlers,
  "admin/session": adminSession as RouteHandlers,
  "admin/upload": adminUpload as RouteHandlers,
  forecast: forecast as RouteHandlers,
  "weather/frame": weatherFrame as RouteHandlers,
  "weather/lightning": weatherLightning as RouteHandlers,
  "weather/maps": weatherMaps as RouteHandlers,
  "weather/synoptic": weatherSynoptic as RouteHandlers,
  "weather/synoptic/frame": weatherSynopticFrame as RouteHandlers,
};

function resolve(
  slug: string[] | undefined,
  method: string,
): Handler | null {
  const key = (slug ?? []).join("/");
  const route = ROUTES[key];
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
