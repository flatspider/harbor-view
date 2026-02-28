import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  LineString,
  MultiLineString,
  Polygon,
} from "geojson";

const DEFAULT_BBOX: [number, number, number, number] = [-74.26, 40.48, -73.75, 40.78];
const DEFAULT_INPUT = "data/sources/coastline-nj-harbor.geojson";
const DEFAULT_OUTPUT = "public/assets/data/nj-land-polygons.geojson";
const DEFAULT_GRID_COLS = 360;
const DEFAULT_GRID_ROWS = 300;
const DEFAULT_MIN_AREA_M2 = 12000;

const NJ_SEED_POINTS: Array<[number, number]> = [
  [-74.08, 40.72],
  [-74.11, 40.67],
  [-74.16, 40.70],
  [-74.08, 40.58],
];

const WATER_SEED_POINTS: Array<[number, number]> = [
  [-74.02, 40.69],
  [-74.04, 40.73],
  [-73.98, 40.72],
  [-74.05, 40.62],
];

interface Args {
  input: string;
  output: string;
  bbox: [number, number, number, number];
  gridCols: number;
  gridRows: number;
  minAreaM2: number;
}

function parseArgs(argv: string[]): Args {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--") || !value) continue;
    args.set(key, value);
    i += 1;
  }

  const bboxText = args.get("--bbox");
  const bbox = bboxText
    ? (() => {
        const values = bboxText.split(",").map((n) => Number(n.trim()));
        if (values.length !== 4 || values.some((n) => !Number.isFinite(n))) {
          throw new Error("Invalid --bbox. Use west,south,east,north");
        }
        return values as [number, number, number, number];
      })()
    : DEFAULT_BBOX;

  const gridCols = args.get("--grid-cols") ? Number(args.get("--grid-cols")) : DEFAULT_GRID_COLS;
  if (!Number.isInteger(gridCols) || gridCols < 80) throw new Error("Invalid --grid-cols");

  const gridRows = args.get("--grid-rows") ? Number(args.get("--grid-rows")) : DEFAULT_GRID_ROWS;
  if (!Number.isInteger(gridRows) || gridRows < 80) throw new Error("Invalid --grid-rows");

  const minAreaM2 = args.get("--min-area-m2") ? Number(args.get("--min-area-m2")) : DEFAULT_MIN_AREA_M2;
  if (!Number.isFinite(minAreaM2) || minAreaM2 < 0) throw new Error("Invalid --min-area-m2");

  return {
    input: args.get("--input") ?? DEFAULT_INPUT,
    output: args.get("--output") ?? DEFAULT_OUTPUT,
    bbox,
    gridCols,
    gridRows,
    minAreaM2,
  };
}

function isLineFeature(feature: Feature): feature is Feature<LineString | MultiLineString, GeoJsonProperties> {
  return feature.geometry?.type === "LineString" || feature.geometry?.type === "MultiLineString";
}

function toGridX(lon: number, bbox: [number, number, number, number], cols: number): number {
  const [west, , east] = bbox;
  const t = (lon - west) / (east - west);
  return Math.min(cols - 1, Math.max(0, Math.round(t * (cols - 1))));
}

function toGridY(lat: number, bbox: [number, number, number, number], rows: number): number {
  const [, south, , north] = bbox;
  const t = (lat - south) / (north - south);
  return Math.min(rows - 1, Math.max(0, Math.round(t * (rows - 1))));
}

function cellIndex(x: number, y: number, cols: number): number {
  return y * cols + x;
}

function ringAreaApproxM2(ring: number[][]): number {
  if (ring.length < 3) return 0;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const coord of ring) {
    const lat = coord[1];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const midLatRad = ((minLat + maxLat) * 0.5 * Math.PI) / 180;
  const mPerDegLat = 110540;
  const mPerDegLon = 111320 * Math.cos(midLatRad);

  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ax = a[0] * mPerDegLon;
    const ay = a[1] * mPerDegLat;
    const bx = b[0] * mPerDegLon;
    const by = b[1] * mPerDegLat;
    sum += ax * by - bx * ay;
  }
  return Math.abs(sum) * 0.5;
}

function rasterizeBlocked(
  lines: Array<Feature<LineString | MultiLineString, GeoJsonProperties>>,
  bbox: [number, number, number, number],
  cols: number,
  rows: number,
): Uint8Array {
  const blocked = new Uint8Array(cols * rows);
  const mark = (x: number, y: number) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    blocked[cellIndex(x, y, cols)] = 1;
  };

  for (const line of lines) {
    const parts =
      line.geometry.type === "LineString" ? [line.geometry.coordinates] : line.geometry.coordinates;
    for (const part of parts) {
      for (let i = 1; i < part.length; i += 1) {
        const a = part[i - 1];
        const b = part[i];
        const ax = toGridX(a[0], bbox, cols);
        const ay = toGridY(a[1], bbox, rows);
        const bx = toGridX(b[0], bbox, cols);
        const by = toGridY(b[1], bbox, rows);
        const dx = bx - ax;
        const dy = by - ay;
        const steps = Math.max(Math.abs(dx), Math.abs(dy), 1) * 2;
        for (let s = 0; s <= steps; s += 1) {
          const t = s / steps;
          mark(Math.round(ax + dx * t), Math.round(ay + dy * t));
        }
      }
    }
  }

  return blocked;
}

