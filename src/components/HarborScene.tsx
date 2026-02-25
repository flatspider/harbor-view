import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import type { ShipData } from "../types/ais";
import type { HarborEnvironment } from "../types/environment";
import type { ShipCategory } from "../types/ais";
import { getShipCategory, NY_HARBOR_BOUNDS } from "../types/ais";
import { ShipInfoCard } from "./ShipInfoCard";

interface HarborSceneProps {
  ships: Map<number, ShipData>;
  environment: HarborEnvironment;
}

interface HarborLabel {
  id: string;
  text: string;
  lat: number;
  lon: number;
  kind: "water" | "landmark";
  priority: number;
  offsetX?: number;
  offsetY?: number;
  style?: "emoji";
}

interface ShipCategoryStyle {
  color: string;
  scale: number;
  wakeWidth: number;
  wakeLength: number;
}

const CATEGORY_STYLES: Record<ShipCategory, ShipCategoryStyle> = {
  special: {
    color: "#e6a817",
    scale: 0.8,
    wakeWidth: 0.85,
    wakeLength: 0.9,
  },
  passenger: {
    color: "#f2f7ff",
    scale: 1,
    wakeWidth: 1.08,
    wakeLength: 1.08,
  },
  cargo: {
    color: "#4a8cbf",
    scale: 1.15,
    wakeWidth: 0.95,
    wakeLength: 1.22,
  },
  tanker: {
    color: "#c44d4d",
    scale: 1.2,
    wakeWidth: 1.16,
    wakeLength: 1.16,
  },
  other: {
    color: "#8b9daa",
    scale: 0.9,
    wakeWidth: 0.92,
    wakeLength: 1,
  },
};

const WORLD_WIDTH = 1800;
const WORLD_DEPTH = 1200;
const TILE_SIZE = 120;
const TILE_VARIANTS = 4;
const LAND_BASE_HEIGHT = 12;
const RENDER_LAND_POLYGONS = true;
const SHIP_BASE_Y = 10;
const WAKE_WORLD_Y = 0.22;
const WAKE_BASE_OPACITY = 0.09;
const SHIP_COLLISION_PADDING = 8;
const SHIP_PLACEMENT_STEP = 12;
const SHIP_PLACEMENT_MAX_RADIUS = 300;

// Stored land polygon outer rings (lon/lat) for point-in-polygon ship culling.
// Populated when GeoJSON loads; checked before placing ship markers.
const landPolygonRings: number[][][] = [];

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

function isPointOnLand(lon: number, lat: number): boolean {
  for (const ring of landPolygonRings) {
    if (pointInRing(lon, lat, ring)) return true;
  }
  return false;
}
const HARBOR_LABELS: HarborLabel[] = [
  { id: "upper-bay", text: "Upper Bay", lat: 40.671, lon: -74.035, kind: "water", priority: 10, offsetY: -12 },
  { id: "east-river", text: "East River", lat: 40.725, lon: -73.982, kind: "water", priority: 9, offsetX: 12, offsetY: -10 },
  { id: "hudson", text: "Hudson", lat: 40.742, lon: -74.028, kind: "water", priority: 8, offsetX: -10 },
  { id: "narrows", text: "The Narrows", lat: 40.61, lon: -74.04, kind: "water", priority: 10, offsetY: -8 },
  { id: "liberty", text: "🗽", lat: 40.6892, lon: -74.0445, kind: "landmark", priority: 12, offsetY: -16, style: "emoji" },
  { id: "gov-island", text: "Governors Island", lat: 40.6897, lon: -74.0168, kind: "landmark", priority: 11, offsetY: -10 },
  { id: "verrazzano", text: "Verrazzano Bridge", lat: 40.6066, lon: -74.0447, kind: "landmark", priority: 11, offsetY: -10 },
  { id: "ambrose", text: "Ambrose Channel", lat: 40.53, lon: -73.98, kind: "landmark", priority: 7, offsetY: -8 },
];

interface ShipMarkerData {
  isShipMarker: true;
  mmsi: number;
  ship: ShipData;
  target: THREE.Vector3;
  wake: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  baseColor: THREE.Color;
  category: ShipCategory;
  radius: number;
  wakeWidth: number;
  wakeLength: number;
  sizeScale: number;
}

type ShipMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

interface WaterTile {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  positionAttr: THREE.BufferAttribute;
  baseXZ: Float32Array;
  lightnessOffset: number;
}

function getShipMarkerData(mesh: THREE.Object3D): ShipMarkerData {
  return mesh.userData as ShipMarkerData;
}

function getShipMarkerFromObject(object: THREE.Object3D | null): ShipMesh | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const data = current.userData as Partial<ShipMarkerData>;
    if (data.isShipMarker === true) {
      return current as ShipMesh;
    }
    current = current.parent;
  }
  return null;
}

