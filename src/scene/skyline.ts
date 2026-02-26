import * as THREE from "three";
import { LAND_SURFACE_Y, WORLD_UNITS_PER_METER, lonLatToWorld2 } from "./constants";
import { toonGradient } from "./toonGradient";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  MultiPolygon,
  Polygon,
} from "geojson";

type BuildingGeometry = Polygon | MultiPolygon;

interface SkylineFeatureCollection extends FeatureCollection<BuildingGeometry, GeoJsonProperties> {
  type: "FeatureCollection";
}

const SKYLINE_DATA_PATH = "/assets/data/manhattan-skyline-smoke.geojson";
const MIN_HEIGHT_METERS = 8;
const MAX_HEIGHT_METERS = 450;
const BASE_LIFT_WORLD = 0.8;
const FEET_TO_METERS = 0.3048;
const SKYLINE_BASE_Y = LAND_SURFACE_Y;
const HEIGHT_EXAGGERATION = 1.35;

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function polygonRingsToShape(rings: number[][][]): THREE.Shape | null {
  if (!rings.length || rings[0].length < 3) return null;
  const outerPoints = rings[0].map(([lon, lat]) => lonLatToWorld2(lon, lat));
  const shape = new THREE.Shape(outerPoints);
  for (let i = 1; i < rings.length; i += 1) {
    if (rings[i].length < 3) continue;
    const hole = new THREE.Path(rings[i].map(([lon, lat]) => lonLatToWorld2(lon, lat)));
    shape.holes.push(hole);
  }
  return shape;
}

function addBuildingMesh(
  group: THREE.Group,
  rings: number[][][],
  properties: GeoJsonProperties,
  material: THREE.MeshToonMaterial,
): boolean {
  const shape = polygonRingsToShape(rings);
  if (!shape) return false;

  const renderHeight = toNumber(properties?.render_height_m);
  const rawHeightFeet = toNumber(properties?.height_roof);
  const sourceHeight =
    renderHeight ?? (rawHeightFeet === null ? MIN_HEIGHT_METERS : rawHeightFeet * FEET_TO_METERS);

  const renderBase = toNumber(properties?.render_base_m);
  const rawBaseFeet = toNumber(properties?.ground_elevation);
  const sourceBase = renderBase ?? (rawBaseFeet === null ? 0 : rawBaseFeet * FEET_TO_METERS);
  const clampedHeightMeters = THREE.MathUtils.clamp(sourceHeight, MIN_HEIGHT_METERS, MAX_HEIGHT_METERS);
  const heightWorld = clampedHeightMeters * WORLD_UNITS_PER_METER * HEIGHT_EXAGGERATION;
  const baseWorld = Math.max(0, sourceBase) * WORLD_UNITS_PER_METER;

  const mesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: heightWorld, bevelEnabled: false }),
    material,
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = SKYLINE_BASE_Y + baseWorld + BASE_LIFT_WORLD;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  group.add(mesh);
  return true;
}

function addSkyline(
  scene: THREE.Scene,
  data: SkylineFeatureCollection,
): number {
  const skylineGroup = new THREE.Group();
  skylineGroup.name = "manhattan-skyline-smoke";

  const material = new THREE.MeshToonMaterial({
    color: "#2f3b43",
    gradientMap: toonGradient,
  });

  let added = 0;
  const addPolygon = (rings: number[][][], properties: GeoJsonProperties) => {
    if (addBuildingMesh(skylineGroup, rings, properties, material)) added += 1;
  };

  for (const feature of data.features as Array<Feature<BuildingGeometry, GeoJsonProperties>>) {
    if (!feature.geometry) continue;
    if (feature.geometry.type === "Polygon") {
      addPolygon(feature.geometry.coordinates, feature.properties ?? {});
    } else {
      for (const polygon of feature.geometry.coordinates) {
        addPolygon(polygon, feature.properties ?? {});
      }
    }
  }

  if (added === 0) return 0;
  scene.add(skylineGroup);
  return added;
}

/** Fetch and render the smoke-test skyline overlay if generated data exists. */
export async function loadSkylineSmoke(scene: THREE.Scene, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch(SKYLINE_DATA_PATH, { signal });
    if (!response.ok) return;
    const json = (await response.json()) as SkylineFeatureCollection;
    if (signal.aborted) return;
    if (json.type !== "FeatureCollection" || !Array.isArray(json.features)) return;
    const added = addSkyline(scene, json);
    if (import.meta.env.DEV) {
      console.info(`[skyline] Loaded smoke skyline: ${added} meshes from ${SKYLINE_DATA_PATH}`);
    }
  } catch {
    // Skyline overlay is optional.
  }
}
