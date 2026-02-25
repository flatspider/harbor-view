import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import bboxClip from "@turf/bbox-clip";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import polygonize from "@turf/polygonize";
import simplify from "@turf/simplify";
import { featureCollection, lineString, point } from "@turf/helpers";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
} from "geojson";

const DEFAULT_BBOX: [number, number, number, number] = [-74.26, 40.48, -73.9, 40.78];
const DEFAULT_INPUT = "public/assets/data/noaa-shoreline.geojson";
const DEFAULT_OUTPUT = "public/assets/data/nyc-harbor-land.geojson";
const DEFAULT_GRID_COLS = 420;
const DEFAULT_GRID_ROWS = 360;
const MIN_LINE_LENGTH_M = 20;

// Land seeds across NY + NJ sides of the harbor.
const LAND_SEED_POINTS: Array<[number, number]> = [
  [-74.01, 40.75], // Manhattan
  [-73.96, 40.71], // Brooklyn/Queens edge
  [-74.03, 40.68], // Brooklyn waterfront
  [-74.14, 40.58], // Staten Island
  [-74.08, 40.72], // Jersey City
  [-74.11, 40.67], // Bayonne
  [-74.16, 40.70], // Newark Bay side
];

const WATER_SEED_POINTS: Array<[number, number]> = [
  [-74.02, 40.69], // Upper Bay
  [-74.04, 40.73], // Hudson
  [-73.98, 40.72], // East River
  [-74.05, 40.62], // The Narrows
];

interface Args {
  input: string;
  output: string;
  bbox: [number, number, number, number];
  simplifyTolerance: number;
  minAreaM2: number;
  gridCols: number;
  gridRows: number;
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

  const simplifyTolerance = args.get("--simplify")
    ? Number(args.get("--simplify"))
    : 0.00012;
  if (!Number.isFinite(simplifyTolerance) || simplifyTolerance < 0) {
    throw new Error("Invalid --simplify value");
  }

  const minAreaM2 = args.get("--min-area-m2") ? Number(args.get("--min-area-m2")) : 5000;
  if (!Number.isFinite(minAreaM2) || minAreaM2 < 0) {
    throw new Error("Invalid --min-area-m2 value");
  }

  const gridCols = args.get("--grid-cols") ? Number(args.get("--grid-cols")) : DEFAULT_GRID_COLS;
  if (!Number.isInteger(gridCols) || gridCols < 40) {
    throw new Error("Invalid --grid-cols. Use an integer >= 40.");
  }

  const gridRows = args.get("--grid-rows") ? Number(args.get("--grid-rows")) : DEFAULT_GRID_ROWS;
  if (!Number.isInteger(gridRows) || gridRows < 40) {
    throw new Error("Invalid --grid-rows. Use an integer >= 40.");
  }

  return {
    input: args.get("--input") ?? DEFAULT_INPUT,
    output: args.get("--output") ?? DEFAULT_OUTPUT,
    bbox,
    simplifyTolerance,
    minAreaM2,
    gridCols,
    gridRows,
  };
}

function isLineFeature(
  feature: Feature,
): feature is Feature<LineString | MultiLineString, GeoJsonProperties> {
  return (
    feature.geometry?.type === "LineString" ||
    feature.geometry?.type === "MultiLineString"
  );
}

const EXCLUDED_FTYPE = new Set(["Canal/Ditch", "Lake/Pond", "Reservoir"]);
const EXCLUDED_WATER_LABELS = new Set([
  "BRIDGE OVER WATER",
  "STREAMS AND CANALS",
  "ARTIFICIAL LAKES",
  "NATURAL LAKES",
]);
const EXCLUDED_COMMENTS = new Set(["HOT", "SPILLWAY"]);
const EXCLUDED_ATTRIBUTE_PREFIXES = [
  "Breakwater",
  "Groin",
  "Jetty",
  "Man-made.Ramp",
  "Man-made.Slipway",
  "Man-made.Drydock",
];

function isCoastlineCandidate(feature: Feature<LineString | MultiLineString, GeoJsonProperties>): boolean {
  const props = feature.properties ?? {};
  const tidal = String(props.TIDAL_COASTLINE ?? "").toLowerCase();
  if (tidal && tidal !== "yes") return false;

  const ftype = String(props.FTYPE_DESCRIPTION ?? "");
  if (EXCLUDED_FTYPE.has(ftype)) return false;

  const waterLabel = String(props.WATERTYPE_LABEL12 ?? "");
  if (EXCLUDED_WATER_LABELS.has(waterLabel)) return false;

  const comment = String(props.COMMENT_ ?? "");
  if (EXCLUDED_COMMENTS.has(comment)) return false;

  const attribute = String(props.ATTRIBUTE ?? "");
  if (
    attribute &&
    EXCLUDED_ATTRIBUTE_PREFIXES.some((prefix) => attribute.startsWith(prefix))
  ) {
    return false;
  }

  return true;
}

