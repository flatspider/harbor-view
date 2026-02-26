/**
 * clean-land-polygons.ts
 *
 * Post-processes land polygon GeoJSON files to fix geometry issues
 * that cause rendering artifacts in Three.js ExtrudeGeometry.
 *
 * Pipeline:
 *   1. Fix invalid geometries (self-intersections, degenerate rings, bad winding)
 *   2. Remove slivers / dust (polygons below minimum area)
 *   3. Simplify coastlines (Douglas-Peucker, configurable tolerance)
 *   4. Clip to NY Harbor bounding box
 *   5. Reproject check — explains that Three.js already handles planar projection
 *
 * Usage:
 *   bun run data:clean-land
 *   bun run data:clean-land -- --tolerance 0.0001 --min-area-m2 500
 *   bun run data:clean-land -- --input path/to/file.geojson --output path/to/clean.geojson
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import simplify from "@turf/simplify";
import bboxClip from "@turf/bbox-clip";
import unkinkPolygon from "@turf/unkink-polygon";
import rewind from "@turf/rewind";
import turfArea from "@turf/area";
import cleanCoords from "@turf/clean-coords";
import { featureCollection } from "@turf/helpers";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_FILES = [
  "public/assets/data/nyc-harbor-land.geojson",
  "public/assets/data/nj-land-polygons.geojson",
];

// NY Harbor bounds from src/types/ais.ts
const NY_HARBOR_BBOX: [number, number, number, number] = [
  -74.26, // west
  40.48, // south
  -73.9, // east
  40.92, // north
];

// ─── Stats tracking ──────────────────────────────────────────────────────────

interface CleanStats {
  inputFeatures: number;
  outputFeatures: number;
  ringsFixed: number;
  degenerateRingsRemoved: number;
  windingFixed: number;
  selfIntersectionsFixed: number;
  sliversRemoved: number;
  emptyGeometriesRemoved: number;
  coordsCleaned: number;
  clippedAway: number;
}

function emptyStats(): CleanStats {
  return {
    inputFeatures: 0,
    outputFeatures: 0,
    ringsFixed: 0,
    degenerateRingsRemoved: 0,
    windingFixed: 0,
    selfIntersectionsFixed: 0,
    sliversRemoved: 0,
    emptyGeometriesRemoved: 0,
    coordsCleaned: 0,
    clippedAway: 0,
  };
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

/** Signed area of a ring using the shoelace formula. Positive = CCW, Negative = CW. */
function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

/** Deduplicate consecutive identical coordinates and remove NaN/Infinity. */
function dedupeRing(ring: Position[]): Position[] {
  const out: Position[] = [];
  for (const coord of ring) {
    if (coord.length < 2) continue;
    if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) continue;
    if (
      out.length > 0 &&
      out[out.length - 1][0] === coord[0] &&
      out[out.length - 1][1] === coord[1]
    ) {
      continue;
    }
    out.push([coord[0], coord[1]]);
  }
  return out;
}

/** Ensure ring is closed (first == last coordinate). */
function closeRing(ring: Position[]): Position[] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

/** Approximate area of a ring in square meters (for sliver detection). */
function ringAreaApproxM2(ring: Position[]): number {
  if (ring.length < 4) return 0;
  const midLat =
    ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const midLatRad = (midLat * Math.PI) / 180;
  const mPerDegLat = 110540;
  const mPerDegLon = 111320 * Math.cos(midLatRad);

  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * mPerDegLon * b[1] * mPerDegLat - b[0] * mPerDegLon * a[1] * mPerDegLat;
  }
  return Math.abs(sum) / 2;
}

// ─── Ring-level cleaning ─────────────────────────────────────────────────────

