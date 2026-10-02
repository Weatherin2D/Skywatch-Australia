/**
 * Client-safe MetEye thunderstorm constants (no Node/pngjs imports).
 */

/** Geographic frame matching WMS GetMap BBOX (Leaflet ImageOverlay). */
export const BOM_METEYE_IMAGE_BOUNDS: [[number, number], [number, number]] = [
  [-44.0, 112.5], // SW
  [-9.5, 154.5], // NE
];

/** MetEye legend colours (from /australia/meteye/legends/IDZ73094.html). */
export const METEYE_THUNDERSTORM_CATEGORIES = [
  {
    id: "tstm_chance",
    label: "Chance of Thunderstorms",
    color: "#00B193",
    rank: 1,
  },
  {
    id: "tstm_likely",
    label: "Thunderstorms Likely",
    color: "#DB0303",
    rank: 2,
  },
] as const;

export type MeteyeCategoryId =
  (typeof METEYE_THUNDERSTORM_CATEGORIES)[number]["id"];