function sameCoordinate(a: number[], b: number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
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

function polygonAreaApproxM2(feature: Feature<Polygon | MultiPolygon>): number {
  const { geometry } = feature;
  if (geometry.type === "Polygon") {
    if (!geometry.coordinates.length) return 0;
    let area = ringAreaApproxM2(geometry.coordinates[0]);
    for (let i = 1; i < geometry.coordinates.length; i += 1) {
      area -= ringAreaApproxM2(geometry.coordinates[i]);
    }
    return Math.max(area, 0);
  }

  let total = 0;
  for (const poly of geometry.coordinates) {
    if (!poly.length) continue;
    let area = ringAreaApproxM2(poly[0]);
    for (let i = 1; i < poly.length; i += 1) {
      area -= ringAreaApproxM2(poly[i]);
    }
    total += Math.max(area, 0);
  }
  return total;
}

function hasValidRing(ring: number[][]): boolean {
  return ring.length >= 4 && ring.every((coord) => coord.length >= 2);
}

function hasValidPolygonGeometry(feature: Feature<Polygon | MultiPolygon>): boolean {
  const { geometry } = feature;
  if (geometry.type === "Polygon") {
    if (!geometry.coordinates.length) return false;
    return geometry.coordinates.every(hasValidRing);
  }

  if (!geometry.coordinates.length) return false;
  return geometry.coordinates.every(
    (poly) => poly.length > 0 && poly.every(hasValidRing),
  );
}

function dedupeCoordinates(coords: number[][]): number[][] {
  const out: number[][] = [];
  for (const coord of coords) {
    if (coord.length < 2) continue;
    if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) continue;
    if (out.length && sameCoordinate(out[out.length - 1], coord)) continue;
    out.push([coord[0], coord[1]]);
  }
  return out;
}

function lineLengthApproxM(coords: number[][]): number {
  let length = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    const latMid = ((a[1] + b[1]) * 0.5 * Math.PI) / 180;
    const dx = (b[0] - a[0]) * 111320 * Math.cos(latMid);
    const dy = (b[1] - a[1]) * 110540;
    length += Math.hypot(dx, dy);
  }
  return length;
}

interface CleanLineStats {
  droppedDegenerate: number;
  droppedClosedShort: number;
  droppedTooShortM: number;
  droppedNonLine: number;
}

function cleanAndExplodeLines(
  features: Array<Feature<LineString | MultiLineString, GeoJsonProperties>>,
  bbox: [number, number, number, number],
  simplifyTolerance: number,
): { lines: Array<Feature<LineString, GeoJsonProperties>>; stats: CleanLineStats } {
  const lines: Array<Feature<LineString, GeoJsonProperties>> = [];
  const stats: CleanLineStats = {
    droppedDegenerate: 0,
    droppedClosedShort: 0,
    droppedTooShortM: 0,
    droppedNonLine: 0,
  };

  for (const feature of features) {
    let clipped: Feature<LineString | MultiLineString, GeoJsonProperties>;
    try {
      clipped = bboxClip(feature, bbox) as Feature<LineString | MultiLineString, GeoJsonProperties>;
    } catch {
      stats.droppedNonLine += 1;
      continue;
    }

    const simplified = simplify(clipped, {
      tolerance: simplifyTolerance,
      highQuality: false,
      mutate: false,
    }) as Feature<LineString | MultiLineString, GeoJsonProperties>;

    const geometry = simplified.geometry;
    if (!geometry) {
      stats.droppedNonLine += 1;
      continue;
    }

    const parts =
      geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates
          : [];
    if (parts.length === 0) {
      stats.droppedNonLine += 1;
      continue;
    }

    for (const part of parts) {
      const coords = dedupeCoordinates(part ?? []);
      if (coords.length < 2) {
        stats.droppedDegenerate += 1;
        continue;
      }

      const uniqueCount = new Set(coords.map((coord) => `${coord[0]},${coord[1]}`)).size;
      const closed = sameCoordinate(coords[0], coords[coords.length - 1]);
      if (closed && (coords.length < 4 || uniqueCount < 3)) {
        stats.droppedClosedShort += 1;
        continue;
      }

      if (lineLengthApproxM(coords) < MIN_LINE_LENGTH_M) {
        stats.droppedTooShortM += 1;
        continue;
      }

      lines.push(
        lineString(coords, {
          ...(feature.properties ?? {}),
          source: "cleaned-coastline-line",
        }),
      );
    }
  }

  return { lines, stats };
}

