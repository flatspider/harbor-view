/**
 * Fetch NYC Ferry GTFS data and extract route shapes.
 * Outputs public/data/ferry-routes.json for the scene renderer.
 *
 * Usage: bun run scripts/fetch-ferry-routes.ts
 */

import { writeFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const GTFS_URL = "https://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx";
const OUTPUT_PATH = join(import.meta.dirname!, "..", "public", "data", "ferry-routes.json");

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const strip = (s: string) => s.trim().replace(/^\uFEFF/, "").replace(/^"|"$/g, "");
  const headers = lines[0].split(",").map(strip);
  return lines.slice(1).map((line) => {
    const values = line.split(",").map(strip);
    const record: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      record[headers[i]] = values[i] ?? "";
    }
    return record;
  });
}

async function main() {
  console.log("Fetching GTFS zip from NYC Ferry...");
  const response = await fetch(GTFS_URL, {
    headers: { "User-Agent": "harbor-watch/1.0" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch GTFS: HTTP ${response.status}`);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "ferry-gtfs-"));
  const zipPath = join(tmpDir, "gtfs.zip");

  try {
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(zipPath, buffer);
    console.log(`Downloaded ${buffer.length} bytes to ${zipPath}`);

    execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: "pipe" });
    console.log("Extracted GTFS files");

    // Parse shapes.txt
    const shapesPath = join(tmpDir, "shapes.txt");
    if (!existsSync(shapesPath)) {
      throw new Error("shapes.txt not found in GTFS archive");
    }
    const shapesRaw = parseCSV(readFileSync(shapesPath, "utf-8"));
    const shapeMap = new Map<string, { lat: number; lon: number; seq: number }[]>();
    for (const row of shapesRaw) {
      const shapeId = row.shape_id;
      const lat = Number(row.shape_pt_lat);
      const lon = Number(row.shape_pt_lon);
      const seq = Number(row.shape_pt_sequence);
      if (!shapeId || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!shapeMap.has(shapeId)) shapeMap.set(shapeId, []);
      shapeMap.get(shapeId)!.push({ lat, lon, seq });
    }
    // Sort each shape by sequence
    for (const pts of shapeMap.values()) {
      pts.sort((a, b) => a.seq - b.seq);
    }
    console.log(`Parsed ${shapeMap.size} shapes`);

    // Parse routes.txt
    const routesPath = join(tmpDir, "routes.txt");
    const routesRaw = existsSync(routesPath) ? parseCSV(readFileSync(routesPath, "utf-8")) : [];
    const routeInfo = new Map<string, { name: string; color: string }>();
    for (const row of routesRaw) {
      routeInfo.set(row.route_id, {
        name: row.route_long_name || row.route_short_name || row.route_id,
        color: row.route_color ? `#${row.route_color}` : "#4a90d9",
      });
    }

    // Parse trips.txt to link routes → shapes
    const tripsPath = join(tmpDir, "trips.txt");
    const tripsRaw = existsSync(tripsPath) ? parseCSV(readFileSync(tripsPath, "utf-8")) : [];
    const routeToShapes = new Map<string, Set<string>>();
    for (const row of tripsRaw) {
      const routeId = row.route_id;
      const shapeId = row.shape_id;
      if (!routeId || !shapeId || !shapeMap.has(shapeId)) continue;
      if (!routeToShapes.has(routeId)) routeToShapes.set(routeId, new Set());
      routeToShapes.get(routeId)!.add(shapeId);
    }

    // Build output
    const routes: {
      routeId: string;
      routeName: string;
      routeColor: string;
      shapes: { lat: number; lon: number }[][];
    }[] = [];

    for (const [routeId, shapeIds] of routeToShapes) {
      const info = routeInfo.get(routeId) ?? { name: routeId, color: "#4a90d9" };
      const shapes: { lat: number; lon: number }[][] = [];
      for (const shapeId of shapeIds) {
        const pts = shapeMap.get(shapeId);
        if (pts && pts.length > 1) {
          shapes.push(pts.map((p) => ({ lat: p.lat, lon: p.lon })));
        }
      }
      if (shapes.length > 0) {
        routes.push({
          routeId,
          routeName: info.name,
          routeColor: info.color,
          shapes,
        });
      }
    }

    mkdirSync(join(import.meta.dirname!, "..", "public", "data"), { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify({ routes }, null, 2));
    console.log(`Wrote ${routes.length} routes to ${OUTPUT_PATH}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
