/**
 * Shared climate / season helpers for model-risk scoring.
 * Kept separate so outlook + hazards can share without circular imports.
 */

/**
 * Austral monsoon / wet-season weight for northern Australia (0–1).
 * Peak Nov–Mar; dry-season May–Aug stays low so inland heat-burst days
 * need stronger solar heating + CAPE instead of a free tropical floor.
 */
export function australWetSeasonWeight(month: number, lat: number): number {
  const m = ((month - 1) % 12) + 1;
  let season = 0.15;
  if (m >= 11 || m <= 3) season = 1;
  else if (m === 4 || m === 10) season = 0.65;
  else if (m === 5 || m === 9) season = 0.35;
  else season = 0.12;

  if (lat >= -15) return season;
  if (lat >= -20) return season * 0.95;
  if (lat >= -23.5) return season * 0.85;
  if (lat >= -28) return season * 0.45;
  // Mid-latitudes: slight summer heating bias only (no monsoon floor).
  if (m >= 11 || m <= 2) return 0.2;
  if (m === 3 || m === 10) return 0.1;
  return 0;
}
