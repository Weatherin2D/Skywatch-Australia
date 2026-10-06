/**
 * Stable ids embedded in every `/api/weather/radar-tile` URL.
 *
 * `RADAR_PALETTE_ID` identifies the locked SkyWatch dBZ ladder — never change
 * it unless the colour stops themselves change.
 * `RADAR_RENDER_REV` busts CDN/browser caches when tile size / overzoom /
 * encode behaviour changes.
 */
export const RADAR_PALETTE_ID = "swdbz1";
export const RADAR_RENDER_REV = "7";
