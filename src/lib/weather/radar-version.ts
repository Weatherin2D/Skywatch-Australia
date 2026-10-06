/**
 * Stable ids embedded in every `/api/weather/radar-tile` URL.
 *
 * `RADAR_PALETTE_ID` identifies the SkyWatch dBZ ladder — change only when
 * the colour stops themselves change.
 * `RADAR_RENDER_REV` busts CDN/browser caches when tile size / overzoom /
 * encode behaviour changes.
 */
export const RADAR_PALETTE_ID = "swdbz2";
export const RADAR_RENDER_REV = "8";
