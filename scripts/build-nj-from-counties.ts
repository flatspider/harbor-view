/**
 * Build NJ land polygons from Census county boundaries + NOAA coastline frontier.
 *
 * Pipeline:
 *   1. Load Census 500k county polygons (Hudson, Essex, Union, Middlesex, Bergen)
 *   2. Clip each to the harbor viewport bbox
 *   3. Build a "coastline frontier" from NOAA data (easternmost shore point per lat band)
 *   4. Use turf.difference to trim county polygons to west of the frontier
 *   5. Output clean nj-land-polygons.geojson
 *
 * Usage:
 *   bun run scripts/build-nj-from-counties.ts
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import bboxClip from "@turf/bbox-clip";
import { polygon as turfPolygon, featureCollection } from "@turf/helpers";
import difference from "@turf/difference";

// ── Config ──────────────────────────────────────────────────────────────────

const BBOX: [number, number, number, number] = [-74.26, 40.48, -73.75, 40.9];
const [WEST, SOUTH, EAST, NORTH] = BBOX;

const COUNTIES_INPUT = "data/sources/nj-counties-500k.geojson";
const COASTLINE_INPUT = "data/sources/coastline-nj-harbor.geojson";
const OUTPUT = "public/assets/data/nj-land-polygons.geojson";

// Latitude band resolution for the frontier (degrees)
const FRONTIER_LAT_STEP = 0.0005;

// Small buffer (degrees) to push the frontier slightly west of the raw coastline
// This prevents slivers where the county boundary nearly touches the coastline
const FRONTIER_BUFFER_LON = 0.0003;

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractLineCoords(
  features: Feature<LineString | MultiLineString>[]
): Position[] {
  const coords: Position[] = [];
  for (const f of features) {
    const geom = f.geometry;
    if (geom.type === "LineString") {
      for (const c of geom.coordinates) coords.push(c);
    } else if (geom.type === "MultiLineString") {
      for (const line of geom.coordinates) {
        for (const c of line) coords.push(c);
      }
    }
  }
  return coords;
}

/**
 * Build the "east-of-frontier" polygon — the water region to subtract.
 *
 * Strategy:
 *   - For each latitude band, find the easternmost coastline point
 *   - Smooth the frontier to avoid jagged edges
 *   - Build a polygon: frontier line on the west side, viewport edges on east/north/south
 *
 * The polygon covers water east of the NJ shoreline within the viewport.
 */
function buildEastOfFrontierPolygon(
  coastCoords: Position[]
): Feature<Polygon> | null {
  // Filter to coords within bbox
  const inBbox = coastCoords.filter(
    (c) => c[0] >= WEST && c[0] <= EAST && c[1] >= SOUTH && c[1] <= NORTH
  );

  if (inBbox.length === 0) return null;

  // Build frontier: easternmost point per latitude band
  const frontierMap = new Map<number, number>(); // latBin -> eastmost lon
  for (const c of inBbox) {
    const bin = Math.floor(c[1] / FRONTIER_LAT_STEP) * FRONTIER_LAT_STEP;
    const existing = frontierMap.get(bin);
    if (existing === undefined || c[0] > existing) {
      frontierMap.set(bin, c[0]);
    }
  }

  // Sort by latitude (south to north)
  const sortedBins = Array.from(frontierMap.entries()).sort(
    (a, b) => a[0] - b[0]
  );

  if (sortedBins.length < 3) return null;

  // Apply 5-point moving average to smooth frontier
  const smoothed: [number, number][] = [];
  const WINDOW = 5;
  for (let i = 0; i < sortedBins.length; i++) {
    const lat = sortedBins[i][0];
    let lonSum = 0;
    let count = 0;
    for (
      let j = Math.max(0, i - Math.floor(WINDOW / 2));
      j <= Math.min(sortedBins.length - 1, i + Math.floor(WINDOW / 2));
      j++
    ) {
      lonSum += sortedBins[j][1];
      count++;
    }
    smoothed.push([lonSum / count - FRONTIER_BUFFER_LON, lat]);
  }

  // Build the "east of frontier" polygon:
  // Start at SE corner of viewport, go north along east edge,
  // then west along north edge to the frontier top,
  // then south along the frontier, then east along south edge back to start.
  const ring: Position[] = [];

  // Southeast corner
  ring.push([EAST, SOUTH]);
  // Northeast corner
  ring.push([EAST, NORTH]);
  // Northwest along the top to the frontier's northernmost point
  ring.push([smoothed[smoothed.length - 1][0], NORTH]);
  // South along the frontier (north to south)
  for (let i = smoothed.length - 1; i >= 0; i--) {
    ring.push([smoothed[i][0], smoothed[i][1]]);
  }
  // East along the bottom back to start
  ring.push([smoothed[0][0], SOUTH]);
  // Close the ring
  ring.push([EAST, SOUTH]);

  return turfPolygon([ring]) as Feature<Polygon>;
}

/**
 * Process a single county polygon: bbox clip, then frontier trim.
 */
