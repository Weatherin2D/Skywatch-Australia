/**
 * Vercel Hobby budget helpers.
 *
 * Hobby Fluid Compute is ~4h Active CPU / day. Radar PNG recolour, background
 * tile warm, satellite frame warm, and lightning PNG backfill were the main
 * burners that tripped fair-use on the previous account.
 *
 * Defaults: treat any Vercel deploy as Hobby-safe unless explicitly opted out.
 * Self-hosted / Docker keeps full compute unless SKYWATCH_HOBBY=1.
 */

export function useHobbyBudget(): boolean {
  if (process.env.SKYWATCH_FULL_COMPUTE === "1") return false;
  if (process.env.SKYWATCH_HOBBY === "0") return false;
  if (process.env.SKYWATCH_HOBBY === "1") return true;
  return process.env.VERCEL === "1";
}

/** Skip the CloudCountry dBZ palette proxy only when direct tiles are explicitly enabled. */
export function useDirectRadarTiles(): boolean {
  if (process.env.SKYWATCH_RADAR_DIRECT === "0") return false;
  if (process.env.SKYWATCH_RADAR_DIRECT === "1") return true;
  return false;
}

/** Allow server-side radar / satellite cache warming. */
export function allowBackgroundWarm(): boolean {
  if (process.env.SKYWATCH_WARM === "1") return true;
  if (process.env.SKYWATCH_WARM === "0") return false;
  return !useHobbyBudget();
}