function degToVectorOnWater(deg: number): THREE.Vector2 {
  const radians = (deg * Math.PI) / 180;
  return new THREE.Vector2(Math.sin(radians), Math.cos(radians));
}

function isNightTime(): boolean {
  const hour = new Date().getHours();
  return hour < 6 || hour >= 19;
}

function moodFromForecast(summary: string): "clear" | "overcast" | "rain" | "fog" {
  const normalized = summary.toLowerCase();
  if (normalized.includes("fog") || normalized.includes("mist")) return "fog";
  if (normalized.includes("rain") || normalized.includes("showers") || normalized.includes("thunder")) return "rain";
  if (normalized.includes("cloud")) return "overcast";
  return "clear";
}

function createShipGeometry(category: string, sizeScale: number): THREE.BufferGeometry {
  const scale = Math.max(sizeScale, 0.85);
  const shape = new THREE.Shape();

  if (category === "cargo") {
    shape.moveTo(-4.5 * scale, -10 * scale);
    shape.lineTo(4.5 * scale, -10 * scale);
    shape.lineTo(4.5 * scale, 7 * scale);
    shape.lineTo(0, 12 * scale);
    shape.lineTo(-4.5 * scale, 7 * scale);
    shape.lineTo(-4.5 * scale, -10 * scale);
  } else if (category === "tanker") {
    shape.absellipse(0, 0, 3.8 * scale, 12 * scale, 0, Math.PI * 2, false, 0);
  } else if (category === "passenger") {
    shape.moveTo(-4 * scale, -9 * scale);
    shape.lineTo(4 * scale, -9 * scale);
    shape.lineTo(4 * scale, 4 * scale);
    shape.lineTo(2.2 * scale, 9 * scale);
    shape.lineTo(-2.2 * scale, 9 * scale);
    shape.lineTo(-4 * scale, 4 * scale);
    shape.lineTo(-4 * scale, -9 * scale);
  } else if (category === "special") {
    shape.absellipse(0, 0, 4.2 * scale, 7.5 * scale, 0, Math.PI * 2, false, 0);
  } else {
    shape.moveTo(-3.4 * scale, -8.5 * scale);
    shape.lineTo(3.4 * scale, -8.5 * scale);
    shape.lineTo(3 * scale, 4 * scale);
    shape.lineTo(0, 10 * scale);
    shape.lineTo(-3 * scale, 4 * scale);
    shape.lineTo(-3.4 * scale, -8.5 * scale);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 2.3 * scale,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 1.2 * scale, 0);
  return geometry;
}

function createWakeGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 4);
  shape.lineTo(-6.6, -35);
  shape.lineTo(6.6, -35);
  shape.lineTo(0, -10);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function latLonToWorld(lat: number, lon: number): THREE.Vector3 {
  const lonRange = NY_HARBOR_BOUNDS.east - NY_HARBOR_BOUNDS.west;
  const latRange = NY_HARBOR_BOUNDS.north - NY_HARBOR_BOUNDS.south;
  const xNorm = (lon - NY_HARBOR_BOUNDS.west) / lonRange;
  const zNorm = (lat - NY_HARBOR_BOUNDS.south) / latRange;
  const x = xNorm * WORLD_WIDTH - WORLD_WIDTH * 0.5;
  const z = zNorm * WORLD_DEPTH - WORLD_DEPTH * 0.5;
  return new THREE.Vector3(x, 6, z);
}

function lonLatToWorld2(lon: number, lat: number): THREE.Vector2 {
  const world = latLonToWorld(lat, lon);
  // ShapeGeometry/ExtrudeGeometry are built in XY and later rotated into XZ,
  // so invert here to keep north/south aligned with ship world coordinates.
  return new THREE.Vector2(world.x, -world.z);
}

function worldToLonLat(x: number, z: number): { lon: number; lat: number } | null {
  const halfWidth = WORLD_WIDTH * 0.5;
  const halfDepth = WORLD_DEPTH * 0.5;
  const xNorm = (x + halfWidth) / WORLD_WIDTH;
  const zNorm = (z + halfDepth) / WORLD_DEPTH;
  if (xNorm < 0 || xNorm > 1 || zNorm < 0 || zNorm > 1) return null;
  const lon = NY_HARBOR_BOUNDS.west + xNorm * (NY_HARBOR_BOUNDS.east - NY_HARBOR_BOUNDS.west);
  const lat = NY_HARBOR_BOUNDS.south + zNorm * (NY_HARBOR_BOUNDS.north - NY_HARBOR_BOUNDS.south);
  return { lon, lat };
}

function isWorldPointNavigable(x: number, z: number): boolean {
  const lonLat = worldToLonLat(x, z);
  if (!lonLat) return false;
  return !isPointOnLand(lonLat.lon, lonLat.lat);
}