function cleanRing(ring: Position[], stats: CleanStats): Position[] | null {
  let cleaned = dedupeRing(ring);

  if (cleaned.length !== ring.length) {
    stats.coordsCleaned += ring.length - cleaned.length;
  }

  cleaned = closeRing(cleaned);

  // A valid ring needs at least 4 positions (3 unique + closing)
  const uniqueCount = new Set(cleaned.map((c) => `${c[0]},${c[1]}`)).size;
  if (cleaned.length < 4 || uniqueCount < 3) {
    stats.degenerateRingsRemoved += 1;
    return null;
  }

  return cleaned;
}

// ─── Polygon-level cleaning ──────────────────────────────────────────────────

function cleanPolygonRings(
  coords: Position[][],
  stats: CleanStats,
): Position[][] | null {
  if (!coords.length) return null;

  const outerRing = cleanRing(coords[0], stats);
  if (!outerRing) return null;

  // Fix winding: outer ring should be CCW (positive signed area per GeoJSON RFC 7946)
  const area = signedArea(outerRing);
  if (area < 0) {
    outerRing.reverse();
    stats.windingFixed += 1;
  }

  const rings: Position[][] = [outerRing];

  // Process holes
  for (let i = 1; i < coords.length; i++) {
    const hole = cleanRing(coords[i], stats);
    if (!hole) continue;

    // Holes should be CW (negative signed area)
    const holeArea = signedArea(hole);
    if (holeArea > 0) {
      hole.reverse();
      stats.windingFixed += 1;
    }

    // Skip tiny holes (slivers inside polygons)
    if (ringAreaApproxM2(hole) < 100) {
      stats.sliversRemoved += 1;
      continue;
    }

    rings.push(hole);
  }

  return rings;
}

// ─── Feature-level cleaning ──────────────────────────────────────────────────

function cleanFeature(
  feature: Feature<Polygon | MultiPolygon, GeoJsonProperties>,
  stats: CleanStats,
  minAreaM2: number,
): Array<Feature<Polygon, GeoJsonProperties>> {
  const { geometry, properties } = feature;
  if (!geometry) {
    stats.emptyGeometriesRemoved += 1;
    return [];
  }

  // Normalize to array of polygon coordinate sets
  const polyCoordSets: Position[][][] =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];

  const cleaned: Array<Feature<Polygon, GeoJsonProperties>> = [];

  for (const coords of polyCoordSets) {
    const cleanedRings = cleanPolygonRings(coords, stats);
    if (!cleanedRings) continue;

    let polygonFeature: Feature<Polygon, GeoJsonProperties> = {
      type: "Feature",
      properties: { ...(properties ?? {}) },
      geometry: {
        type: "Polygon",
        coordinates: cleanedRings,
      },
    };

    // Try to unkink self-intersecting polygons
    try {
      const unkinked = unkinkPolygon(polygonFeature);
      if (unkinked.features.length > 1) {
        stats.selfIntersectionsFixed += 1;
        // Add all resulting polygons (self-intersection was split)
        for (const f of unkinked.features) {
          const area = turfArea(f);
          if (area < minAreaM2) {
            stats.sliversRemoved += 1;
            continue;
          }
          cleaned.push({
            type: "Feature",
            properties: { ...(properties ?? {}), unkink_split: true },
            geometry: f.geometry,
          } as Feature<Polygon, GeoJsonProperties>);
        }
        continue;
      } else if (unkinked.features.length === 1) {
        // Unkink may have cleaned up without splitting
        polygonFeature = {
          type: "Feature",
          properties: { ...(properties ?? {}) },
          geometry: unkinked.features[0].geometry,
        } as Feature<Polygon, GeoJsonProperties>;
      }
    } catch {
      // unkink failed — keep the manually cleaned version
    }

    // Check area threshold
    const area = turfArea(polygonFeature);
    if (area < minAreaM2) {
      stats.sliversRemoved += 1;
      continue;
    }

    cleaned.push(polygonFeature);
  }

  return cleaned;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

