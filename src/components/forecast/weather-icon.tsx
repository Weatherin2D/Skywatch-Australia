import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloudy,
  Sun,
  Wind,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function WeatherIcon({
  icon,
  className,
  night = false,
}: {
  icon: string;
  className?: string;
  night?: boolean;
}) {
  const key = icon.toLowerCase();
  const cls = cn("h-6 w-6 shrink-0 text-[var(--cyan)]", className);

  if (key.includes("thunder") || key.includes("storm") || key.includes("cyclone")) {
    return <CloudLightning className={cls} aria-hidden />;
  }
  if (key.includes("snow") || key.includes("frost")) {
    return <CloudSnow className={cls} aria-hidden />;
  }
  if (
    key.includes("rain") ||
    key.includes("shower") ||
    key.includes("drizzle")
  ) {
    return <CloudRain className={cls} aria-hidden />;
  }
  if (key.includes("fog") || key.includes("haze") || key.includes("smoke") || key.includes("dust")) {
    return <CloudFog className={cls} aria-hidden />;
  }
  if (key.includes("wind")) {
    return <Wind className={cls} aria-hidden />;
  }
  if (key.includes("partly") || key.includes("mostly_sunny") || key.includes("mostly_clear")) {
    return night ? <Cloud className={cls} aria-hidden /> : <CloudSun className={cls} aria-hidden />;
  }
  if (key.includes("cloudy") || key.includes("overcast")) {
    return <Cloudy className={cls} aria-hidden />;
  }
  if (key.includes("sunny") || key.includes("clear")) {
    return night ? <Cloud className={cls} aria-hidden /> : <Sun className={cls} aria-hidden />;
  }
  return night ? <Cloud className={cls} aria-hidden /> : <CloudSun className={cls} aria-hidden />;
}
