/** Shared sounding profile + derived parameter types. */

export type SoundingMode = "observed" | "model" | "box";

export type SoundingModelId = "pulse" | "ukmo" | "ifs" | "access";

/** Geographic spacing for a 3×3 model sounding box (degrees). */
export type SoundingBoxSpacingDeg = 0.25 | 0.5 | 1;

export type SoundingLevel = {
  /** Pressure hPa */
  p: number;
  /** Geopotential height m */
  z: number;
  /** Temperature °C */
  t: number;
  /** Dewpoint °C */
  td: number;
  /** Relative humidity % */
  rh: number | null;
  /** Wind direction ° (meteorological) */
  windDir: number | null;
  /** Wind speed m/s */
  windSpd: number | null;
};

export type ParcelRow = {
  id: "SFC" | "ML" | "MU";
  label: string;
  cape: number | null;
  cin: number | null;
  lclHpa: number | null;
  lclM: number | null;
  li: number | null;
  lfcHpa: number | null;
  elHpa: number | null;
};

export type SoundingParams = {
  parcels: ParcelRow[];
  pwMm: number | null;
  kIndex: number | null;
  totalTotals: number | null;
  midRhPct: number | null;
  dcape: number | null;
  lapse0to3: number | null;
  lapse3to6: number | null;
  lapse850to500: number | null;
  lapse700to500: number | null;
  shear0to1Kts: number | null;
  shear0to3Kts: number | null;
  shear0to6Kts: number | null;
  srh0to1: number | null;
  srh0to3: number | null;
  meanWind0to6Dir: number | null;
  meanWind0to6Kts: number | null;
  bunkersRightDir: number | null;
  bunkersRightKts: number | null;
  bunkersLeftDir: number | null;
  bunkersLeftKts: number | null;
  supercellComposite: number | null;
  stp: number | null;
  ship: number | null;
  hazard: "NONE" | "HAIL" | "WIND" | "TORNADO" | "HEAVY RAIN";
};

export type ParcelTrace = {
  id: "SFC" | "ML" | "MU";
  points: { p: number; t: number }[];
};

export type SoundingPayload = {
  status: "ok" | "empty";
  mode: "observed" | "model";
  model: SoundingModelId | null;
  stationId: string | null;
  stationName: string;
  latitude: number;
  longitude: number;
  validTime: string | null;
  levels: SoundingLevel[];
  params: SoundingParams;
  parcelTraces: ParcelTrace[];
  attribution: string;
  message?: string;
};

export type SoundingStation = {
  wmo: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
};

export type SoundingBoxCell = {
  row: number;
  col: number;
  /** N / C / S · W / C / E style label */
  label: string;
  latitude: number;
  longitude: number;
  sounding: SoundingPayload;
};

export type SoundingBoxPayload = {
  status: "ok" | "empty";
  mode: "box";
  model: SoundingModelId;
  centerLatitude: number;
  centerLongitude: number;
  spacingDeg: SoundingBoxSpacingDeg;
  placeLabel: string;
  validTime: string | null;
  cells: SoundingBoxCell[];
  attribution: string;
  message?: string;
};