function cleanCollection(
  fc: FeatureCollection,
  tolerance: number,
  minAreaM2: number,
  bbox: [number, number, number, number],
): { result: FeatureCollection<Polygon>; stats: CleanStats } {
  const stats = emptyStats();
  stats.inputFeatures = fc.features.length;

  // Step 1: Clean each feature
  let features: Array<Feature<Polygon, GeoJsonProperties>> = [];
  for (const raw of fc.features) {
    const f = raw as Feature<Polygon | MultiPolygon, GeoJsonProperties>;
    if (
      f.geometry?.type !== "Polygon" &&
      f.geometry?.type !== "MultiPolygon"
    ) {
      stats.emptyGeometriesRemoved += 1;
      continue;
    }
    features.push(...cleanFeature(f, stats, minAreaM2));
  }

  // Step 2: Fix winding order with turf/rewind (RFC 7946 compliance)
  features = features.map((f) => {
    try {
      return rewind(f, { mutate: false }) as Feature<Polygon, GeoJsonProperties>;
    } catch {
      return f;
    }
  });

  // Step 3: Clean redundant coordinates with turf/clean-coords
  features = features
    .map((f) => {
      try {
        return cleanCoords(f, { mutate: false }) as Feature<Polygon, GeoJsonProperties>;
      } catch {
        return f;
      }
    })
    .filter((f) => {
      // cleanCoords can make rings degenerate
      const outer = f.geometry?.coordinates?.[0];
      if (!outer || outer.length < 4) {
        stats.degenerateRingsRemoved += 1;
        return false;
      }
      return true;
    });

  // Step 4: Simplify (Douglas-Peucker)
  if (tolerance > 0) {
    features = features
      .map((f) => {
        try {
          return simplify(f, {
            tolerance,
            highQuality: true,
            mutate: false,
          }) as Feature<Polygon, GeoJsonProperties>;
        } catch {
          return f;
        }
      })
      .filter((f) => {
        const outer = f.geometry?.coordinates?.[0];
        if (!outer || outer.length < 4) {
          stats.degenerateRingsRemoved += 1;
          return false;
        }
        return true;
      });
  }

  // Step 5: Clip to bounding box
  const preclipCount = features.length;
  features = features
    .map((f) => {
      try {
        const clipped = bboxClip(f, bbox) as Feature<
          Polygon | MultiPolygon,
          GeoJsonProperties
        >;
        if (!clipped.geometry?.coordinates?.length) return null;

        // bboxClip can return MultiPolygon — normalize back to Polygon features
        if (clipped.geometry.type === "MultiPolygon") {
          return clipped.geometry.coordinates.map(
            (coords) =>
              ({
                type: "Feature",
                properties: { ...(f.properties ?? {}) },
                geometry: { type: "Polygon", coordinates: coords },
              }) as Feature<Polygon, GeoJsonProperties>,
          );
        }

        return {
          type: "Feature",
          properties: { ...(f.properties ?? {}) },
          geometry: clipped.geometry,
        } as Feature<Polygon, GeoJsonProperties>;
      } catch {
        return f;
      }
    })
    .flat()
    .filter((f): f is Feature<Polygon, GeoJsonProperties> => f !== null);
  stats.clippedAway = preclipCount - features.length;

  // Step 6: Final area filter (simplification + clipping can create new slivers)
  features = features.filter((f) => {
    const area = turfArea(f);
    if (area < minAreaM2) {
      stats.sliversRemoved += 1;
      return false;
    }
    return true;
  });

  stats.outputFeatures = features.length;

  return {
    result: featureCollection(features) as FeatureCollection<Polygon>,
    stats,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface Args {
  files: Array<{ input: string; output: string }>;
  tolerance: number;
  minAreaM2: number;
  bbox: [number, number, number, number];
}

function parseArgs(argv: string[]): Args {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--") || !value) continue;
    args.set(key, value);
    i += 1;
  }

  const tolerance = args.has("--tolerance")
    ? Number(args.get("--tolerance"))
    : 0.00008; // ~9m at 40°N — slightly tighter than the build script's 0.00012

  const minAreaM2 = args.has("--min-area-m2")
    ? Number(args.get("--min-area-m2"))
    : 500;

  const bboxStr = args.get("--bbox");
  const bbox: [number, number, number, number] = bboxStr
    ? (bboxStr.split(",").map(Number) as [number, number, number, number])
    : NY_HARBOR_BBOX;

  let files: Array<{ input: string; output: string }>;
  if (args.has("--input")) {
    const input = args.get("--input")!;
    const output = args.get("--output") ?? input; // overwrite in place by default
    files = [{ input, output }];
  } else {
    // Process both default files in place
    files = DEFAULT_FILES.map((f) => ({ input: f, output: f }));
  }

  return { files, tolerance, minAreaM2, bbox };
}

function printStats(file: string, stats: CleanStats): void {
  const lines = [
    `\n── ${path.basename(file)} ──`,
    `  Input features:          ${stats.inputFeatures}`,
    `  Output features:         ${stats.outputFeatures}`,
    `  Coordinates cleaned:     ${stats.coordsCleaned}`,
    `  Degenerate rings removed:${stats.degenerateRingsRemoved}`,
    `  Winding order fixed:     ${stats.windingFixed}`,
    `  Self-intersections fixed:${stats.selfIntersectionsFixed}`,
    `  Slivers removed:         ${stats.sliversRemoved}`,
    `  Empty geometries removed:${stats.emptyGeometriesRemoved}`,
    `  Clipped away:            ${stats.clippedAway}`,
  ];
  console.log(lines.join("\n"));
}

async function main() {
  const { files, tolerance, minAreaM2, bbox } = parseArgs(process.argv.slice(2));

  console.log("Land Polygon Cleaner");
  console.log(`  Simplify tolerance: ${tolerance}° (~${Math.round(tolerance * 111320 * Math.cos((40.7 * Math.PI) / 180))}m at 40.7°N)`);
  console.log(`  Min area: ${minAreaM2} m²`);
  console.log(`  Clip bbox: [${bbox.join(", ")}]`);
  console.log(
    "\n  Note: Reprojection to planar CRS is handled at render time —",
    "\n  lonLatToWorld2() converts to planar coords before Three.js triangulates.",
    "\n  GeoJSON stays in WGS84 (EPSG:4326).\n",
  );

  for (const { input, output } of files) {
    const inputPath = path.resolve(process.cwd(), input);
    const outputPath = path.resolve(process.cwd(), output);

    let raw: string;
    try {
      raw = await readFile(inputPath, "utf8");
    } catch {
      console.warn(`  Skipping ${input} — file not found`);
      continue;
    }

    const fc = JSON.parse(raw) as FeatureCollection;
    if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
      console.warn(`  Skipping ${input} — not a FeatureCollection`);
      continue;
    }

    const { result, stats } = cleanCollection(fc, tolerance, minAreaM2, bbox);

    // Compute total area for reporting
    let totalAreaKm2 = 0;
    for (const f of result.features) {
      totalAreaKm2 += turfArea(f) / 1_000_000;
    }

    await writeFile(outputPath, JSON.stringify(result) + "\n", "utf8");

    printStats(input, stats);
    console.log(`  Total land area:         ${totalAreaKm2.toFixed(2)} km²`);
    console.log(`  Output written:          ${outputPath}`);

    // File size comparison
    const outputSize = Buffer.byteLength(JSON.stringify(result));
    const inputSize = Buffer.byteLength(raw);
    const pctChange = (((outputSize - inputSize) / inputSize) * 100).toFixed(1);
    console.log(
      `  File size:               ${(inputSize / 1024).toFixed(0)} KB → ${(outputSize / 1024).toFixed(0)} KB (${Number(pctChange) >= 0 ? "+" : ""}${pctChange}%)`,
    );
  }

  console.log("\nDone.");
}

void main().catch((err: unknown) => {
  console.error(`clean-land-polygons failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
