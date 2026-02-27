import * as THREE from "three";
import { LAND_BASE_HEIGHT, LAND_SURFACE_Y, lonLatToWorld2 } from "./constants";
import { toonGradient } from "./toonGradient";

/* ── Experiment Toggles ────────────────────────────────────────────────
   Flip these for rapid visual experimentation. */
const USE_FLAT_LAND_COLOR = true;       // true = flat #6e7372, false = original greens
const USE_TREE_PATTERN    = true;       // true = tree dot pattern on land surface

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

/* ── Tree Pattern Texture ───────────────────────────────────────────── */

function createTreePatternTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Base color
  ctx.fillStyle = "#6e7372";
  ctx.fillRect(0, 0, size, size);

  // Scatter small tree-like dots
  const treeColor = "#4a5a4e";
  const highlightColor = "#7d8b7a";
  const rng = (seed: number) => {
    let s = seed;
    return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
  };
  const rand = rng(42);

  for (let i = 0; i < 80; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 2 + rand() * 4;

    // Tree shadow/canopy
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = treeColor;
    ctx.fill();

    // Highlight dot
    ctx.beginPath();
    ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = highlightColor;
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

function addGeoJsonLand(scene: THREE.Scene, data: GeoJsonFeatureCollection): boolean {
  /* ── Materials (toggle-aware) ──────────────────────────────────────── */
  const landColor   = USE_FLAT_LAND_COLOR ? "#6e7372" : "#5a8a55";
  const landEmissive = USE_FLAT_LAND_COLOR ? "#2a2d2c" : "#1a2a14";
  const cliffColor  = USE_FLAT_LAND_COLOR ? "#5c5f5e" : "#4a7a44";
  const cliffEmissive = USE_FLAT_LAND_COLOR ? "#1f2120" : "#141f10";

  const landMaterialOpts: THREE.MeshToonMaterialParameters = {
    color: landColor,
    emissive: landEmissive,
    emissiveIntensity: 0.2,
    gradientMap: toonGradient,
  };
  if (USE_TREE_PATTERN) {
    landMaterialOpts.map = createTreePatternTexture();
  }

  const landMaterial = new THREE.MeshToonMaterial(landMaterialOpts);
  const cliffMaterial = new THREE.MeshToonMaterial({
    color: cliffColor,
    emissive: cliffEmissive,
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
      mesh.renderOrder = 1;
      scene.add(mesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 25),
        edgeMaterial,
      );
      edge.rotation.copy(mesh.rotation);
      edge.position.copy(mesh.position);
      edge.renderOrder = 1;
      scene.add(edge);
    } else {
      // Fallback: single material
      const mesh = new THREE.Mesh(geometry, landMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = LAND_SURFACE_Y - LAND_BASE_HEIGHT;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.renderOrder = 1;
      scene.add(mesh);

      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 25),
        edgeMaterial,
      );
      edge.rotation.copy(mesh.rotation);
      edge.position.copy(mesh.position);
      edge.renderOrder = 1;
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
