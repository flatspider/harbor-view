import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
} from "geojson";

const DEFAULT_BBOX: [number, number, number, number] = [-74.26, 40.48, -73.75, 40.78];
const DEFAULT_WATER_MASK = "data/sources/harbor-water-polygons.geojson";
const DEFAULT_COASTLINE = "data/sources/coastline-nj-harbor.geojson";
const DEFAULT_OUTPUT = "public/assets/data/nj-land-polygons.geojson";
const DEFAULT_GRID_COLS = 520;
const DEFAULT_GRID_ROWS = 440;
const DEFAULT_MIN_AREA_M2 = 8000;
const DEFAULT_COAST_MARGIN_CELLS = 4;
const MAX_RECT_WIDTH_CELLS = 18;
const MAX_RECT_HEIGHT_CELLS = 14;

const NJ_SEED_POINTS: Array<[number, number]> = [
  [-74.08, 40.72], // Jersey City
  [-74.11, 40.67], // Bayonne
  [-74.16, 40.70], // Newark Bay side
  [-74.09, 40.56], // North shore NJ
];

interface Args {
  waterMask: string;
  coastline: string;
  output: string;
  bbox: [number, number, number, number];
  gridCols: number;
  gridRows: number;
  minAreaM2: number;
  coastMarginCells: number;
}

interface RasterPolygon {
  outer: number[][];
  holes: number[][][];
  bbox: [number, number, number, number];
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
  if (!Number.isInteger(gridCols) || gridCols < 120) throw new Error("Invalid --grid-cols");

  const gridRows = args.get("--grid-rows") ? Number(args.get("--grid-rows")) : DEFAULT_GRID_ROWS;
  if (!Number.isInteger(gridRows) || gridRows < 120) throw new Error("Invalid --grid-rows");

  const minAreaM2 = args.get("--min-area-m2") ? Number(args.get("--min-area-m2")) : DEFAULT_MIN_AREA_M2;
  if (!Number.isFinite(minAreaM2) || minAreaM2 < 0) throw new Error("Invalid --min-area-m2");

  const coastMarginCells = args.get("--coast-margin-cells")
    ? Number(args.get("--coast-margin-cells"))
    : DEFAULT_COAST_MARGIN_CELLS;
  if (!Number.isInteger(coastMarginCells) || coastMarginCells < 0 || coastMarginCells > 50) {
    throw new Error("Invalid --coast-margin-cells");
  }

  return {
    waterMask: args.get("--water-mask") ?? DEFAULT_WATER_MASK,
    coastline: args.get("--coastline") ?? DEFAULT_COASTLINE,
    output: args.get("--output") ?? DEFAULT_OUTPUT,
    bbox,
    gridCols,
    gridRows,
    minAreaM2,
    coastMarginCells,
  };
}

function isLineFeature(feature: Feature): feature is Feature<LineString | MultiLineString, GeoJsonProperties> {
  return feature.geometry?.type === "LineString" || feature.geometry?.type === "MultiLineString";
}

