import {
  buildGridCoords,
  getPressureGridAt,
  loadRawPressureField,
} from "../src/lib/weather/synoptic-grid";
import { contourPressureGrid } from "../src/lib/weather/synoptic-contour";

async function main() {
  const g = buildGridCoords();
  console.log("grid", g.cols, g.rows, g.cols * g.rows);
  const raw = await loadRawPressureField();
  console.log("times", raw.times.length, raw.times[0], raw.times.at(-1));
  const grid = await getPressureGridAt(Math.floor(Date.now() / 1000));
  const finite = [...grid.values].filter(Number.isFinite).length;
  console.log("slice", grid.validTimeIso, "finite", finite);
  const gj = contourPressureGrid(grid);
  console.log(
    "features",
    gj.features.length,
    "isobars",
    gj.features.filter((f) => f.properties.kind === "isobar").length,
    "centres",
    gj.features.filter((f) => f.properties.kind !== "isobar").length,
  );
}
main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
