import { NextResponse } from "next/server";
import {
  buildLightningStrikes,
  type LightningPayload,
} from "@/lib/weather/lightning";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const now = Math.floor(Date.now() / 1000);
  const strikes = buildLightningStrikes(now, 30);
  const payload: LightningPayload = {
    generated: now,
    source: "skywatch-tracker",
    windowMinutes: 30,
    strikes,
    attribution:
      "SkyWatch Lightning Tracker — storm-cell model for eastern Australia",
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=8, stale-while-revalidate=8",
    },
  });
}