function getShipCollisionRadius(ship: ShipData, style: ShipCategoryStyle): number {
  const length = ship.lengthM > 0 ? ship.lengthM : 85;
  const beam = ship.beamM > 0 ? ship.beamM : 18;
  const scaledHull = (length * 0.05 + beam * 0.22) * style.scale;
  return Math.min(Math.max(scaledHull, 16), 60);
}

interface OccupiedSlot {
  mmsi: number;
  radius: number;
  x: number;
  z: number;
}

function resolveShipTarget(
  desired: THREE.Vector3,
  mmsi: number,
  radius: number,
  occupiedSlots: OccupiedSlot[],
): THREE.Vector3 | null {
  const candidates: Array<{ x: number; z: number }> = [{ x: desired.x, z: desired.z }];
  const baseAngle = ((mmsi % 360) * Math.PI) / 180;

  for (let distance = SHIP_PLACEMENT_STEP; distance <= SHIP_PLACEMENT_MAX_RADIUS; distance += SHIP_PLACEMENT_STEP) {
    const sampleCount = Math.max(10, Math.floor((Math.PI * 2 * distance) / (SHIP_PLACEMENT_STEP * 1.45)));
    for (let i = 0; i < sampleCount; i += 1) {
      const theta = baseAngle + (i / sampleCount) * Math.PI * 2;
      candidates.push({
        x: desired.x + Math.cos(theta) * distance,
        z: desired.z + Math.sin(theta) * distance,
      });
    }
  }

  for (const candidate of candidates) {
    if (!isWorldPointNavigable(candidate.x, candidate.z)) continue;

    let intersects = false;
    for (const occupied of occupiedSlots) {
      if (occupied.mmsi === mmsi) continue;
      const minDistance = radius + occupied.radius + SHIP_COLLISION_PADDING;
      const dx = candidate.x - occupied.x;
      const dz = candidate.z - occupied.z;
      if (dx * dx + dz * dz < minDistance * minDistance) {
        intersects = true;
        break;
      }
    }
    if (intersects) continue;

    return new THREE.Vector3(candidate.x, desired.y, candidate.z);
  }

  return null;
}

function createShipDetailMesh(category: ShipCategory, sizeScale: number, hullColor: THREE.Color): THREE.Mesh {
  const detailMaterial = new THREE.MeshStandardMaterial({
    color: hullColor.clone().offsetHSL(0, -0.08, 0.18),
    roughness: 0.5,
    metalness: 0.14,
  });
  const scale = Math.max(sizeScale, 0.85);

  if (category === "cargo") {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(5.4 * scale, 2.1 * scale, 8.5 * scale), detailMaterial);
    mesh.position.set(0, 2.7 * scale, -0.7 * scale);
    return mesh;
  }
  if (category === "tanker") {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.95 * scale, 1.95 * scale, 8.2 * scale, 16), detailMaterial);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(0, 2.3 * scale, 0);
    return mesh;
  }
  if (category === "passenger") {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4.6 * scale, 3.2 * scale, 7.4 * scale), detailMaterial);
    mesh.position.set(0, 3.3 * scale, 1.1 * scale);
    return mesh;
  }
  if (category === "special") {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(2.35 * scale, 3.6 * scale, 8), detailMaterial);
    mesh.position.set(0, 3 * scale, 0.8 * scale);
    return mesh;
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(3.8 * scale, 1.8 * scale, 6.1 * scale), detailMaterial);
  mesh.position.set(0, 2.45 * scale, 0.4 * scale);
  return mesh;
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry:
      | {
          type: "Polygon";
          coordinates: number[][][];
        }
      | {
          type: "MultiPolygon";
          coordinates: number[][][][];
        };
  }>;
}

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
  for (const feature of data.features) {
    const { geometry } = feature;
    if (geometry.type === "Polygon") {
      // Store outer ring for ship-on-land culling
      if (geometry.coordinates[0]?.length >= 3) landPolygonRings.push(geometry.coordinates[0]);

      const shape = polygonRingsToShape(geometry.coordinates);
      if (!shape) continue;
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: LAND_BASE_HEIGHT, bevelEnabled: false }), landMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = LAND_BASE_HEIGHT;
      mesh.receiveShadow = true;
      scene.add(mesh);

      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMaterial);
      edge.rotation.copy(mesh.rotation);
      edge.position.copy(mesh.position);
      scene.add(edge);
      added = true;
      continue;
    }

    for (const poly of geometry.coordinates) {
      // Store outer ring for ship-on-land culling
      if (poly[0]?.length >= 3) landPolygonRings.push(poly[0]);

      const shape = polygonRingsToShape(poly);
      if (!shape) continue;
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: LAND_BASE_HEIGHT, bevelEnabled: false }), landMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = LAND_BASE_HEIGHT;
      mesh.receiveShadow = true;
      scene.add(mesh);

      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMaterial);
      edge.rotation.copy(mesh.rotation);
      edge.position.copy(mesh.position);
      scene.add(edge);
      added = true;
    }
  }
  return added;
}