function bboxFrameLines(
  bbox: [number, number, number, number],
): Array<Feature<LineString, GeoJsonProperties>> {
  const [west, south, east, north] = bbox;
  return [
    lineString(
      [
        [west, south],
        [east, south],
      ],
      { source: "bbox-frame" },
    ),
    lineString(
      [
        [east, south],
        [east, north],
      ],
      { source: "bbox-frame" },
    ),
    lineString(
      [
        [east, north],
        [west, north],
      ],
      { source: "bbox-frame" },
    ),
    lineString(
      [
        [west, north],
        [west, south],
      ],
      { source: "bbox-frame" },
    ),
  ];
}

function selectHarborLandPolygons(
  polygons: Array<Feature<Polygon | MultiPolygon, GeoJsonProperties>>,
  minAreaM2: number,
): Array<Feature<Polygon | MultiPolygon, GeoJsonProperties>> {
  const seeds = LAND_SEED_POINTS.map(([lon, lat]) => point([lon, lat]));
  const waterSeeds = WATER_SEED_POINTS.map(([lon, lat]) => point([lon, lat]));

  return polygons.filter((poly) => {
    if (!poly.geometry) return false;
    if (polygonAreaApproxM2(poly) < minAreaM2) return false;
    try {
      if (waterSeeds.some((seed) => booleanPointInPolygon(seed, poly))) return false;
      return seeds.some((seed) => booleanPointInPolygon(seed, poly));
    } catch {
      return false;
    }
  });
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

function rasterizeBlockedCells(
  lines: Array<Feature<LineString, GeoJsonProperties>>,
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
    const coords = line.geometry.coordinates;
    for (let i = 1; i < coords.length; i += 1) {
      const a = coords[i - 1];
      const b = coords[i];
      const ax = toGridX(a[0], bbox, cols);
      const ay = toGridY(a[1], bbox, rows);
      const bx = toGridX(b[0], bbox, cols);
      const by = toGridY(b[1], bbox, rows);
      const dx = bx - ax;
      const dy = by - ay;
      const steps = Math.max(Math.abs(dx), Math.abs(dy), 1) * 2;
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        const x = Math.round(ax + dx * t);
        const y = Math.round(ay + dy * t);
        mark(x, y);
      }
    }
  }

  // Fill tiny gaps so flood-fill doesn't leak through near-touching coastline points.
  const dilated = blocked.slice();
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!blocked[cellIndex(x, y, cols)]) continue;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          dilated[cellIndex(nx, ny, cols)] = 1;
        }
      }
    }
  }
  return dilated;
}

function floodFill(
  cols: number,
  rows: number,
  seeds: Array<[number, number]>,
  passable: (x: number, y: number, idx: number) => boolean,
): Uint8Array {
  const visited = new Uint8Array(cols * rows);
  const queueX = new Int32Array(cols * rows);
  const queueY = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;

  const tryPush = (x: number, y: number) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const idx = cellIndex(x, y, cols);
    if (visited[idx]) return;
    if (!passable(x, y, idx)) return;
    visited[idx] = 1;
    queueX[tail] = x;
    queueY[tail] = y;
    tail += 1;
  };

  for (const [sx, sy] of seeds) {
    tryPush(sx, sy);
  }

  while (head < tail) {
    const x = queueX[head];
    const y = queueY[head];
    head += 1;
    tryPush(x + 1, y);
    tryPush(x - 1, y);
    tryPush(x, y + 1);
    tryPush(x, y - 1);
  }

  return visited;
}