function processCounty(
  feature: Feature<Polygon | MultiPolygon>,
  eastOfFrontier: Feature<Polygon>
): Feature<Polygon | MultiPolygon>[] {
  const name = feature.properties?.name ?? "unknown";

  // Step 1: Clip to viewport bbox
  let clipped: Feature<Polygon | MultiPolygon>;
  try {
    clipped = bboxClip(feature, BBOX) as Feature<Polygon | MultiPolygon>;
  } catch {
    console.log(`  ${name}: bbox clip failed, skipping`);
    return [];
  }

  // Check if anything remains after clipping
  const coords = clipped.geometry.coordinates;
  if (!coords || coords.length === 0) {
    console.log(`  ${name}: empty after bbox clip`);
    return [];
  }

  // Step 2: Subtract the east-of-frontier polygon (water region)
  const results: Feature<Polygon | MultiPolygon>[] = [];

  if (clipped.geometry.type === "MultiPolygon") {
    // Process each polygon in the MultiPolygon separately
    for (let i = 0; i < clipped.geometry.coordinates.length; i++) {
      const subPoly = turfPolygon(clipped.geometry.coordinates[i], {
        ...feature.properties,
      }) as Feature<Polygon>;
      try {
        const trimmed = difference(
          featureCollection([subPoly, eastOfFrontier])
        );
        if (trimmed) {
          trimmed.properties = {
            ...feature.properties,
            source: "nj-county-frontier-clip",
          };
          results.push(trimmed as Feature<Polygon | MultiPolygon>);
        }
      } catch (e) {
        console.log(`  ${name}[${i}]: frontier trim failed: ${e}`);
        // Fall back to bbox-clipped version
        subPoly.properties = {
          ...feature.properties,
          source: "nj-county-bbox-only",
        };
        results.push(subPoly);
      }
    }
  } else {
    try {
      const trimmed = difference(
        featureCollection([clipped as Feature<Polygon>, eastOfFrontier])
      );
      if (trimmed) {
        trimmed.properties = {
          ...feature.properties,
          source: "nj-county-frontier-clip",
        };
        results.push(trimmed as Feature<Polygon | MultiPolygon>);
      }
    } catch (e) {
      console.log(`  ${name}: frontier trim failed: ${e}`);
      clipped.properties = {
        ...feature.properties,
        source: "nj-county-bbox-only",
      };
      results.push(clipped);
    }
  }

  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Build NJ Land from Counties + Coastline Frontier ===\n");

  // Load county polygons
  const countiesPath = path.resolve(COUNTIES_INPUT);
  const countiesData: FeatureCollection<Polygon | MultiPolygon> = JSON.parse(
    await readFile(countiesPath, "utf-8")
  );
  console.log(`Loaded ${countiesData.features.length} county polygons`);

  // Load coastline
  const coastlinePath = path.resolve(COASTLINE_INPUT);
  const coastlineData: FeatureCollection<LineString | MultiLineString> =
    JSON.parse(await readFile(coastlinePath, "utf-8"));
  console.log(`Loaded ${coastlineData.features.length} coastline features`);

  // Extract coastline coordinates
  const coastCoords = extractLineCoords(
    coastlineData.features as Feature<LineString | MultiLineString>[]
  );
  console.log(`Extracted ${coastCoords.length} coastline coordinate points`);

  // Build the east-of-frontier polygon
  const eastOfFrontier = buildEastOfFrontierPolygon(coastCoords);
  if (!eastOfFrontier) {
    console.error("Failed to build frontier polygon");
    process.exit(1);
  }
  const frontierRing = eastOfFrontier.geometry.coordinates[0];
  console.log(
    `Built frontier polygon: ${frontierRing.length} vertices\n`
  );

  // Process each county
  const outputFeatures: Feature<Polygon | MultiPolygon>[] = [];
  for (const county of countiesData.features) {
    const name = county.properties?.name ?? "unknown";
    const results = processCounty(
      county as Feature<Polygon | MultiPolygon>,
      eastOfFrontier
    );
    console.log(`  ${name}: ${results.length} output polygon(s)`);
    outputFeatures.push(...results);
  }

  console.log(`\nTotal output features: ${outputFeatures.length}`);

  // Count total coordinate points
  let totalPts = 0;
  for (const f of outputFeatures) {
    const countCoords = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") {
        totalPts++;
      } else if (Array.isArray(c)) {
        for (const x of c) countCoords(x);
      }
    };
    countCoords(f.geometry.coordinates);
  }
  console.log(`Total coordinate points: ${totalPts}`);

  // Write output
  const output: FeatureCollection = {
    type: "FeatureCollection",
    features: outputFeatures,
  };
  const outputPath = path.resolve(OUTPUT);
  await writeFile(outputPath, JSON.stringify(output));
  const sizeMB = (JSON.stringify(output).length / 1024 / 1024).toFixed(2);
  console.log(`\nWrote ${outputPath} (${sizeMB} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
