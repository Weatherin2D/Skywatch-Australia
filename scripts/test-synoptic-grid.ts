import {
  buildGridCoords,
  getSynopticFieldAt,
  loadRawPressureField,
} from "../src/lib/weather/synoptic-grid";
import { contourPressureGrid } from "../src/lib/weather/synoptic-contour";

async function main() {
  const g = buildGridCoords();
  console.log("grid", g.cols, g.rows, g.cols * g.rows);
  const raw = await loadRawPressureField();
  console.log("times", raw.times.length, raw.times[0], raw.times.at(-1));
  const field = await getSynopticFieldAt(Math.floor(Date.now() / 1000));
  const finite = [...field.values].filter(Number.isFinite).length;
  const tFinite = [...field.temperatureC].filter(Number.isFinite).length;
  console.log("slice", field.validTimeIso, "p", finite, "t", tFinite);
  const gj = contourPressureGrid(field);
  const kinds: Record<string, number> = {};
  for (const f of gj.features) {
    kinds[f.properties.kind] = (kinds[f.properties.kind] ?? 0) + 1;
  }
  console.log("features", gj.features.length, kinds);
}
main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
