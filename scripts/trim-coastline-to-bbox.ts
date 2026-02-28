import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import bboxClip from "@turf/bbox-clip";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  LineString,
  MultiLineString,
} from "geojson";

const DEFAULT_BBOX: [number, number, number, number] = [-74.26, 40.48, -73.75, 40.9];
const DEFAULT_OUTPUT = "data/sources/coastline-nj-harbor.geojson";

interface Args {
  input: string;
  output: string;
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

  const input = args.get("--input");
  if (!input) throw new Error("Missing --input path");

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

  return {
    input,
    output: args.get("--output") ?? DEFAULT_OUTPUT,
    bbox,
  };
}

function isLineFeature(
  feature: Feature,
): feature is Feature<LineString | MultiLineString, GeoJsonProperties> {
  return feature.geometry?.type === "LineString" || feature.geometry?.type === "MultiLineString";
}

function hasCoordinates(feature: Feature<LineString | MultiLineString, GeoJsonProperties>): boolean {
  if (feature.geometry.type === "LineString") {
    return feature.geometry.coordinates.length > 1;
  }
  return (
    feature.geometry.coordinates.length > 0 &&
    feature.geometry.coordinates.some((segment) => segment.length > 1)
  );
}

async function main() {
  const { input, output, bbox } = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(process.cwd(), input);
  const outputPath = path.resolve(process.cwd(), output);

  const source = JSON.parse(
    await readFile(inputPath, "utf8"),
  ) as FeatureCollection<LineString | MultiLineString>;
  if (source.type !== "FeatureCollection" || !Array.isArray(source.features)) {
    throw new Error("Input is not a FeatureCollection");
  }

  const lines = source.features.filter((f): f is Feature<LineString | MultiLineString, GeoJsonProperties> =>
    isLineFeature(f as Feature),
  );
  const clipped = lines
    .map((line) => bboxClip(line, bbox) as Feature<LineString | MultiLineString, GeoJsonProperties>)
    .filter(hasCoordinates);

  const out: FeatureCollection<LineString | MultiLineString> = {
    type: "FeatureCollection",
    features: clipped.map((f) => ({
      ...f,
      properties: { ...(f.properties ?? {}), source: "coastline-bbox-trimmed" },
    })),
  };

  await writeFile(outputPath, `${JSON.stringify(out)}\n`, "utf8");
  console.log(
    [
      "Trimmed coastline to bbox.",
      `Input lines: ${lines.length}`,
      `Output lines: ${out.features.length}`,
      `Output: ${outputPath}`,
      `BBox: ${bbox.join(", ")}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`trim-coastline-to-bbox failed: ${message}`);
  process.exit(1);
});
