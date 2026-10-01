import { Suspense } from "react";
import { ForecastExplorer } from "@/components/forecast/forecast-explorer";

export const dynamic = "force-dynamic";

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string; geohash?: string; q?: string }>;
}) {
  const params = await searchParams;
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--page)] text-white/70">
          Loading forecast…
        </div>
      }
    >
      <ForecastExplorer
        geohash={params.geohash || null}
        region={params.region || null}
      />
    </Suspense>
  );
}
