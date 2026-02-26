import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import bboxClip from "@turf/bbox-clip";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import pointOnFeature from "@turf/point-on-feature";
import polygonize from "@turf/polygonize";
import simplify from "@turf/simplify";
import { featureCollection, point } from "@turf/helpers";
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
const DEFAULT_INPUT = "public/assets/data/nj-coastline.geojson";
const DEFAULT_OUTPUT = "public/assets/data/nj-land-polygons.geojson";

const NJ_SEED_POINTS: Array<[number, number]> = [
  [-74.08, 40.72], // Jersey City
  [-74.11, 40.67], // Bayonne
  [-74.08, 40.58], // Staten approach / NJ shore zone
];

interface Args {
  input: string;
  output: string;
  bbox: [number, number, number, number];
  simplifyTolerance: number;
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

  return {
    input: args.get("--input") ?? DEFAULT_INPUT,
    output: args.get("--output") ?? DEFAULT_OUTPUT,
    bbox,
    simplifyTolerance,
    minAreaM2,
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

const EXCLUDED_FTYPE = new Set([
  "Canal/Ditch",
  "Lake/Pond",
  "Reservoir",
]);

const EXCLUDED_WATER_LABELS = new Set([
  "BRIDGE OVER WATER",
  "STREAMS AND CANALS",
  "ARTIFICIAL LAKES",
  "NATURAL LAKES",
]);

const EXCLUDED_COMMENTS = new Set(["HOT", "SPILLWAY"]);

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

  return true;
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

async function main() {
  const { input, output, bbox, simplifyTolerance, minAreaM2 } = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), input);
  const outputPath = path.resolve(process.cwd(), output);
  const ext = path.extname(inputPath).toLowerCase();
  if (ext && ext !== ".geojson" && ext !== ".json") {
    throw new Error(
      `Unsupported input format (${ext || "unknown"}). This script expects GeoJSON. ` +
        "GSHHG native binary (.b) must be converted before use.",
    );
  }

  let source: FeatureCollection<LineString | MultiLineString>;
  try {
    source = JSON.parse(
      await readFile(inputPath, "utf8"),
    ) as FeatureCollection<LineString | MultiLineString>;
  } catch {
    throw new Error(
      `Unable to parse ${inputPath} as GeoJSON FeatureCollection. ` +
        "If this is a GSHHG native binary (.b), download shapefile format and convert to GeoJSON first.",
    );
  }

  if (source.type !== "FeatureCollection" || !Array.isArray(source.features)) {
    throw new Error("Input is not a FeatureCollection");
  }

  const lineFeatures = source.features.filter(
    (feature): feature is Feature<LineString | MultiLineString, GeoJsonProperties> =>
      isLineFeature(feature as Feature),
  );
  const coastlineCandidates = lineFeatures.filter(isCoastlineCandidate);

  const clippedLines = coastlineCandidates
    .filter((feature): feature is Feature<LineString | MultiLineString, GeoJsonProperties> =>
      isLineFeature(feature as Feature),
    )
    .map(
      (feature) =>
        simplify(
          bboxClip(feature, bbox) as Feature<LineString | MultiLineString, GeoJsonProperties>,
          { tolerance: simplifyTolerance, highQuality: false, mutate: false },
        ) as Feature<LineString | MultiLineString, GeoJsonProperties>,
    );

  const polygons = polygonize(featureCollection(clippedLines)) as FeatureCollection<
    Polygon | MultiPolygon
  >;

  const seeds = NJ_SEED_POINTS.map(([lon, lat]) => point([lon, lat]));
  const njLand = polygons.features.filter((poly) => {
    if (!poly?.geometry) return false;
    if (polygonAreaApproxM2(poly) < minAreaM2) return false;
    if (seeds.some((seed) => booleanPointInPolygon(seed, poly))) return true;
    const anchor = pointOnFeature(poly);
    return seeds.some(
      (seed) =>
        Math.abs(seed.geometry.coordinates[0] - anchor.geometry.coordinates[0]) < 0.03 &&
        Math.abs(seed.geometry.coordinates[1] - anchor.geometry.coordinates[1]) < 0.03,
    );
  });

  const outputCollection = featureCollection(
    njLand.map((feature) => ({
      ...feature,
      properties: { ...(feature.properties ?? {}), source: "nj-coastline-derived" },
    })),
  );

  await writeFile(outputPath, `${JSON.stringify(outputCollection)}\n`, "utf8");
  console.log(
    [
      "Built NJ land polygons from coastline.",
      `Input lines: ${source.features.length}`,
      `Line geometries: ${lineFeatures.length}`,
      `Coastline candidates: ${coastlineCandidates.length}`,
      `Clipped lines: ${clippedLines.length}`,
      `Polygonized cells: ${polygons.features.length}`,
      `Selected NJ polygons: ${outputCollection.features.length}`,
      `Min area filter (m2): ${minAreaM2}`,
      `Output: ${outputPath}`,
      `BBox: ${bbox.join(", ")}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-nj-land-from-coastline failed: ${message}`);
  process.exit(1);
});
