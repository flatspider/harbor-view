import * as THREE from "three";
import { LAND_BASE_HEIGHT, LAND_SURFACE_Y, lonLatToWorld2 } from "./constants";
import { toonGradient } from "./toonGradient";

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
  const landMaterial = new THREE.MeshToonMaterial({
    color: "#5a8a55",
    emissive: "#1a2a14",
    emissiveIntensity: 0.2,
    gradientMap: toonGradient,
  });
  const cliffMaterial = new THREE.MeshToonMaterial({
    color: "#4a7a44",
    emissive: "#141f10",
    emissiveIntensity: 0.15,
    gradientMap: toonGradient,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: "#F4E6C8",
    transparent: true,
    opacity: 0.45,
  });

  let added = false;

  const addPolygon = (coordinates: number[][][]) => {
    if (coordinates[0]?.length >= 3) landPolygonRings.push(createLandRingRecord(coordinates[0]));
    const shape = polygonRingsToShape(coordinates);
    if (!shape) return;

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: LAND_BASE_HEIGHT,
      bevelEnabled: true,
      bevelThickness: 1.0,
      bevelSize: 1.2,
      bevelSegments: 4,
    });

    // Assign cliff material to side faces, land material to top/bottom caps
    const groups = geometry.groups;
    if (groups.length >= 2) {
      // ExtrudeGeometry groups: [0] = side faces, [1] = top/bottom caps
      // When 2+ groups exist, last group is the caps
      const materials = [cliffMaterial, landMaterial];
      const mesh = new THREE.Mesh(geometry, materials);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = LAND_SURFACE_Y - LAND_BASE_HEIGHT;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      scene.add(mesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 25),
        edgeMaterial,
      );
      edge.rotation.copy(mesh.rotation);
      edge.position.copy(mesh.position);
      scene.add(edge);
    } else {
      // Fallback: single material
      const mesh = new THREE.Mesh(geometry, landMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = LAND_SURFACE_Y - LAND_BASE_HEIGHT;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      scene.add(mesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 25),
        edgeMaterial,
      );
      edge.rotation.copy(mesh.rotation);
      edge.position.copy(mesh.position);
      scene.add(edge);
    }
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
