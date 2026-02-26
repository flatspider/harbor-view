import * as THREE from "three";
import type { ShipCategory } from "../types/ais";
import { NY_HARBOR_BOUNDS } from "../types/ais";

/* ── Category Styles ─────────────────────────────────────────────────── */

export interface ShipCategoryStyle {
  color: string;
  scale: number;
  wakeWidth: number;
  wakeLength: number;
}

export const CATEGORY_STYLES: Record<ShipCategory, ShipCategoryStyle> = {
  special: { color: "#e6a817", scale: 0.8, wakeWidth: 0.85, wakeLength: 0.9 },
  passenger: { color: "#f2f7ff", scale: 1, wakeWidth: 1.08, wakeLength: 1.08 },
  cargo: { color: "#4a8cbf", scale: 1.15, wakeWidth: 0.95, wakeLength: 1.22 },
  tanker: { color: "#c44d4d", scale: 1.2, wakeWidth: 1.16, wakeLength: 1.16 },
  other: { color: "#8b9daa", scale: 0.9, wakeWidth: 0.92, wakeLength: 1 },
};

/* ── World Dimensions ────────────────────────────────────────────────── */

export const TILE_SIZE = 120;
export const TILE_VARIANTS = 4;

const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
export const WORLD_UNITS_PER_KM = 36;
export const WORLD_UNITS_PER_METER = WORLD_UNITS_PER_KM / 1000;

function estimateNorthSouthDistanceKm(southLat: number, northLat: number): number {
  return EARTH_RADIUS_KM * Math.abs(northLat - southLat) * DEG_TO_RAD;
}

function estimateEastWestDistanceKm(westLon: number, eastLon: number, midLat: number): number {
  return EARTH_RADIUS_KM * Math.cos(midLat * DEG_TO_RAD) * Math.abs(eastLon - westLon) * DEG_TO_RAD;
}

const GEO_NORTH_SOUTH_KM = estimateNorthSouthDistanceKm(NY_HARBOR_BOUNDS.south, NY_HARBOR_BOUNDS.north);
const GEO_EAST_WEST_KM = estimateEastWestDistanceKm(
  NY_HARBOR_BOUNDS.west,
  NY_HARBOR_BOUNDS.east,
  (NY_HARBOR_BOUNDS.south + NY_HARBOR_BOUNDS.north) * 0.5,
);

export const WORLD_DEPTH = Math.max(
  TILE_SIZE,
  Math.round((GEO_NORTH_SOUTH_KM * WORLD_UNITS_PER_KM) / TILE_SIZE) * TILE_SIZE,
);
export const WORLD_WIDTH = Math.max(
  TILE_SIZE,
  Math.round((GEO_EAST_WEST_KM * WORLD_UNITS_PER_KM) / TILE_SIZE) * TILE_SIZE,
);

export const LAND_BASE_HEIGHT = 5;
export const LAND_SURFACE_Y = 2;
export const RENDER_LAND_POLYGONS = true;
export const RENDER_SMOKE_SKYLINE = false;
export const SHIP_BASE_Y = -0.5;
export const WAKE_WORLD_Y = -0.8;
export const WAKE_BASE_OPACITY = 0.09;
export const SHIP_COLLISION_PADDING = 8;
export const SHIP_PLACEMENT_STEP = 12;
export const SHIP_PLACEMENT_MAX_RADIUS = 300;

export const PERF_DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("perf");

/* ── Coordinate Conversion ───────────────────────────────────────────── */

export function latLonToWorld(lat: number, lon: number): THREE.Vector3 {
  const lonRange = NY_HARBOR_BOUNDS.east - NY_HARBOR_BOUNDS.west;
  const latRange = NY_HARBOR_BOUNDS.north - NY_HARBOR_BOUNDS.south;
  const xNorm = (lon - NY_HARBOR_BOUNDS.west) / lonRange;
  const zNorm = (lat - NY_HARBOR_BOUNDS.south) / latRange;
  const x = WORLD_WIDTH * 0.5 - xNorm * WORLD_WIDTH;
  const z = zNorm * WORLD_DEPTH - WORLD_DEPTH * 0.5;
  return new THREE.Vector3(x, 6, z);
}

export function lonLatToWorld2(lon: number, lat: number): THREE.Vector2 {
  const world = latLonToWorld(lat, lon);
  return new THREE.Vector2(world.x, -world.z);
}

export function worldToLonLat(x: number, z: number): { lon: number; lat: number } | null {
  const halfWidth = WORLD_WIDTH * 0.5;
  const halfDepth = WORLD_DEPTH * 0.5;
  const xNorm = (halfWidth - x) / WORLD_WIDTH;
  const zNorm = (z + halfDepth) / WORLD_DEPTH;
  if (xNorm < 0 || xNorm > 1 || zNorm < 0 || zNorm > 1) return null;
  const lon = NY_HARBOR_BOUNDS.west + xNorm * (NY_HARBOR_BOUNDS.east - NY_HARBOR_BOUNDS.west);
  const lat = NY_HARBOR_BOUNDS.south + zNorm * (NY_HARBOR_BOUNDS.north - NY_HARBOR_BOUNDS.south);
  return { lon, lat };
}

/* ── Helper Utilities ────────────────────────────────────────────────── */

export function degToVectorOnWater(deg: number): THREE.Vector2 {
  const radians = (deg * Math.PI) / 180;
  return new THREE.Vector2(Math.sin(radians), Math.cos(radians));
}

export function isNightTime(): boolean {
  const hour = new Date().getHours();
  return hour < 6 || hour >= 19;
}

export function moodFromForecast(summary: string): "clear" | "overcast" | "rain" | "fog" {
  const normalized = summary.toLowerCase();
  if (normalized.includes("fog") || normalized.includes("mist")) return "fog";
  if (normalized.includes("rain") || normalized.includes("showers") || normalized.includes("thunder")) return "rain";
  if (normalized.includes("cloud")) return "overcast";
  return "clear";
}

/* ── Shared Types ────────────────────────────────────────────────────── */

export interface ShipMarkerData {
  isShipMarker: true;
  mmsi: number;
  ship: import("../types/ais").ShipData;
  target: THREE.Vector3;
  wake: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  baseColor: THREE.Color;
  category: ShipCategory;
  radius: number;
  wakeWidth: number;
  wakeLength: number;
  sizeScale: number;
  boundaryScale: number;
  hiddenByBoundary: boolean;
}

export type ShipMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

export interface WaterTile {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  positionAttr: THREE.BufferAttribute;
  baseXZ: Float32Array;
  lightnessOffset: number;
}

export interface OccupiedSlot {
  mmsi: number;
  radius: number;
  x: number;
  z: number;
}

export function getShipMarkerData(mesh: THREE.Object3D): ShipMarkerData {
  return mesh.userData as ShipMarkerData;
}

export function getShipMarkerFromObject(object: THREE.Object3D | null): ShipMesh | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const data = current.userData as Partial<ShipMarkerData>;
    if (data.isShipMarker === true) return current as ShipMesh;
    current = current.parent;
  }
  return null;
}
