import {
  AlertTriangle,
  Archive,
  CloudLightning,
  CloudRain,
  CloudSun,
  Home,
  Layers,
  MoreHorizontal,
  Satellite,
  ThermometerSun,
} from "lucide-react";

export const PRIMARY_NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/warnings", label: "Warnings", icon: AlertTriangle },
  { href: "/radar", label: "Radar", icon: CloudRain },
  { href: "/satellite", label: "Satellite", icon: Satellite },
  { href: "/forecast", label: "Forecast", icon: CloudSun },
] as const;

export const SECONDARY_NAV = [
  { href: "/archive", label: "Archive", icon: Archive },
  { href: "/models", label: "Models", icon: Layers },
  { href: "/climate", label: "Climate", icon: ThermometerSun },
  { href: "/risk", label: "Risk", icon: CloudLightning },
] as const;

export const MORE_NAV = [
  { href: "/archive", label: "Archive" },
  { href: "/models", label: "Models" },
  { href: "/climate", label: "Climate" },
  { href: "/risk", label: "Risk outlook" },
  { href: "/hazards", label: "Hazards (UV · Fire · Marine)" },
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