interface RasterRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function buildRasterLandPolygons(
  lines: Array<Feature<LineString, GeoJsonProperties>>,
  bbox: [number, number, number, number],
  minAreaM2: number,
  cols: number,
  rows: number,
): {
  polygons: Array<Feature<Polygon, GeoJsonProperties>>;
  blockedCells: number;
  waterCells: number;
  landCells: number;
  seedHitCount: number;
  seedFallbackUsed: boolean;
} {
  const blocked = rasterizeBlockedCells(lines, bbox, cols, rows);
  let blockedCells = 0;
  for (const value of blocked) blockedCells += value;

  const waterSeeds: Array<[number, number]> = [];
  for (let x = 0; x < cols; x += 1) {
    waterSeeds.push([x, 0], [x, rows - 1]);
  }
  for (let y = 0; y < rows; y += 1) {
    waterSeeds.push([0, y], [cols - 1, y]);
  }
  for (const [lon, lat] of WATER_SEED_POINTS) {
    waterSeeds.push([toGridX(lon, bbox, cols), toGridY(lat, bbox, rows)]);
  }

  const water = floodFill(
    cols,
    rows,
    waterSeeds,
    (_x, _y, idx) => blocked[idx] === 0,
  );

  const candidateLand = new Uint8Array(cols * rows);
  for (let idx = 0; idx < candidateLand.length; idx += 1) {
    candidateLand[idx] = blocked[idx] === 0 && water[idx] === 0 ? 1 : 0;
  }

  const landSeedCells = LAND_SEED_POINTS.map(([lon, lat]) => [
    toGridX(lon, bbox, cols),
    toGridY(lat, bbox, rows),
  ] as [number, number]);
  const seededLand = floodFill(
    cols,
    rows,
    landSeedCells,
    (_x, _y, idx) => candidateLand[idx] === 1,
  );

  let seededCount = 0;
  for (const value of seededLand) seededCount += value;
  let seedHitCount = 0;
  for (const [x, y] of landSeedCells) {
    if (seededLand[cellIndex(x, y, cols)] === 1) seedHitCount += 1;
  }

  // If only a small subset of seed points survive, prefer the broader enclosed land mask.
  // This avoids NJ-only output when NYC shoreline has small gaps that let flood-fill leak.
  const minSeedHits = Math.min(3, landSeedCells.length);
  const seedFallbackUsed = seededCount === 0 || seedHitCount < minSeedHits;
  const selectedLand = seedFallbackUsed ? candidateLand : seededLand;

  let waterCells = 0;
  let landCells = 0;
  for (const value of water) waterCells += value;
  for (const value of selectedLand) landCells += value;

  const rectangles: RasterRect[] = [];
  let active = new Map<string, RasterRect>();

  for (let y = 0; y < rows; y += 1) {
    const runs: Array<{ x0: number; x1: number }> = [];
    let x = 0;
    while (x < cols) {
      if (selectedLand[cellIndex(x, y, cols)] === 0) {
        x += 1;
        continue;
      }
      const x0 = x;
      while (x + 1 < cols && selectedLand[cellIndex(x + 1, y, cols)] === 1) {
        x += 1;
      }
      runs.push({ x0, x1: x });
      x += 1;
    }

    const next = new Map<string, RasterRect>();
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

    for (const [key, rect] of active) {
      if (!next.has(key)) rectangles.push(rect);
    }
    active = next;
  }
  for (const rect of active.values()) rectangles.push(rect);

  const [west, south, east, north] = bbox;
  const lonSpan = east - west;
  const latSpan = north - south;

  const polygons = rectangles
    .map((rect) => {
      const lon0 = west + (rect.x0 / cols) * lonSpan;
      const lon1 = west + ((rect.x1 + 1) / cols) * lonSpan;
      const lat0 = south + (rect.y0 / rows) * latSpan;
      const lat1 = south + ((rect.y1 + 1) / rows) * latSpan;
      const ring = [
        [lon0, lat0],
        [lon1, lat0],
        [lon1, lat1],
        [lon0, lat1],
        [lon0, lat0],
      ];
      const feature: Feature<Polygon, GeoJsonProperties> = {
        type: "Feature",
        properties: { source: "coastline-raster-fallback" },
        geometry: {
          type: "Polygon",
          coordinates: [ring],
        },
      };
      return feature;
    })
    .filter((feature) => polygonAreaApproxM2(feature) >= minAreaM2);

  return { polygons, blockedCells, waterCells, landCells, seedHitCount, seedFallbackUsed };
}

