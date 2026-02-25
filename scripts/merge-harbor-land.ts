import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import bboxClip from "@turf/bbox-clip";
import difference from "@turf/difference";
import simplify from "@turf/simplify";
import { featureCollection } from "@turf/helpers";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
} from "geojson";

const DEFAULT_BBOX: [number, number, number, number] = [-74.26, 40.48, -73.9, 40.78];
const DEFAULT_NYC_PATH = "public/assets/data/nyc-harbor-land.geojson";
const DEFAULT_OUTPUT_PATH = "public/assets/data/nyc-harbor-land.geojson";
const DEFAULT_NJ_COAST_PATH = "public/assets/data/nj-coastline.geojson";
const DEFAULT_NJ_LAND_PATH = "public/assets/data/nj-land-polygons.geojson";
const DEFAULT_WATER_MASK_PATH = "public/assets/data/harbor-water-polygons.geojson";

interface Args {
  njPaths: string[];
  waterMaskPath: string | null;
  waterSimplifyTolerance: number;
  waterMinAreaM2: number;
  waterMaxFeatures: number | null;
  clipNycToBbox: boolean;
  carveNycWithWater: boolean;
  nycPath: string;
  outPath: string;
  outLinesPath: string;
  bbox: [number, number, number, number];
}

function parseBooleanArg(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  throw new Error(`Invalid boolean value: ${value}`);
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

  const njPaths: string[] = [];
  const legacyNj = args.get("--nj");
  if (legacyNj) njPaths.push(legacyNj);
  const njLand = args.get("--nj-land");
  if (njLand) njPaths.push(njLand);
  const njCoast = args.get("--nj-coast");
  if (njCoast) njPaths.push(njCoast);

  const bboxText = args.get("--bbox");
  const bbox = bboxText
    ? (() => {
        const values = bboxText.split(",").map((n) => Number(n.trim()));
        if (values.length !== 4 || values.some((n) => !Number.isFinite(n))) {
          throw new Error("Invalid --bbox. Use: --bbox west,south,east,north");
        }
        return values as [number, number, number, number];
      })()
    : DEFAULT_BBOX;

  const waterSimplifyToleranceText = args.get("--water-simplify");
  const waterSimplifyTolerance = waterSimplifyToleranceText
    ? Number(waterSimplifyToleranceText)
    : 0.00008;
  if (!Number.isFinite(waterSimplifyTolerance) || waterSimplifyTolerance < 0) {
    throw new Error("Invalid --water-simplify. Use a non-negative number, e.g. 0.00008");
  }

  const waterMinAreaM2Text = args.get("--water-min-area-m2");
  const waterMinAreaM2 = waterMinAreaM2Text ? Number(waterMinAreaM2Text) : 0;
  if (!Number.isFinite(waterMinAreaM2) || waterMinAreaM2 < 0) {
    throw new Error("Invalid --water-min-area-m2. Use a non-negative number.");
  }

  const waterMaxFeaturesText = args.get("--water-max-features");
  const waterMaxFeatures = waterMaxFeaturesText ? Number(waterMaxFeaturesText) : null;
  if (
    waterMaxFeatures != null &&
    (!Number.isFinite(waterMaxFeatures) || waterMaxFeatures < 1 || !Number.isInteger(waterMaxFeatures))
  ) {
    throw new Error("Invalid --water-max-features. Use a positive integer.");
  }

  return {
    njPaths,
    waterMaskPath: args.get("--water-mask") ?? null,
    waterSimplifyTolerance,
    waterMinAreaM2,
    waterMaxFeatures,
    clipNycToBbox: parseBooleanArg(args.get("--clip-nyc"), false),
    carveNycWithWater: parseBooleanArg(args.get("--carve-nyc-with-water"), false),
    nycPath: args.get("--nyc") ?? DEFAULT_NYC_PATH,
    outPath: args.get("--out") ?? DEFAULT_OUTPUT_PATH,
    outLinesPath: args.get("--out-lines") ?? "public/assets/data/harbor-coastline-lines.geojson",
    bbox,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPolygonGeometry(geometry: Geometry | null): geometry is Polygon | MultiPolygon {
  if (!geometry) return false;
  return geometry.type === "Polygon" || geometry.type === "MultiPolygon";
}

function isLineGeometry(geometry: Geometry | null): geometry is LineString | MultiLineString {
  if (!geometry) return false;
  return geometry.type === "LineString" || geometry.type === "MultiLineString";
}

function polygonFeatures(
  source: FeatureCollection,
  sourceTag: string,
): Array<Feature<Polygon | MultiPolygon, GeoJsonProperties>> {
  const out: Array<Feature<Polygon | MultiPolygon, GeoJsonProperties>> = [];

  for (const feature of source.features) {
    if (!feature) continue;
    if (!isPolygonGeometry(feature.geometry)) continue;
    out.push({
      type: "Feature",
      properties: { ...(feature.properties ?? {}), source: sourceTag },
      geometry: feature.geometry,
    });
  }

  return out;
}

function lineFeatures(
  source: FeatureCollection,
  sourceTag: string,
): Array<Feature<LineString | MultiLineString, GeoJsonProperties>> {
  const out: Array<Feature<LineString | MultiLineString, GeoJsonProperties>> = [];

  for (const feature of source.features) {
    if (!feature) continue;
    if (!isLineGeometry(feature.geometry)) continue;
    out.push({
      type: "Feature",
      properties: { ...(feature.properties ?? {}), source: sourceTag },
      geometry: feature.geometry,
    });
  }

  return out;
}

function hasCoordinates(feature: Feature<Polygon | MultiPolygon, GeoJsonProperties>): boolean {
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 2;
  }
  return (
    feature.geometry.coordinates.length > 0 &&
    feature.geometry.coordinates[0].length > 0 &&
    feature.geometry.coordinates[0][0].length > 2
  );
}

function hasLineCoordinates(feature: Feature<LineString | MultiLineString, GeoJsonProperties>): boolean {
  if (feature.geometry.type === "LineString") {
    return feature.geometry.coordinates.length > 1;
  }
  return feature.geometry.coordinates.length > 0 && feature.geometry.coordinates[0].length > 1;
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

function polygonAreaApproxM2(feature: Feature<Polygon | MultiPolygon, GeoJsonProperties>): number {
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

type BBox = [number, number, number, number];

function featureBBox(feature: Feature<Polygon | MultiPolygon, GeoJsonProperties>): BBox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const visit = (coord: number[]) => {
    const x = coord[0];
    const y = coord[1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  if (feature.geometry.type === "Polygon") {
    for (const ring of feature.geometry.coordinates) {
      for (const coord of ring) visit(coord);
    }
  } else {
    for (const poly of feature.geometry.coordinates) {
      for (const ring of poly) {
        for (const coord of ring) visit(coord);
      }
    }
  }

  return [minX, minY, maxX, maxY];
}

function boxesIntersect(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function carvePolygonsWithWater(
  landPolygons: Array<Feature<Polygon | MultiPolygon, GeoJsonProperties>>,
  waterPolygons: Array<Feature<Polygon | MultiPolygon, GeoJsonProperties>>,
): Array<Feature<Polygon | MultiPolygon, GeoJsonProperties>> {
  if (waterPolygons.length === 0) return landPolygons;

  const waterWithBoxes = waterPolygons.map((water) => ({
    feature: water,
    box: featureBBox(water),
  }));

  return landPolygons
    .map((landFeature) => {
      let carved: Feature<Polygon | MultiPolygon, GeoJsonProperties> | null = landFeature;
      const landBox = featureBBox(landFeature);
      const relevantWater = waterWithBoxes.filter((water) =>
        boxesIntersect(landBox, water.box),
      );

      for (const water of relevantWater) {
        if (!carved) break;
        try {
          carved = difference(featureCollection([carved, water.feature])) as
            | Feature<Polygon | MultiPolygon, GeoJsonProperties>
            | null;
        } catch {
          // Skip invalid geometry pairs and continue carving with other water features.
        }
      }
      return carved;
    })
    .filter(
      (feature): feature is Feature<Polygon | MultiPolygon, GeoJsonProperties> =>
        feature != null && hasCoordinates(feature),
    );
}

async function loadFeatureCollection(filePath: string): Promise<FeatureCollection> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext && ext !== ".geojson" && ext !== ".json") {
    throw new Error(
      `Unsupported input format (${ext || "unknown"}) for ${filePath}. ` +
        "This script expects GeoJSON files; GSHHG native binary (.b) is not supported directly.",
    );
  }

  const text = await readFile(filePath, "utf8");
  let parsed: FeatureCollection;
  try {
    parsed = JSON.parse(text) as FeatureCollection;
  } catch {
    throw new Error(
      `Unable to parse ${filePath} as GeoJSON. ` +
        "If this came from GSHHG native binary (.b), convert from shapefile to GeoJSON first.",
    );
  }
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error(`${filePath} is not a valid GeoJSON FeatureCollection`);
  }
  return parsed;
}

async function main() {
  const {
    njPaths,
    waterMaskPath,
    waterSimplifyTolerance,
    waterMinAreaM2,
    waterMaxFeatures,
    clipNycToBbox,
    carveNycWithWater,
    nycPath,
    outPath,
    outLinesPath,
    bbox,
  } = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const resolvedNyc = path.resolve(cwd, nycPath);
  const resolvedOut = path.resolve(cwd, outPath);
  const resolvedOutLines = path.resolve(cwd, outLinesPath);

  const resolvedInputCandidates = Array.from(
    new Set(
      (
        njPaths.length > 0
          ? njPaths
          : [DEFAULT_NJ_LAND_PATH, DEFAULT_NJ_COAST_PATH]
      ).map((p) => path.resolve(cwd, p)),
    ),
  );

  const resolvedExistingInputs: string[] = [];
  for (const candidate of resolvedInputCandidates) {
    if (await fileExists(candidate)) {
      resolvedExistingInputs.push(candidate);
    }
  }

  if (resolvedExistingInputs.length === 0) {
    throw new Error(
      [
        "No NJ input files found.",
        `Provide --nj-land/--nj-coast (or --nj), or place files at:`,
        `- ${path.resolve(cwd, DEFAULT_NJ_LAND_PATH)}`,
        `- ${path.resolve(cwd, DEFAULT_NJ_COAST_PATH)}`,
      ].join(" "),
    );
  }

  const resolvedWaterMask = path.resolve(
    cwd,
    waterMaskPath ?? DEFAULT_WATER_MASK_PATH,
  );
  const hasWaterMask = await fileExists(resolvedWaterMask);

  const nycRaw = await loadFeatureCollection(resolvedNyc);
  const njSources = await Promise.all(
    resolvedExistingInputs.map(async (inputPath) => ({
      inputPath,
      data: await loadFeatureCollection(inputPath),
      sourceTag: path.basename(inputPath, path.extname(inputPath)),
    })),
  );

  const nycPolygonsRaw = polygonFeatures(nycRaw, "nyc-existing");
  const nycPolygons = (clipNycToBbox
    ? nycPolygonsRaw.map(
        (feature) => bboxClip(feature, bbox) as Feature<Polygon | MultiPolygon, GeoJsonProperties>,
      )
    : nycPolygonsRaw).filter(hasCoordinates);
  const njPolygons = njSources.flatMap((source) => polygonFeatures(source.data, source.sourceTag));
  const njLines = njSources.flatMap((source) => lineFeatures(source.data, source.sourceTag));

  const clippedNjRaw = njPolygons
    .map((feature) => bboxClip(feature, bbox) as Feature<Polygon | MultiPolygon, GeoJsonProperties>)
    .filter(hasCoordinates);

  let waterPolygonsClipped: Array<Feature<Polygon | MultiPolygon, GeoJsonProperties>> = [];
  let waterPolygonsBeforeAreaFilter = 0;
  if (hasWaterMask) {
    const waterRaw = await loadFeatureCollection(resolvedWaterMask);
    const waterPolygons = polygonFeatures(waterRaw, "water-mask");
    const clippedAndSimplified = waterPolygons
      .map((feature) => bboxClip(feature, bbox) as Feature<Polygon | MultiPolygon, GeoJsonProperties>)
      .map(
        (feature) =>
          simplify(feature, {
            tolerance: waterSimplifyTolerance,
            highQuality: false,
            mutate: false,
          }) as Feature<Polygon | MultiPolygon, GeoJsonProperties>,
      )
      .filter(hasCoordinates);
    waterPolygonsBeforeAreaFilter = clippedAndSimplified.length;

    const withAreas = clippedAndSimplified
      .map((feature) => ({ feature, areaM2: polygonAreaApproxM2(feature) }))
      .filter((entry) => entry.areaM2 >= waterMinAreaM2)
      .sort((a, b) => b.areaM2 - a.areaM2);

    waterPolygonsClipped = (
      waterMaxFeatures != null ? withAreas.slice(0, waterMaxFeatures) : withAreas
    ).map((entry) => entry.feature);
  }

  const carvedNyc = carveNycWithWater
    ? carvePolygonsWithWater(nycPolygons, waterPolygonsClipped)
    : nycPolygons;
  const clippedNj = carvePolygonsWithWater(clippedNjRaw, waterPolygonsClipped);

  const clippedNjLines = njLines
    .map((feature) => bboxClip(feature, bbox) as Feature<LineString | MultiLineString, GeoJsonProperties>)
    .filter(hasLineCoordinates);

  const merged = featureCollection([...carvedNyc, ...clippedNj]);
  await writeFile(resolvedOut, `${JSON.stringify(merged)}\n`, "utf8");
  await writeFile(
    resolvedOutLines,
    `${JSON.stringify(featureCollection(clippedNjLines))}\n`,
    "utf8",
  );

  console.log(
    [
      "Merged harbor land written.",
      `NYC polygons (input): ${nycPolygons.length}`,
      `NYC polygons (water-carved): ${carvedNyc.length}`,
      `NJ polygons (input): ${njPolygons.length}`,
      `NJ polygons (clipped): ${clippedNjRaw.length}`,
      `NJ polygons (water-carved): ${clippedNj.length}`,
      `NJ lines (input): ${njLines.length}`,
      `NJ lines (clipped): ${clippedNjLines.length}`,
      `Water mask polygons (clipped): ${waterPolygonsBeforeAreaFilter}`,
      `Water mask polygons (after area/top filters): ${waterPolygonsClipped.length}`,
      `Water simplify tolerance: ${waterSimplifyTolerance}`,
      `Water min area filter (m2): ${waterMinAreaM2}`,
      `Water max features: ${waterMaxFeatures ?? "none"}`,
      `NYC clipped to bbox: ${clipNycToBbox}`,
      `NYC carved with water mask: ${carveNycWithWater}`,
      `Output: ${resolvedOut}`,
      `Coastline lines output: ${resolvedOutLines}`,
      `Inputs: ${resolvedExistingInputs.join(", ")}`,
      `Water mask: ${hasWaterMask ? resolvedWaterMask : "none (add --water-mask or harbor-water-polygons.geojson)"}`,
      `BBox: ${bbox.join(", ")}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`merge-harbor-land failed: ${message}`);
  process.exit(1);
});
