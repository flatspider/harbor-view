import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import simplify from "@turf/simplify";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  MultiPolygon,
  Polygon,
} from "geojson";

const NYC_BUILDINGS_ENDPOINT = "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson";
const DEFAULT_OUTPUT = "public/assets/data/manhattan-skyline-smoke.geojson";
const DEFAULT_BBOX: [number, number, number, number] = [-74.02, 40.7, -73.995, 40.715];
const DEFAULT_LIMIT = 1500;
const DEFAULT_MIN_HEIGHT_METERS = 12;
const DEFAULT_SIMPLIFY_TOLERANCE = 0.00001;
const DEFAULT_HEIGHT_SCALE = 1;
const DEFAULT_MAX_BUILDINGS = 1000;
const FEET_TO_METERS = 0.3048;

type BuildingGeometry = Polygon | MultiPolygon;

interface Args {
  output: string;
  bbox: [number, number, number, number];
  limit: number;
  minHeightMeters: number;
  simplifyTolerance: number;
  heightScale: number;
  maxBuildings: number;
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

  const limit = args.get("--limit") ? Number(args.get("--limit")) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Invalid --limit. Use an integer >= 1.");
  }

  const minHeightMeters = args.get("--min-height-m")
    ? Number(args.get("--min-height-m"))
    : DEFAULT_MIN_HEIGHT_METERS;
  if (!Number.isFinite(minHeightMeters) || minHeightMeters < 0) {
    throw new Error("Invalid --min-height-m. Use a number >= 0.");
  }

  const simplifyTolerance = args.get("--simplify")
    ? Number(args.get("--simplify"))
    : DEFAULT_SIMPLIFY_TOLERANCE;
  if (!Number.isFinite(simplifyTolerance) || simplifyTolerance < 0) {
    throw new Error("Invalid --simplify. Use a number >= 0.");
  }

  const heightScale = args.get("--height-scale")
    ? Number(args.get("--height-scale"))
    : DEFAULT_HEIGHT_SCALE;
  if (!Number.isFinite(heightScale) || heightScale <= 0) {
    throw new Error("Invalid --height-scale. Use a number > 0.");
  }

  const maxBuildings = args.get("--max-buildings")
    ? Number(args.get("--max-buildings"))
    : DEFAULT_MAX_BUILDINGS;
  if (!Number.isInteger(maxBuildings) || maxBuildings < 1) {
    throw new Error("Invalid --max-buildings. Use an integer >= 1.");
  }

  return {
    output: args.get("--output") ?? DEFAULT_OUTPUT,
    bbox,
    limit,
    minHeightMeters,
    simplifyTolerance,
    heightScale,
    maxBuildings,
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function hasValidRing(ring: number[][]): boolean {
  return ring.length >= 4 && ring.every((coord) => coord.length >= 2);
}

function hasValidGeometry(geometry: BuildingGeometry): boolean {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.length > 0 && geometry.coordinates.every(hasValidRing);
  }
  return geometry.coordinates.length > 0 && geometry.coordinates.every((poly) => poly.every(hasValidRing));
}

function countVertices(geometry: BuildingGeometry): number {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0);
  }
  return geometry.coordinates.reduce(
    (sum, poly) => sum + poly.reduce((ringSum, ring) => ringSum + ring.length, 0),
    0,
  );
}

function buildQueryUrl(args: Args): string {
  const [west, south, east, north] = args.bbox;
  const params = new URLSearchParams();
  params.set("$where", `within_box(the_geom,${south},${west},${north},${east})`);
  params.set("$order", "height_roof DESC");
  params.set("$limit", String(args.limit));
  return `${NYC_BUILDINGS_ENDPOINT}?${params.toString()}`;
}

async function fetchBuildings(url: string): Promise<FeatureCollection<BuildingGeometry, GeoJsonProperties>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`NYC OpenData request failed (${response.status} ${response.statusText})`);
  }
  const json = (await response.json()) as FeatureCollection<BuildingGeometry, GeoJsonProperties>;
  if (json.type !== "FeatureCollection" || !Array.isArray(json.features)) {
    throw new Error("Unexpected NYC OpenData response shape.");
  }
  return json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(process.cwd(), args.output);
  const outputDir = path.dirname(outputPath);

  const queryUrl = buildQueryUrl(args);
  const source = await fetchBuildings(queryUrl);

  let processed = 0;
  let kept = 0;
  let totalVerticesBefore = 0;
  let totalVerticesAfter = 0;

  const outFeatures: Array<Feature<BuildingGeometry, GeoJsonProperties>> = [];

  for (const feature of source.features) {
    if (outFeatures.length >= args.maxBuildings) break;
    processed += 1;

    if (
      !feature.geometry ||
      (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon")
    ) {
      continue;
    }

    const roofFeet = toNumber(feature.properties?.height_roof);
    if (roofFeet === null) continue;
    const roofMeters = roofFeet * FEET_TO_METERS;
    if (roofMeters < args.minHeightMeters) continue;

    const groundFeet = toNumber(feature.properties?.ground_elevation) ?? 0;
    const groundMeters = groundFeet * FEET_TO_METERS;
    const normalizedHeightMeters = roofMeters * args.heightScale;

    totalVerticesBefore += countVertices(feature.geometry);

    const simplified = args.simplifyTolerance > 0
      ? (simplify(feature as Feature<BuildingGeometry, GeoJsonProperties>, {
          tolerance: args.simplifyTolerance,
          highQuality: false,
          mutate: false,
        }) as Feature<BuildingGeometry, GeoJsonProperties>)
      : feature;

    if (!simplified.geometry || !hasValidGeometry(simplified.geometry)) continue;

    totalVerticesAfter += countVertices(simplified.geometry);

    outFeatures.push({
      type: "Feature",
      geometry: simplified.geometry,
      properties: {
        ...feature.properties,
        render_height_m: Number(normalizedHeightMeters.toFixed(2)),
        render_base_m: Number(groundMeters.toFixed(2)),
      },
    });
    kept += 1;
  }

  const outCollection: FeatureCollection<BuildingGeometry, GeoJsonProperties> = {
    type: "FeatureCollection",
    features: outFeatures,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(outCollection)}\n`, "utf8");

  const reductionPct = totalVerticesBefore > 0
    ? (((totalVerticesBefore - totalVerticesAfter) / totalVerticesBefore) * 100).toFixed(1)
    : "0.0";

  console.log(
    [
      "Built Manhattan skyline smoke-test GeoJSON.",
      `Fetched: ${source.features.length}`,
      `Processed: ${processed}`,
      `Kept: ${kept}`,
      `Vertices: ${totalVerticesBefore} -> ${totalVerticesAfter} (${reductionPct}% reduction)`,
      `Output: ${outputPath}`,
      `BBox: ${args.bbox.join(", ")}`,
      `Query: ${queryUrl}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`build-manhattan-skyline-smoke failed: ${message}`);
  process.exit(1);
});
