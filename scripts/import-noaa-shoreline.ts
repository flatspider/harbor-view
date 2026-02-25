import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import * as shapefile from "shapefile";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  LineString,
  MultiLineString,
} from "geojson";

const DEFAULT_BBOX: [number, number, number, number] = [-74.26, 40.48, -73.9, 40.78];
const DEFAULT_OUTPUT = "public/assets/data/noaa-shoreline.geojson";
const DEFAULT_COASTLINE_OUTPUT = "public/assets/data/harbor-coastline-lines.geojson";

interface Args {
  input: string;
  dbf: string | null;
  output: string;
  coastlineOutput: string | null;
  bbox: [number, number, number, number] | null;
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
  if (!input) {
    throw new Error("Missing --input. Provide a path to NOAA shapefile (.shp), e.g. --input /path/N40W075.shp");
  }

  const bboxText = args.get("--bbox");
  const bbox = bboxText
    ? (() => {
        if (bboxText.trim().toLowerCase() === "none") return null;
        const values = bboxText.split(",").map((n) => Number(n.trim()));
        if (values.length !== 4 || values.some((n) => !Number.isFinite(n))) {
          throw new Error("Invalid --bbox. Use west,south,east,north or --bbox none");
        }
        return values as [number, number, number, number];
      })()
    : DEFAULT_BBOX;

  return {
    input,
    dbf: args.get("--dbf") ?? null,
    output: args.get("--output") ?? DEFAULT_OUTPUT,
    coastlineOutput: args.get("--coastline-output") ?? DEFAULT_COASTLINE_OUTPUT,
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

function isLineGeometry(geometry: Geometry | null): geometry is LineString | MultiLineString {
  return geometry?.type === "LineString" || geometry?.type === "MultiLineString";
}

function hasLineCoordinates(geometry: LineString | MultiLineString): boolean {
  if (geometry.type === "LineString") {
    return geometry.coordinates.length > 1;
  }
  return geometry.coordinates.length > 0 && geometry.coordinates[0].length > 1;
}

function geometryBBox(geometry: LineString | MultiLineString): [number, number, number, number] | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const visit = (coord: number[]) => {
    const x = coord[0];
    const y = coord[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  if (geometry.type === "LineString") {
    for (const coord of geometry.coordinates) visit(coord);
  } else {
    for (const segment of geometry.coordinates) {
      for (const coord of segment) visit(coord);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return [minX, minY, maxX, maxY];
}

function boxesIntersect(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

async function main() {
  const { input, dbf, output, coastlineOutput, bbox } = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const inputPath = path.resolve(cwd, input);
  const ext = path.extname(inputPath).toLowerCase();
  if (ext !== ".shp") {
    if (ext === ".zip") {
      throw new Error(
        "Input is a .zip archive. Unzip first, then pass the .shp path (for example N40W075.shp).",
      );
    }
    throw new Error(`Unsupported input format (${ext || "unknown"}). Expected a .shp file.`);
  }

  const resolvedDbf = dbf
    ? path.resolve(cwd, dbf)
    : `${inputPath.slice(0, -path.extname(inputPath).length)}.dbf`;
  const dbfPath = (await fileExists(resolvedDbf)) ? resolvedDbf : null;
  const outputPath = path.resolve(cwd, output);
  const coastlineOutputPath = coastlineOutput ? path.resolve(cwd, coastlineOutput) : null;

  const source = await shapefile.open(
    inputPath,
    dbfPath ?? undefined,
  );

  const features: Array<Feature<LineString | MultiLineString, GeoJsonProperties>> = [];
  let totalFeatures = 0;
  let lineFeatures = 0;
  let bboxKept = 0;

  while (true) {
    const next = await source.read();
    if (next.done) break;
    totalFeatures += 1;

    const feature = next.value as Feature;
    if (!isLineGeometry(feature.geometry)) continue;
    if (!hasLineCoordinates(feature.geometry)) continue;
    lineFeatures += 1;

    if (bbox) {
      const box = geometryBBox(feature.geometry);
      if (!box || !boxesIntersect(box, bbox)) continue;
    }
    bboxKept += 1;

    features.push({
      type: "Feature",
      properties: feature.properties ?? {},
      geometry: feature.geometry,
    });
  }

  const collection: FeatureCollection<LineString | MultiLineString> = {
    type: "FeatureCollection",
    features,
  };

  await writeFile(outputPath, `${JSON.stringify(collection)}\n`, "utf8");
  if (coastlineOutputPath) {
    await writeFile(coastlineOutputPath, `${JSON.stringify(collection)}\n`, "utf8");
  }

  console.log(
    [
      "Imported NOAA shoreline shapefile.",
      `Input: ${inputPath}`,
      `DBF: ${dbfPath ?? "none"}`,
      `Total features: ${totalFeatures}`,
      `Line features: ${lineFeatures}`,
      `Lines kept after bbox filter: ${bboxKept}`,
      `BBox: ${bbox ? bbox.join(", ") : "none"}`,
      `Output: ${outputPath}`,
      `Coastline output: ${coastlineOutputPath ?? "none"}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`import-noaa-shoreline failed: ${message}`);
  process.exit(1);
});