function polygonBBox(ring: number[][]): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function boxesIntersect(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function ringContainsPoint(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonContainsPoint(x: number, y: number, polygon: RasterPolygon): boolean {
  if (!ringContainsPoint(x, y, polygon.outer)) return false;
  for (const hole of polygon.holes) {
    if (ringContainsPoint(x, y, hole)) return false;
  }
  return true;
}

function toGridX(lon: number, bbox: [number, number, number, number], cols: number): number {
  const [west, , east] = bbox;
  const t = (lon - west) / (east - west);
  return Math.min(cols - 1, Math.max(0, Math.floor(t * cols)));
}

function toGridY(lat: number, bbox: [number, number, number, number], rows: number): number {
  const [, south, , north] = bbox;
  const t = (lat - south) / (north - south);
  return Math.min(rows - 1, Math.max(0, Math.floor(t * rows)));
}

function cellIndex(x: number, y: number, cols: number): number {
  return y * cols + x;
}

function cellCenterLonLat(
  x: number,
  y: number,
  bbox: [number, number, number, number],
  cols: number,
  rows: number,
): [number, number] {
  const [west, south, east, north] = bbox;
  const lon = west + ((x + 0.5) / cols) * (east - west);
  const lat = south + ((y + 0.5) / rows) * (north - south);
  return [lon, lat];
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

function ringAreaApproxM2(ring: number[][]): number {
  if (ring.length < 3) return 0;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const coord of ring) {
    if (coord[1] < minLat) minLat = coord[1];
    if (coord[1] > maxLat) maxLat = coord[1];
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

function extractRasterPolygons(
  mask: Uint8Array,
  bbox: [number, number, number, number],
  cols: number,
  rows: number,
  minAreaM2: number,
): Array<Feature<Polygon, GeoJsonProperties>> {
  const [west, south, east, north] = bbox;
  const lonSpan = east - west;
  const latSpan = north - south;
  const out: Array<Feature<Polygon, GeoJsonProperties>> = [];

  const rectangles: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  let active = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();

  for (let y = 0; y < rows; y += 1) {
    const runs: Array<{ x0: number; x1: number }> = [];
    let x = 0;
    while (x < cols) {
      if (!mask[cellIndex(x, y, cols)]) {
        x += 1;
        continue;
      }
      const x0 = x;
      while (x + 1 < cols && mask[cellIndex(x + 1, y, cols)]) x += 1;
      runs.push({ x0, x1: x });
      x += 1;
    }

    const next = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
    for (const run of runs) {
      const key = `${run.x0}:${run.x1}`;
      const existing = active.get(key);
      if (existing) {
        existing.y1 = y;
        next.set(key, existing);
      } else {
        next.set(key, { x0: run.x0, x1: run.x1, y0: y, y1: y });
      }
    }

    for (const [key, rect] of active.entries()) {
      if (!next.has(key)) rectangles.push(rect);
    }
    active = next;
  }
  for (const rect of active.values()) rectangles.push(rect);

  for (const rect of rectangles) {
    for (let y0 = rect.y0; y0 <= rect.y1; y0 += MAX_RECT_HEIGHT_CELLS) {
      const y1 = Math.min(rect.y1, y0 + MAX_RECT_HEIGHT_CELLS - 1);
      for (let x0 = rect.x0; x0 <= rect.x1; x0 += MAX_RECT_WIDTH_CELLS) {
        const x1 = Math.min(rect.x1, x0 + MAX_RECT_WIDTH_CELLS - 1);
        const lon0 = west + (x0 / cols) * lonSpan;
        const lon1 = west + ((x1 + 1) / cols) * lonSpan;
        const lat0 = south + (y0 / rows) * latSpan;
        const lat1 = south + ((y1 + 1) / rows) * latSpan;
        const ring = [
          [lon0, lat0],
          [lon1, lat0],
          [lon1, lat1],
          [lon0, lat1],
          [lon0, lat0],
        ];
        if (ringAreaApproxM2(ring) < minAreaM2) continue;
        out.push({
          type: "Feature",
          properties: { source: "nj-seed-mainland-fill" },
          geometry: { type: "Polygon", coordinates: [ring] },
        });
      }
    }
  }

  return out;
}

async function main() {
  const { waterMask, coastline, output, bbox, gridCols, gridRows, minAreaM2, coastMarginCells } = parseArgs(process.argv.slice(2));
  const waterMaskPath = path.resolve(process.cwd(), waterMask);
  const coastlinePath = path.resolve(process.cwd(), coastline);
  const outputPath = path.resolve(process.cwd(), output);

  const source = JSON.parse(await readFile(waterMaskPath, "utf8")) as FeatureCollection<Polygon | MultiPolygon>;
  if (source.type !== "FeatureCollection" || !Array.isArray(source.features)) {
    throw new Error("Water mask input is not a FeatureCollection");
  }

  const waterPolygons: RasterPolygon[] = [];
  for (const feature of source.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === "Polygon") {
      if (!geometry.coordinates.length) continue;
      waterPolygons.push({
        outer: geometry.coordinates[0],
        holes: geometry.coordinates.slice(1),
        bbox: polygonBBox(geometry.coordinates[0]),
      });
      continue;
    }
    if (geometry.type === "MultiPolygon") {
      for (const poly of geometry.coordinates) {
        if (!poly.length) continue;
        waterPolygons.push({
          outer: poly[0],
          holes: poly.slice(1),
          bbox: polygonBBox(poly[0]),
        });
      }
    }
  }

  const relevantWater = waterPolygons.filter((poly) => boxesIntersect(poly.bbox, bbox));
  const water = new Uint8Array(gridCols * gridRows);

  for (const poly of relevantWater) {
    const x0 = Math.max(0, toGridX(poly.bbox[0], bbox, gridCols) - 1);
    const y0 = Math.max(0, toGridY(poly.bbox[1], bbox, gridRows) - 1);
    const x1 = Math.min(gridCols - 1, toGridX(poly.bbox[2], bbox, gridCols) + 1);
    const y1 = Math.min(gridRows - 1, toGridY(poly.bbox[3], bbox, gridRows) + 1);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const idx = cellIndex(x, y, gridCols);
        if (water[idx]) continue;
        const [lon, lat] = cellCenterLonLat(x, y, bbox, gridCols, gridRows);
        if (polygonContainsPoint(lon, lat, poly)) {
          water[idx] = 1;
        }
      }
    }
  }

  const coastlineSource = JSON.parse(
    await readFile(coastlinePath, "utf8"),
  ) as FeatureCollection<LineString | MultiLineString>;
  if (coastlineSource.type !== "FeatureCollection" || !Array.isArray(coastlineSource.features)) {
    throw new Error("Coastline input is not a FeatureCollection");
  }
  const coastlineLines = coastlineSource.features.filter((f): f is Feature<LineString | MultiLineString, GeoJsonProperties> =>
    isLineFeature(f as Feature),
  );

  const eastFrontierByRow = new Int32Array(gridRows);
  eastFrontierByRow.fill(-1);
  for (const line of coastlineLines) {
    const parts =
      line.geometry.type === "LineString" ? [line.geometry.coordinates] : line.geometry.coordinates;
    for (const part of parts) {
      for (const coord of part) {
        const x = toGridX(coord[0], bbox, gridCols);
        const y = toGridY(coord[1], bbox, gridRows);
        if (x > eastFrontierByRow[y]) eastFrontierByRow[y] = x;
      }
    }
  }

  // Fill sparse coastline rows via nearest neighbor interpolation.
  for (let y = 0; y < gridRows; y += 1) {
    if (eastFrontierByRow[y] !== -1) continue;
    let up = y - 1;
    while (up >= 0 && eastFrontierByRow[up] === -1) up -= 1;
    let down = y + 1;
    while (down < gridRows && eastFrontierByRow[down] === -1) down += 1;
    if (up >= 0 && down < gridRows) {
      eastFrontierByRow[y] =
        Math.abs(y - up) <= Math.abs(down - y) ? eastFrontierByRow[up] : eastFrontierByRow[down];
    } else if (up >= 0) {
      eastFrontierByRow[y] = eastFrontierByRow[up];
    } else if (down < gridRows) {
      eastFrontierByRow[y] = eastFrontierByRow[down];
    } else {
      eastFrontierByRow[y] = toGridX(-74.02, bbox, gridCols);
    }
  }

  const njSeeds = NJ_SEED_POINTS.map(([lon, lat]) => [
    toGridX(lon, bbox, gridCols),
    toGridY(lat, bbox, gridRows),
  ] as [number, number]);
  const njLand = floodFill(gridCols, gridRows, njSeeds, (idx) => water[idx] === 0);

  // Constrain fill to west of row-wise coastline frontier to remove rectangular harbor artifacts.
  for (let y = 0; y < gridRows; y += 1) {
    const rowCut = Math.min(gridCols - 1, eastFrontierByRow[y] + coastMarginCells);
    for (let x = rowCut + 1; x < gridCols; x += 1) {
      njLand[cellIndex(x, y, gridCols)] = 0;
    }
  }

  let landCells = 0;
  for (const v of njLand) landCells += v;
  const features = extractRasterPolygons(njLand, bbox, gridCols, gridRows, minAreaM2);

  const out: FeatureCollection<Polygon> = { type: "FeatureCollection", features };
  await writeFile(outputPath, `${JSON.stringify(out)}\n`, "utf8");
  console.log(
    [
      "Built NJ seed mainland fill polygons from water mask.",
      `Water polygons (total): ${waterPolygons.length}`,
      `Water polygons (bbox-filtered): ${relevantWater.length}`,
      `Coastline lines (bbox): ${coastlineLines.length}`,
      `Grid: ${gridCols}x${gridRows}`,
      `NJ land raster cells: ${landCells}`,
      `Output polygons: ${features.length}`,
      `Coast margin cells: ${coastMarginCells}`,
      `Output: ${outputPath}`,
      `BBox: ${bbox.join(", ")}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-nj-seed-fill failed: ${message}`);
  process.exit(1);
});