async function main() {
  const { input, output, bbox, simplifyTolerance, minAreaM2, gridCols, gridRows } = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), input);
  const outputPath = path.resolve(process.cwd(), output);

  const source = JSON.parse(
    await readFile(inputPath, "utf8"),
  ) as FeatureCollection<LineString | MultiLineString>;
  if (source.type !== "FeatureCollection" || !Array.isArray(source.features)) {
    throw new Error("Input is not a FeatureCollection");
  }

  const lineFeatures = source.features.filter(
    (feature): feature is Feature<LineString | MultiLineString, GeoJsonProperties> =>
      isLineFeature(feature as Feature),
  );
  const coastlineCandidates = lineFeatures.filter(isCoastlineCandidate);
  const cleaned = cleanAndExplodeLines(coastlineCandidates, bbox, simplifyTolerance);

  let harborLand: Array<Feature<Polygon | MultiPolygon, GeoJsonProperties>> = [];
  let polygonizedCells = 0;
  let invalidPolygonCount = 0;
  let usedRasterFallback = false;
  let fallbackBlockedCells = 0;
  let fallbackWaterCells = 0;
  let fallbackLandCells = 0;
  let polygonizeError: string | null = null;
  let fallbackSeedHitCount = 0;
  let fallbackSeedFallbackUsed = false;

  try {
    const frameLines = bboxFrameLines(bbox);
    const polygons = polygonize(
      featureCollection<LineString>([...cleaned.lines, ...frameLines]),
    ) as FeatureCollection<Polygon | MultiPolygon>;
    polygonizedCells = polygons.features.length;

    const validPolygons = polygons.features.filter(hasValidPolygonGeometry);
    invalidPolygonCount = polygons.features.length - validPolygons.length;
    harborLand = selectHarborLandPolygons(validPolygons, minAreaM2);

    if (harborLand.length === 0) {
      usedRasterFallback = true;
      const fallback = buildRasterLandPolygons(cleaned.lines, bbox, minAreaM2, gridCols, gridRows);
      harborLand = fallback.polygons;
      fallbackBlockedCells = fallback.blockedCells;
      fallbackWaterCells = fallback.waterCells;
      fallbackLandCells = fallback.landCells;
      fallbackSeedHitCount = fallback.seedHitCount;
      fallbackSeedFallbackUsed = fallback.seedFallbackUsed;
      polygonizeError = "Polygonize produced 0 selected harbor polygons.";
    }
  } catch (error) {
    usedRasterFallback = true;
    const fallback = buildRasterLandPolygons(cleaned.lines, bbox, minAreaM2, gridCols, gridRows);
    harborLand = fallback.polygons;
    fallbackBlockedCells = fallback.blockedCells;
    fallbackWaterCells = fallback.waterCells;
    fallbackLandCells = fallback.landCells;
    fallbackSeedHitCount = fallback.seedHitCount;
    fallbackSeedFallbackUsed = fallback.seedFallbackUsed;
    polygonizeError = error instanceof Error ? error.message : String(error);
  }

  const sourceTag = usedRasterFallback
    ? "coastline-rasterized-harbor-land"
    : "coastline-derived-harbor-land";
  const outputCollection = featureCollection<Polygon | MultiPolygon>(
    harborLand.map((feature) => ({
      ...feature,
      properties: { ...(feature.properties ?? {}), source: sourceTag },
    })),
  );

  await writeFile(outputPath, `${JSON.stringify(outputCollection)}\n`, "utf8");
  console.log(
    [
      "Built harbor land polygons from coastline.",
      `Input lines: ${source.features.length}`,
      `Line geometries: ${lineFeatures.length}`,
      `Coastline candidates: ${coastlineCandidates.length}`,
      `Cleaned line segments: ${cleaned.lines.length}`,
      `Dropped degenerate line segments: ${cleaned.stats.droppedDegenerate}`,
      `Dropped short closed segments: ${cleaned.stats.droppedClosedShort}`,
      `Dropped tiny line segments (<${MIN_LINE_LENGTH_M}m): ${cleaned.stats.droppedTooShortM}`,
      `Dropped non-line/clip-failed segments: ${cleaned.stats.droppedNonLine}`,
      `Polygonized cells: ${polygonizedCells}`,
      `Invalid polygonized cells skipped: ${invalidPolygonCount}`,
      `Raster fallback used: ${usedRasterFallback}`,
      `Raster grid: ${gridCols}x${gridRows}`,
      `Raster blocked cells: ${fallbackBlockedCells}`,
      `Raster water cells: ${fallbackWaterCells}`,
      `Raster land cells: ${fallbackLandCells}`,
      `Raster seed hits: ${fallbackSeedHitCount}/${LAND_SEED_POINTS.length}`,
      `Raster seed fallback to enclosed-land mask: ${fallbackSeedFallbackUsed}`,
      `Polygonize/fallback note: ${polygonizeError ?? "none"}`,
      `Selected harbor polygons: ${outputCollection.features.length}`,
      `Min area filter (m2): ${minAreaM2}`,
      `Output: ${outputPath}`,
      `BBox: ${bbox.join(", ")}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-harbor-land-from-coastline failed: ${message}`);
  process.exit(1);
});
