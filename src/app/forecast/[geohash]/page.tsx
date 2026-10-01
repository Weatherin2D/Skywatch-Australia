import { ForecastExplorer } from "@/components/forecast/forecast-explorer";

export const dynamic = "force-dynamic";

export default async function ForecastLocationPage({
  params,
}: {
  params: Promise<{ geohash: string }>;
}) {
  const { geohash } = await params;
  return <ForecastExplorer geohash={geohash} />;
}
