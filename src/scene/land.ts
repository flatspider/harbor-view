import * as THREE from "three";
import { LAND_BASE_HEIGHT, lonLatToWorld2 } from "./constants";

/* ── Land Polygon Point-in-Polygon ───────────────────────────────────── */

export interface LandRingRecord {
  ring: number[][];
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

// Module-level storage for land polygon outer rings.
// Populated when GeoJSON loads; checked before placing ship markers.
export const landPolygonRings: LandRingRecord[] = [];

export function createLandRingRecord(ring: number[][]): LandRingRecord {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { ring, minLon, maxLon, minLat, maxLat };
}

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function isPointOnLand(lon: number, lat: number): boolean {
  for (const record of landPolygonRings) {
    if (lon < record.minLon || lon > record.maxLon || lat < record.minLat || lat > record.maxLat) continue;
    if (pointInRing(lon, lat, record.ring)) return true;
  }
  return false;
}

/* ── GeoJSON Types ───────────────────────────────────────────────────── */

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry:
      | { type: "Polygon"; coordinates: number[][][] }
      | { type: "MultiPolygon"; coordinates: number[][][][] };
  }>;
}

/* ── GeoJSON → Three.js ──────────────────────────────────────────────── */

function polygonRingsToShape(rings: number[][][]): THREE.Shape | null {
  if (!rings.length || rings[0].length < 3) return null;
  const outerPoints = rings[0].map(([lon, lat]) => lonLatToWorld2(lon, lat));
  const shape = new THREE.Shape(outerPoints);
  for (let i = 1; i < rings.length; i += 1) {
    if (rings[i].length < 3) continue;
    const holePath = new THREE.Path(rings[i].map(([lon, lat]) => lonLatToWorld2(lon, lat)));
    shape.holes.push(holePath);
  }
  return shape;
}

function addGeoJsonLand(scene: THREE.Scene, data: GeoJsonFeatureCollection): boolean {
  const landMaterial = new THREE.MeshStandardMaterial({
    color: "#5f6f4d",
    roughness: 0.95,
    metalness: 0.02,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: "#9fac84", transparent: true, opacity: 0.8 });

  let added = false;

  const addPolygon = (coordinates: number[][][]) => {
    if (coordinates[0]?.length >= 3) landPolygonRings.push(createLandRingRecord(coordinates[0]));
    const shape = polygonRingsToShape(coordinates);
    if (!shape) return;
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: LAND_BASE_HEIGHT, bevelEnabled: false }),
      landMaterial,
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = LAND_BASE_HEIGHT;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMaterial);
    edge.rotation.copy(mesh.rotation);
    edge.position.copy(mesh.position);
    scene.add(edge);
    added = true;
  };

  for (const feature of data.features) {
    const { geometry } = feature;
    if (geometry.type === "Polygon") {
      addPolygon(geometry.coordinates);
    } else {
      for (const poly of geometry.coordinates) {
        addPolygon(poly);
      }
    }
  }
  return added;
}

/** Fetch and render land polygons into the scene. */
export async function loadLandPolygons(
  scene: THREE.Scene,
  signal: AbortSignal,
): Promise<void> {
  const fetchLand = async (path: string) => {
    const response = await fetch(path, { signal });
    if (!response.ok) return null;
    return (await response.json()) as GeoJsonFeatureCollection;
  };
  try {
    const nyc = await fetchLand("/assets/data/nyc-harbor-land.geojson");
    if (!signal.aborted && nyc) addGeoJsonLand(scene, nyc);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const nj = await fetchLand("/assets/data/nj-land-polygons.geojson");
    if (!signal.aborted && nj) addGeoJsonLand(scene, nj);
  } catch {
    // Land polygons are optional.
  }
}