function floodFill(
  cols: number,
  rows: number,
  seeds: Array<[number, number]>,
  passable: (idx: number) => boolean,
): Uint8Array {
  const visited = new Uint8Array(cols * rows);
  const qx = new Int32Array(cols * rows);
  const qy = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;

  const push = (x: number, y: number) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const idx = cellIndex(x, y, cols);
    if (visited[idx] || !passable(idx)) return;
    visited[idx] = 1;
    qx[tail] = x;
    qy[tail] = y;
    tail += 1;
  };

  for (const [x, y] of seeds) push(x, y);

  while (head < tail) {
    const x = qx[head];
    const y = qy[head];
    head += 1;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  return visited;
}

async function main() {
  const { input, output, bbox, gridCols, gridRows, minAreaM2 } = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), input);
  const outputPath = path.resolve(process.cwd(), output);
  const source = JSON.parse(await readFile(inputPath, "utf8")) as FeatureCollection;
  if (source.type !== "FeatureCollection" || !Array.isArray(source.features)) {
    throw new Error("Input is not a FeatureCollection");
  }

  const lines = source.features.filter((f): f is Feature<LineString | MultiLineString, GeoJsonProperties> =>
    isLineFeature(f as Feature),
  );
  const blocked = rasterizeBlocked(lines, bbox, gridCols, gridRows);

  const waterSeeds: Array<[number, number]> = [];
  for (let x = 0; x < gridCols; x += 1) waterSeeds.push([x, 0], [x, gridRows - 1]);
  for (let y = 0; y < gridRows; y += 1) waterSeeds.push([0, y], [gridCols - 1, y]);
  for (const [lon, lat] of WATER_SEED_POINTS) {
    waterSeeds.push([toGridX(lon, bbox, gridCols), toGridY(lat, bbox, gridRows)]);
  }

  const water = floodFill(gridCols, gridRows, waterSeeds, (idx) => blocked[idx] === 0);
  const candidateLand = new Uint8Array(gridCols * gridRows);
  for (let i = 0; i < candidateLand.length; i += 1) {
    candidateLand[i] = blocked[i] === 0 && water[i] === 0 ? 1 : 0;
  }

  const njSeedCells = NJ_SEED_POINTS.map(([lon, lat]) => [
    toGridX(lon, bbox, gridCols),
    toGridY(lat, bbox, gridRows),
  ] as [number, number]);
  const njLand = floodFill(gridCols, gridRows, njSeedCells, (idx) => candidateLand[idx] === 1);

  let landCount = 0;
  for (const v of njLand) landCount += v;
  const selectedLand = landCount > 0 ? njLand : candidateLand;
  const usedSeedFallback = landCount === 0;
  if (usedSeedFallback) {
    landCount = 0;
    for (const v of selectedLand) landCount += v;
  }

  const [west, south, east, north] = bbox;
  const lonSpan = east - west;
  const latSpan = north - south;

  const features: Array<Feature<Polygon, GeoJsonProperties>> = [];
  for (let y = 0; y < gridRows; y += 1) {
    for (let x = 0; x < gridCols; x += 1) {
      if (!selectedLand[cellIndex(x, y, gridCols)]) continue;
      const lon0 = west + (x / gridCols) * lonSpan;
      const lon1 = west + ((x + 1) / gridCols) * lonSpan;
      const lat0 = south + (y / gridRows) * latSpan;
      const lat1 = south + ((y + 1) / gridRows) * latSpan;
      const ring = [
        [lon0, lat0],
        [lon1, lat0],
        [lon1, lat1],
        [lon0, lat1],
        [lon0, lat0],
      ];
      if (ringAreaApproxM2(ring) < minAreaM2) continue;
      features.push({
        type: "Feature",
        properties: { source: "nj-coarse-fill" },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
  }

  const out: FeatureCollection<Polygon> = { type: "FeatureCollection", features };
  await writeFile(outputPath, `${JSON.stringify(out)}\n`, "utf8");
  console.log(
    [
      "Built NJ coarse fill polygons.",
      `Input line features: ${lines.length}`,
      `Grid: ${gridCols}x${gridRows}`,
      `NJ land raster cells: ${landCount}`,
      `Seed fallback used: ${usedSeedFallback}`,
      `Output polygons: ${features.length}`,
      `Output: ${outputPath}`,
      `BBox: ${bbox.join(", ")}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-nj-coarse-fill failed: ${message}`);
  process.exit(1);
});