export function HarborScene({ ships, environment }: HarborSceneProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const sceneInstanceRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<MapControls | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredShipRef = useRef<ShipMesh | null>(null);
  const animationRef = useRef<number | null>(null);
  const shipMarkersRef = useRef<Map<number, ShipMesh>>(new Map());
  const tileRef = useRef<WaterTile[]>([]);
  const windParticlesRef = useRef<THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null>(null);
  const coastlineObjectsRef = useRef<THREE.Object3D[]>([]);
  const raycastTargetsRef = useRef<ShipMesh[]>([]);
  const labelSizesRef = useRef(new Map<string, { width: number; height: number }>());
  const labelElementsRef = useRef(new Map<string, HTMLDivElement>());
  const environmentRef = useRef(environment);
  const [selectedShip, setSelectedShip] = useState<{
    ship: ShipData;
    x: number;
    y: number;
    sceneWidth: number;
    sceneHeight: number;
  } | null>(null);

  const handleShipClick = useCallback(
    (ship: ShipData, worldPos: THREE.Vector3) => {
      const sceneRect = sceneRef.current?.getBoundingClientRect();
      const camera = cameraRef.current;
      if (!sceneRect || !camera) return;

      const projected = worldPos.clone().project(camera);
      const x = ((projected.x + 1) * 0.5) * sceneRect.width;
      const y = ((-projected.y + 1) * 0.5) * sceneRect.height;

      setSelectedShip({
        ship,
        x,
        y,
        sceneWidth: sceneRect.width,
        sceneHeight: sceneRect.height,
      });
    },
    [],
  );

  const handleClose = useCallback(() => {
    setSelectedShip(null);
  }, []);

  useEffect(() => {
    environmentRef.current = environment;
  }, [environment]);

  useEffect(() => {
    const mount = sceneRef.current;
    if (!mount) return;
    const shipMarkers = shipMarkersRef.current;
    const tiles = tileRef.current;
    const coastlineObjects = coastlineObjectsRef.current;
    const raycastTargets = raycastTargetsRef.current;
    const labelSizes = labelSizesRef.current;
    const abortController = new AbortController();
    let disposed = false;
    landPolygonRings.length = 0;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#89b3cf");
    scene.fog = new THREE.Fog("#a7c5d8", 800, 2200);
    sceneInstanceRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      1,
      5000,
    );
    camera.position.set(0, 805, -570);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableRotate = false;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 1.0;
    controls.minDistance = 80;
    controls.maxDistance = 2200;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.target.set(0, 0, 0);
    controls.update();
    controlsRef.current = controls;

    const hemiLight = new THREE.HemisphereLight("#d9eef8", "#4f6e88", 0.85);
    hemiLight.position.set(0, 600, 0);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight("#f6e5b1", 1.1);
    sunLight.position.set(-400, 700, 300);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    scene.add(sunLight);

    const windParticleCount = 450;
    const windGeometry = new THREE.BufferGeometry();
    const windPositions = new Float32Array(windParticleCount * 3);
    for (let i = 0; i < windParticleCount; i += 1) {
      windPositions[i * 3] = (Math.random() - 0.5) * WORLD_WIDTH;
      windPositions[i * 3 + 1] = 18 + Math.random() * 40;
      windPositions[i * 3 + 2] = (Math.random() - 0.5) * WORLD_DEPTH;
    }
    windGeometry.setAttribute("position", new THREE.BufferAttribute(windPositions, 3));
    const windMaterial = new THREE.PointsMaterial({
      color: "#f4fbff",
      size: 1.8,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    const windParticles = new THREE.Points(windGeometry, windMaterial);
    windParticles.renderOrder = 8;
    scene.add(windParticles);
    windParticlesRef.current = windParticles;

    for (let tx = 0; tx < WORLD_WIDTH / TILE_SIZE; tx += 1) {
      for (let tz = 0; tz < WORLD_DEPTH / TILE_SIZE; tz += 1) {
        const x = tx * TILE_SIZE - WORLD_WIDTH * 0.5 + TILE_SIZE * 0.5;
        const z = tz * TILE_SIZE - WORLD_DEPTH * 0.5 + TILE_SIZE * 0.5;
        const variant = (tx + tz) % TILE_VARIANTS;
        const color = ["#2c6f92", "#327a9e", "#3a84a8", "#30789c"][variant];
        const tile = new THREE.Mesh(
          new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 6, 6),
          new THREE.MeshStandardMaterial({
            color,
            roughness: 0.5,
            metalness: 0.1,
            transparent: true,
            opacity: 0.93,
          }),
        );
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(x, 0, z);
        tile.receiveShadow = true;
        scene.add(tile);
        const positionAttr = tile.geometry.attributes.position as THREE.BufferAttribute;
        const baseXZ = new Float32Array(positionAttr.count * 2);
        for (let i = 0; i < positionAttr.count; i += 1) {
          baseXZ[i * 2] = positionAttr.getX(i);
          baseXZ[i * 2 + 1] = positionAttr.getZ(i);
        }
        tiles.push({
          mesh: tile,
          positionAttr,
          baseXZ,
          lightnessOffset: (variant - (TILE_VARIANTS - 1) * 0.5) * 0.012,
        });
      }
    }

    if (RENDER_LAND_POLYGONS) {
      void (async () => {
        const fetchLand = async (path: string) => {
          const response = await fetch(path, { signal: abortController.signal });
          if (!response.ok) return null;
          return (await response.json()) as GeoJsonFeatureCollection;
        };
        try {
          // Keep deterministic order so NYC visibly appears before NJ.
          const nyc = await fetchLand("/assets/data/nyc-harbor-land.geojson");
          if (!disposed && nyc) addGeoJsonLand(scene, nyc);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const nj = await fetchLand("/assets/data/nj-land-polygons.geojson");
          if (!disposed && nj) addGeoJsonLand(scene, nj);
        } catch {
          // Land polygons are optional.
        }
      })();
    }

    // Coastline line overlay disabled — land polygons provide the shore edge now.
    // void (async () => {
    //   try {
    //     const response = await fetch("/assets/data/harbor-coastline-lines.geojson");
    //     if (!response.ok) return;
    //     const geojson = (await response.json()) as GeoJsonLineFeatureCollection;
    //     const added = addCoastlineLines(scene, geojson);
    //     coastlineObjects.push(...added);
    //   } catch {
    //     // Optional overlay; ignore load errors.
    //   }
    // })();

    const handleResize = () => {
      if (!rendererRef.current || !cameraRef.current || !sceneRef.current) return;
      const width = sceneRef.current.clientWidth;
      const height = sceneRef.current.clientHeight;
      if (width === 0 || height === 0) return;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(mount);
    requestAnimationFrame(() => handleResize());

    const handlePointerDown = (event: PointerEvent) => {
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!sceneRef.current || !cameraRef.current) return;
      const rect = sceneRef.current.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current);

      raycastTargets.length = 0;
      for (const marker of shipMarkers.values()) {
        raycastTargets.push(marker);
      }
      const hits = raycasterRef.current.intersectObjects(raycastTargets, true);
      const hoveredMarker = hits.length > 0 ? getShipMarkerFromObject(hits[0].object) : null;
      const prevHovered = hoveredShipRef.current;

      if (prevHovered && prevHovered !== hoveredMarker) {
        const prevData = getShipMarkerData(prevHovered);
        prevHovered.material.color.copy(prevData.baseColor);
      }

      if (hoveredMarker) {
        const hoveredData = getShipMarkerData(hoveredMarker);
        const hoverColor = hoveredData.baseColor.clone().offsetHSL(0, 0.12, 0.16);
        hoveredMarker.material.color.copy(hoverColor);
        mount.style.cursor = "pointer";
      } else {
        mount.style.cursor = "grab";
      }

      hoveredShipRef.current = hoveredMarker;
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (moved > 6) return;

      const rect = sceneRef.current.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current);

      raycastTargets.length = 0;
      for (const marker of shipMarkers.values()) {
        raycastTargets.push(marker);
      }
      const hits = raycasterRef.current.intersectObjects(raycastTargets, true);
      if (hits.length === 0) {
        handleClose();
        return;
      }

      const marker = getShipMarkerFromObject(hits[0].object);
      if (!marker) {
        handleClose();
        return;
      }
      const focusedShip = getShipMarkerData(marker).ship;
      controls.target.copy(marker.position);
      camera.position.lerp(marker.position.clone().add(new THREE.Vector3(0, 203, -142)), 0.75);
      controls.update();
      handleShipClick(focusedShip, marker.position);
    };

    window.addEventListener("resize", handleResize);
    mount.addEventListener("pointerdown", handlePointerDown);
    mount.addEventListener("pointermove", handlePointerMove);
    mount.addEventListener("pointerup", handlePointerUp);
    mount.style.cursor = "grab";

    const backgroundColor = new THREE.Color();
    const now = performance.now();
    let nextNightCheck = now;
    let cachedNight = isNightTime();

    const animate = (time: number) => {
      if (!sceneInstanceRef.current || !cameraRef.current || !rendererRef.current) return;
      const t = time * 0.001;
      const env = environmentRef.current;
      if (time >= nextNightCheck) {
        cachedNight = isNightTime();
        nextNightCheck = time + 30_000;
      }
      const night = cachedNight;
      const mood = moodFromForecast(env.forecastSummary);
      const waterTempNorm = Math.min(Math.max((env.seaSurfaceTempC - 2) / 22, 0), 1);
      const waveIntensity = Math.min(Math.max(env.waveHeightM / 2.2, 0.12), 1.9);
      const waveSpeed = 0.65 + waveIntensity * 1.45;
      const swellVec = degToVectorOnWater(env.swellDirectionDeg);
      const tideHeightOffset = Math.min(Math.max(env.tideLevelM * 1.3, -2.2), 2.4);
      const waterHue = 0.56 - waterTempNorm * 0.06;
      const waterSat = 0.48 + waterTempNorm * 0.12;
      const waterLightBase = night ? 0.2 + waterTempNorm * 0.05 : 0.34 + waterTempNorm * 0.08;

      for (let i = 0; i < tiles.length; i += 1) {
        const tile = tiles[i];
        const attr = tile.positionAttr;
        const positions = attr.array as Float32Array;
        const material = tile.mesh.material;
        material.color.setHSL(
          waterHue,
          waterSat,
          waterLightBase + tile.lightnessOffset,
        );

        for (let v = 0, p = 0, b = 0; v < attr.count; v += 1, p += 3, b += 2) {
          const x = tile.baseXZ[b];
          const z = tile.baseXZ[b + 1];
          const swellAxis = x * swellVec.x + z * swellVec.y;
          const chopAxis = x * 0.55 - z * 0.35;
          const y =
            Math.sin((swellAxis * 0.05) + t * 1.9 * waveSpeed + i * 0.6) * 1.9 * waveIntensity +
            Math.cos((chopAxis * 0.08) - t * 3.1 * waveSpeed + i * 0.3) * 0.65 * waveIntensity +
            tideHeightOffset;
          positions[p + 1] = y;
        }
        attr.needsUpdate = true;
      }

      const fog = sceneInstanceRef.current.fog as THREE.Fog;
      if (mood === "fog") {
        fog.near = 350;
        fog.far = 1200;
      } else if (mood === "rain") {
        fog.near = 650;
        fog.far = 1700;
      } else {
        fog.near = 820;
        fog.far = 2300;
      }
      fog.color.set(night ? "#1d2b3b" : mood === "overcast" ? "#8ea2b0" : "#a7c5d8");
      backgroundColor.set(night ? "#203246" : mood === "rain" ? "#6f8ca1" : mood === "overcast" ? "#7ea2b8" : "#89b3cf");
      (sceneInstanceRef.current.background as THREE.Color).copy(backgroundColor);
      hemiLight.intensity = night ? 0.36 : mood === "overcast" ? 0.58 : 0.84;
      sunLight.intensity = night ? 0.22 : mood === "rain" ? 0.55 : 1.05;

      for (const marker of shipMarkers.values()) {
        const markerData = getShipMarkerData(marker);
        const isAnchored = markerData.ship.navStatus === 1;
        const isMoored = markerData.ship.navStatus === 5;
        const isMoving = markerData.ship.sog > 2.4;
        const bob = isAnchored ? Math.sin(t * 2 + (markerData.mmsi % 11)) * 0.8 : 0;
        marker.position.lerp(markerData.target, isMoored ? 0.08 : 0.16);
        marker.position.y = SHIP_BASE_Y + bob;
        marker.rotation.y = (-markerData.ship.heading * Math.PI) / 180;
        const wake = markerData.wake;
        wake.visible = isMoving && !isMoored;
        wake.scale.x = markerData.wakeWidth * (0.58 + Math.min(markerData.ship.sog / 13, 1.05));
        wake.scale.z = markerData.wakeLength * (0.72 + Math.min(markerData.ship.sog / 11, 1.24));
        wake.material.opacity = WAKE_BASE_OPACITY + Math.min(markerData.ship.sog / 55, 0.14);
      }

      if (windParticlesRef.current) {
        const wind = windParticlesRef.current;
        const windAttr = wind.geometry.attributes.position as THREE.BufferAttribute;
        const windDir = degToVectorOnWater(env.windDirectionDeg);
        const speed = 0.4 + env.windSpeedMph * 0.06;
        for (let i = 0; i < windAttr.count; i += 1) {
          const x = windAttr.getX(i) + windDir.x * speed;
          const z = windAttr.getZ(i) + windDir.y * speed;
          windAttr.setX(i, x > WORLD_WIDTH * 0.55 ? -WORLD_WIDTH * 0.55 : x < -WORLD_WIDTH * 0.55 ? WORLD_WIDTH * 0.55 : x);
          windAttr.setZ(i, z > WORLD_DEPTH * 0.55 ? -WORLD_DEPTH * 0.55 : z < -WORLD_DEPTH * 0.55 ? WORLD_DEPTH * 0.55 : z);
        }
        windAttr.needsUpdate = true;
        wind.material.opacity = 0.12 + Math.min(env.windSpeedMph / 35, 0.45);
        wind.material.size = 1.4 + Math.min(env.windSpeedMph / 30, 1.2);
      }

      controls.update();

      const placedRects: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      const overlapPadding = 10;
      const isOverlapping = (
        a: { left: number; right: number; top: number; bottom: number },
        b: { left: number; right: number; top: number; bottom: number },
      ) =>
        a.left - overlapPadding < b.right &&
        a.right + overlapPadding > b.left &&
        a.top - overlapPadding < b.bottom &&
        a.bottom + overlapPadding > b.top;

      const projectedLabels = HARBOR_LABELS
        .map((label) => {
          const el = labelElementsRef.current.get(label.id);
          if (!el || !cameraRef.current || !sceneRef.current) return null;
          const world = latLonToWorld(label.lat, label.lon);
          world.y = 8;
          const projected = world.project(cameraRef.current);
          const visible = projected.z < 1 && projected.z > -1;
          if (!visible) return { label, el, visible: false, x: 0, y: 0 };
          const x = ((projected.x + 1) * 0.5) * sceneRef.current.clientWidth + (label.offsetX ?? 0);
          const y = ((-projected.y + 1) * 0.5) * sceneRef.current.clientHeight + (label.offsetY ?? 0);
          return { label, el, visible: true, x, y };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry != null)
        .sort((a, b) => b.label.priority - a.label.priority);

      for (const entry of projectedLabels) {
        const { label, el, x, y, visible } = entry;
        if (!visible) {
          el.style.opacity = "0";
          continue;
        }
        const cachedSize = labelSizes.get(label.id);
        const width = cachedSize?.width ?? (el.offsetWidth || 100);
        const height = cachedSize?.height ?? (el.offsetHeight || 20);
        labelSizes.set(label.id, { width, height });
        const rect = {
          left: x - width * 0.5,
          right: x + width * 0.5,
          top: y - height * 0.5,
          bottom: y + height * 0.5,
        };
        if (placedRects.some((placed) => isOverlapping(rect, placed))) {
          el.style.opacity = "0";
          continue;
        }
        placedRects.push(rect);
        el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
        el.style.opacity = "1";
      }

      rendererRef.current.render(sceneInstanceRef.current, cameraRef.current);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      mount.removeEventListener("pointerdown", handlePointerDown);
      mount.removeEventListener("pointermove", handlePointerMove);
      mount.removeEventListener("pointerup", handlePointerUp);
      if (animationRef.current != null) {
        cancelAnimationFrame(animationRef.current);
      }
      mount.style.cursor = "";
      const hovered = hoveredShipRef.current;
      if (hovered) {
        const data = getShipMarkerData(hovered);
        hovered.material.color.copy(data.baseColor);
        hoveredShipRef.current = null;
      }
      controls.dispose();
      controlsRef.current = null;
      if (windParticlesRef.current) {
        windParticlesRef.current.geometry.dispose();
        windParticlesRef.current.material.dispose();
        windParticlesRef.current = null;
      }
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
      shipMarkers.clear();
      raycastTargets.length = 0;
      labelSizes.clear();
      for (const tile of tiles) {
        scene.remove(tile.mesh);
        tile.mesh.geometry.dispose();
        tile.mesh.material.dispose();
      }
      tiles.length = 0;
      for (const object of coastlineObjects) {
        scene.remove(object);
        if (object instanceof THREE.Line) {
          object.geometry.dispose();
        }
      }
      coastlineObjects.length = 0;
      disposed = true;
      abortController.abort();
      landPolygonRings.length = 0;
    };
  }, [handleClose, handleShipClick]);

  useEffect(() => {
    const scene = sceneInstanceRef.current;
    if (!scene) return;

    const nextShipIds = new Set<number>();
    const occupiedSlots: OccupiedSlot[] = [];
    const orderedShips = Array.from(ships.values()).sort(
      (a, b) => (b.lengthM > 0 ? b.lengthM : 0) - (a.lengthM > 0 ? a.lengthM : 0),
    );

    for (const ship of orderedShips) {
      if (ship.lat === 0 && ship.lon === 0) continue;
      const mmsi = ship.mmsi;
      const category = getShipCategory(ship.shipType);
      const style = CATEGORY_STYLES[category];
      const baseTarget = latLonToWorld(ship.lat, ship.lon);
      const radius = getShipCollisionRadius(ship, style);
      const resolvedTarget = resolveShipTarget(baseTarget, mmsi, radius, occupiedSlots);
      const existing = shipMarkersRef.current.get(mmsi);
      const dimensionFactor = Math.min(
        Math.max((ship.lengthM > 0 ? ship.lengthM / 180 : 0.8) + (ship.beamM > 0 ? ship.beamM / 70 : 0.3), 0.75),
        2.3,
      );
      const nextSizeScale = style.scale * dimensionFactor;

      if (existing) {
        const markerData = getShipMarkerData(existing);
        markerData.ship = ship;
        markerData.radius = radius;
        const nextTarget = resolvedTarget ?? markerData.target;
        markerData.target.copy(nextTarget);

        const needsGeometryRefresh =
          markerData.category !== category || Math.abs(markerData.sizeScale - nextSizeScale) > 0.04;

        if (needsGeometryRefresh) {
          markerData.category = category;
          markerData.sizeScale = nextSizeScale;
          existing.geometry.dispose();
          existing.geometry = createShipGeometry(category, nextSizeScale);
        }

        const nextColor = new THREE.Color(style.color);
        markerData.baseColor.copy(nextColor);
        existing.material.color.copy(nextColor);
        markerData.wakeWidth = style.wakeWidth;
        markerData.wakeLength = style.wakeLength;

        if (needsGeometryRefresh) {
          const detail = existing.children.find((child) => child.name === "ship-detail");
          if (detail instanceof THREE.Mesh) {
            if (detail.material instanceof THREE.Material) detail.material.dispose();
            detail.geometry.dispose();
            const nextDetail = createShipDetailMesh(category, nextSizeScale, nextColor);
            nextDetail.name = "ship-detail";
            existing.remove(detail);
            existing.add(nextDetail);
          }

          const hitArea = existing.children.find((child) => child.name === "ship-hit-area");
          if (hitArea instanceof THREE.Mesh) {
            hitArea.geometry.dispose();
            hitArea.geometry = new THREE.SphereGeometry((12 + Math.max(ship.lengthM / 20, 0)) * style.scale, 12, 12);
          }
        }

        nextShipIds.add(mmsi);
        occupiedSlots.push({ mmsi, radius, x: nextTarget.x, z: nextTarget.z });
        continue;
      }

      if (!resolvedTarget) continue;

      const hullGeometry = createShipGeometry(category, nextSizeScale);
      const hullColor = new THREE.Color(style.color);
      const hull = new THREE.Mesh(
        hullGeometry,
        new THREE.MeshStandardMaterial({
          color: hullColor,
          roughness: 0.55,
          metalness: 0.2,
        }),
      );
      hull.castShadow = true;
      hull.position.copy(resolvedTarget);
      hull.position.y = SHIP_BASE_Y;
      hull.renderOrder = 5;

      const wake = new THREE.Mesh(
        createWakeGeometry(),
        new THREE.MeshBasicMaterial({
          color: "#b7d7e6",
          transparent: true,
          opacity: WAKE_BASE_OPACITY,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      wake.position.set(0, -SHIP_BASE_Y + WAKE_WORLD_Y, -16);
      wake.renderOrder = 4;
      hull.add(wake);

      const detail = createShipDetailMesh(category, nextSizeScale, hullColor);
      detail.name = "ship-detail";
      hull.add(detail);

      const hitArea = new THREE.Mesh(
        new THREE.SphereGeometry((12 + Math.max(ship.lengthM / 20, 0)) * style.scale, 12, 12),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      hitArea.name = "ship-hit-area";
      hull.add(hitArea);

      hull.userData = {
        isShipMarker: true,
        mmsi,
        ship,
        target: resolvedTarget,
        wake,
        baseColor: hullColor.clone(),
        category,
        radius,
        wakeWidth: style.wakeWidth,
        wakeLength: style.wakeLength,
        sizeScale: nextSizeScale,
      } as ShipMarkerData;

      scene.add(hull);
      shipMarkersRef.current.set(mmsi, hull);
      nextShipIds.add(mmsi);
      occupiedSlots.push({ mmsi, radius, x: resolvedTarget.x, z: resolvedTarget.z });
    }

    for (const [mmsi, marker] of shipMarkersRef.current.entries()) {
      if (nextShipIds.has(mmsi)) continue;
      scene.remove(marker);
      if (hoveredShipRef.current === marker) {
        hoveredShipRef.current = null;
      }
      marker.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          for (const material of child.material) {
            material.dispose();
          }
          return;
        }
        child.material.dispose();
      });
      shipMarkersRef.current.delete(mmsi);
    }
  }, [ships]);

  return (
    <div ref={sceneRef} className="harbor-scene">
      {environment.activeAlerts > 0 ? <div className="harbor-alert-glow" /> : null}
      <div className="harbor-label-layer" aria-hidden="true">
        {HARBOR_LABELS.map((label) => (
          <div
            key={label.id}
            ref={(el) => {
              if (el) {
                labelElementsRef.current.set(label.id, el);
              } else {
                labelElementsRef.current.delete(label.id);
              }
            }}
            className={`harbor-label harbor-label-${label.kind}${label.style ? ` harbor-label-${label.style}` : ""}`}
          >
            {label.text}
          </div>
        ))}
      </div>
      <div className="harbor-scene-overlay">
        Drag to pan, scroll to zoom, hover to inspect vessels.
      </div>
      {selectedShip && (
        <ShipInfoCard
          ship={selectedShip.ship}
          x={selectedShip.x}
          y={selectedShip.y}
          sceneWidth={selectedShip.sceneWidth}
          sceneHeight={selectedShip.sceneHeight}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
