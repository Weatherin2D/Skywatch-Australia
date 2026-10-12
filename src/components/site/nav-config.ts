import {
  AlertTriangle,
  Archive,
  ChartColumn,
  CloudLightning,
  CloudRain,
  CloudSun,
  Home,
  Layers,
  MoreHorizontal,
  Satellite,
  ThermometerSun,
  Users,
  Wind,
} from "lucide-react";

export const PRIMARY_NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/warnings", label: "Warnings", icon: AlertTriangle },
  { href: "/radar", label: "Radar", icon: CloudRain },
  { href: "/satellite", label: "Satellite", icon: Satellite },
  { href: "/forecast", label: "Forecast", icon: CloudSun },
  { href: "/cyclone-centre", label: "Cyclones", icon: Wind },
] as const;

/** Right-aligned primary items (sit beside More / search). */
export const PRIMARY_NAV_END = [
  { href: "/community", label: "Community", icon: Users },
] as const;

export const SECONDARY_NAV = [
  { href: "/archive", label: "Past weather", icon: Archive },
  { href: "/models", label: "Forecast models", icon: Layers },
  { href: "/model-comparison", label: "Compare forecasts", icon: ChartColumn },
  { href: "/ensemble", label: "Forecast range", icon: ChartColumn },
  { href: "/soundings", label: "Atmosphere profiles", icon: Wind },
  { href: "/climate", label: "Climate", icon: ThermometerSun },
  { href: "/risk", label: "Thunderstorm outlook", icon: CloudLightning },
  { href: "/community", label: "Community", icon: Users },
] as const;

export const MORE_NAV = [
  { href: "/ai", label: "Experimental tools hub" },
  { href: "/cyclone-centre", label: "Cyclone centre" },
  {
    href: "/soundings?mode=model&engine=predict&model=pulse&lat=-31.95&lon=115.86&place=Perth",
    label: "Experimental storm profiles",
  },
  {
    href: "/models?model=icon&skewt=1&engine=predict&lat=-31.95&lon=115.86",
    label: "Experimental forecast models",
  },
  {
    href: "/risk?source=pulse&engine=predict",
    label: "Experimental thunderstorm outlook",
  },
  { href: "/archive", label: "Past weather" },
  { href: "/models", label: "Forecast models" },
  { href: "/model-comparison", label: "Compare forecasts" },
  { href: "/ensemble", label: "Forecast range" },
  { href: "/soundings", label: "Atmosphere profiles" },
  { href: "/climate", label: "Climate" },
  { href: "/risk", label: "Thunderstorm outlook" },
  { href: "/hazards", label: "Hazards (UV, fire, marine)" },
] as const;

export const MOBILE_NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/radar", label: "Radar", icon: CloudRain },
  { href: "/satellite", label: "Satellite", icon: Satellite },
  { href: "/forecast", label: "Forecast", icon: CloudSun },
  { href: "/more", label: "More", icon: MoreHorizontal },
] as const;

export const STATE_PILLS = [
  "NSW",
  "VIC",
  "QLD",
  "WA",
  "SA",
  "ACT",
  "NT",
] as const;
