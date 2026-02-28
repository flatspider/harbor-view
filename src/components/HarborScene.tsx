import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { ShipData } from "../types/ais";
import type { AircraftData } from "../types/aircraft";
import type { HarborEnvironment } from "../types/environment";
import { ShipInfoCard } from "./ShipInfoCard";
import { FerryRouteInfoCard } from "./FerryRouteInfoCard";
import { AircraftInfoCard } from "./AircraftInfoCard";
import { GhibliEdgeShader } from "../scene/ghibliEdgeShader";
import { GhibliColorShader } from "../scene/ghibliColorShader";

// Scene layer modules
import {
  WORLD_WIDTH,
  WORLD_DEPTH,
  WORLD_UNITS_PER_METER,
  SHIP_BASE_Y,
  RENDER_LAND_POLYGONS,
  RENDER_SMOKE_SKYLINE,
  isNightTime,
  getShipMarkerData,
  getShipMarkerFromObject,
  type ShipMesh,
  type WaterTile,
} from "../scene/constants";
import { landPolygonRings, loadLandPolygons } from "../scene/land";
import { loadSkylineSmoke } from "../scene/skyline";
import {
  createWaterTiles,
  animateWaterTiles,
  disposeWaterTiles,
} from "../scene/ocean";
import { reconcileShips, animateShips, sanitizeShipSpeedKnots } from "../scene/ships";
import {
  reconcileAircraft,
  animateAircraft,
  getAircraftMarkerData,
  getAircraftMarkerFromObject,
  type AircraftMarker,
} from "../scene/airplanes";
import {
  createWindParticles,
  animateAtmosphere,
  disposeWindParticles,
} from "../scene/atmosphere";
import { HARBOR_LABELS, projectLabels } from "../scene/labels";
import {
  createSkyBackdrop,
  animateSky,
  disposeSkyBackdrop,
  getDefaultSkySettings,
  type SkySettings,
} from "../scene/sky";
import {
  loadFerryRoutes,
  setFerryRouteNight,
  disposeFerryRoutes,
  getFerryRouteTargets,
  getFerryRouteFromObject,
  getFerryRouteData,
  type FerryRouteInfo,
} from "../scene/ferryRoutes";
import {
  loadShipCategoryTextures,
  type ShipCategoryTextureMap,
} from "../scene/shipTextures";
import {
  loadAirplanePrototypes,
  type AirplanePrototypeSet,
} from "../scene/airplaneModel";
import { loadContainerShipPrototype } from "../scene/containerShipModel";
import { loadPassengerFerryPrototype } from "../scene/passengerFerryModel";
import { loadSmallBoatPrototype } from "../scene/smallBoatModel";
import { applyNightToonLook } from "../scene/modelLook";

interface HarborSceneProps {
  ships: Map<number, ShipData>;
  aircraft: Map<string, AircraftData>;
  environment: HarborEnvironment;
  onSceneReady?: () => void;
}

type SkySettingKey = keyof SkySettings;

interface SkySliderConfig {
  key: SkySettingKey;
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
}

const SKY_SLIDERS: SkySliderConfig[] = [
  {
    key: "turbidity",
    label: "Turbidity",
    min: 0,
    max: 20,
    step: 0.1,
    digits: 1,
  },
  { key: "rayleigh", label: "Rayleigh", min: 0, max: 4, step: 0.01, digits: 2 },
  {
    key: "mieCoefficient",
    label: "Mie Coef",
    min: 0,
    max: 0.1,
    step: 0.0001,
    digits: 4,
  },
  {
    key: "mieDirectionalG",
    label: "Mie Dir G",
    min: 0,
    max: 1,
    step: 0.001,
    digits: 3,
  },
  {
    key: "elevation",
    label: "Elevation",
    min: -15,
    max: 90,
    step: 0.1,
    digits: 1,
  },
  { key: "azimuth", label: "Azimuth", min: 0, max: 360, step: 0.1, digits: 1 },
  { key: "exposure", label: "Exposure", min: 0, max: 2, step: 0.01, digits: 2 },
];
const SHOW_SCENE_DEBUG_PANELS = false;

const FASTEST_SHIP_MIN_OBSERVED_SPEED_KNOTS = 1.2;
const FASTEST_SHIP_MIN_OBSERVED_SAMPLE_MS = 1_000;

function estimateObservedTelemetrySpeedKnots(markerData: ReturnType<typeof getShipMarkerData>): number {
  const dtMs = markerData.motion.anchorTimeMs - markerData.motion.prevAnchorTimeMs;
  if (!Number.isFinite(dtMs) || dtMs < FASTEST_SHIP_MIN_OBSERVED_SAMPLE_MS) return 0;
  const dx = markerData.motion.anchorPosition.x - markerData.motion.prevAnchorPosition.x;
  const dz = markerData.motion.anchorPosition.z - markerData.motion.prevAnchorPosition.z;
  const distanceUnits = Math.hypot(dx, dz);
  const distanceMeters = distanceUnits / WORLD_UNITS_PER_METER;
  const metersPerSecond = distanceMeters / (dtMs / 1000);
  return metersPerSecond / 0.5144;
}

function createCompassLabelSprite(text: string, fontPx = 26): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: "#ffffff" }),
    );
    fallback.scale.set(16, 6, 1);
    return fallback;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `600 ${fontPx}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#d7e7f2";
  ctx.strokeStyle = "#1b2f3f";
  ctx.lineWidth = 8;
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 30;
  return sprite;
}

function createCompassDebugGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = "debug-compass";
  const radius = 72;

  const ringPoints: THREE.Vector3[] = [];
  const ringSegments = 120;
  for (let i = 0; i <= ringSegments; i += 1) {
    const a = (i / ringSegments) * Math.PI * 2;
    ringPoints.push(
      new THREE.Vector3(-Math.sin(a) * radius, 0, Math.cos(a) * radius),
    );
  }
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(ringPoints),
    new THREE.LineBasicMaterial({
      color: "#6ba7c6",
      transparent: true,
      opacity: 0.85,
    }),
  );
  ring.renderOrder = 20;
  group.add(ring);

  const tickPositions: number[] = [];
  for (let deg = 0; deg < 360; deg += 10) {
    const rad = (deg * Math.PI) / 180;
    const tickLen = deg % 90 === 0 ? 12 : deg % 30 === 0 ? 8 : 4;
    const inner = radius - tickLen;
    const outer = radius + (deg % 30 === 0 ? 2 : 0);
    tickPositions.push(
      -Math.sin(rad) * inner,
      0,
      Math.cos(rad) * inner,
      -Math.sin(rad) * outer,
      0,
      Math.cos(rad) * outer,
    );
  }
  const ticks = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(tickPositions, 3),
    ),
    new THREE.LineBasicMaterial({
      color: "#8ac0db",
      transparent: true,
      opacity: 0.9,
    }),
  );
  ticks.renderOrder = 20;
  group.add(ticks);

  const headingLabels = [
    { deg: 0, text: "N (0)" },
    { deg: 90, text: "E (90)" },
    { deg: 180, text: "S (180)" },
    { deg: 270, text: "W (270)" },
    { deg: 30, text: "30" },
    { deg: 60, text: "60" },
    { deg: 120, text: "120" },
    { deg: 150, text: "150" },
    { deg: 210, text: "210" },
    { deg: 240, text: "240" },
    { deg: 300, text: "300" },
    { deg: 330, text: "330" },
  ];
  for (const label of headingLabels) {
    const sprite = createCompassLabelSprite(
      label.text,
      label.deg % 90 === 0 ? 30 : 24,
    );
    const rad = (label.deg * Math.PI) / 180;
    const labelRadius = radius + (label.deg % 90 === 0 ? 22 : 16);
    sprite.position.set(
      -Math.sin(rad) * labelRadius,
      0.5,
      Math.cos(rad) * labelRadius,
    );
    sprite.scale.set(
      label.deg % 90 === 0 ? 28 : 16,
      label.deg % 90 === 0 ? 9 : 6,
      1,
    );
    group.add(sprite);
  }

  return group;
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Sprite) {
      if (child.material instanceof THREE.SpriteMaterial) {
        child.material.map?.dispose();
        child.material.dispose();
      }
      return;
    }
    if (
      child instanceof THREE.Line ||
      child instanceof THREE.LineSegments ||
      child instanceof THREE.Mesh
    ) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        for (const material of child.material) material.dispose();
      } else if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
  });
}

function createFastestShipIndicator(): THREE.Group {
  const group = new THREE.Group();
  group.name = "fastest-ship-indicator";
  group.visible = false;
  group.renderOrder = 25;

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 8.4, 12),
    new THREE.MeshBasicMaterial({
      color: "#f7f9fb",
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  );
  pole.position.y = 4.2;
  group.add(pole);

  const pennantShape = new THREE.Shape();
  pennantShape.moveTo(0, 0);
  pennantShape.lineTo(4.4, 1.2);
  pennantShape.lineTo(0, 2.4);
  pennantShape.lineTo(1.1, 1.2);
  pennantShape.lineTo(0, 0);
  const pennant = new THREE.Mesh(
    new THREE.ShapeGeometry(pennantShape),
    new THREE.MeshBasicMaterial({
      color: "#ff6f61",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  );
  pennant.position.set(0.3, 5.7, 0);
  pennant.rotation.y = Math.PI / 2;
  group.add(pennant);

  const arrowTip = new THREE.Mesh(
    new THREE.ConeGeometry(0.95, 2.3, 14),
    new THREE.MeshBasicMaterial({
      color: "#ffe08c",
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  );
  arrowTip.position.y = 8.7;
  group.add(arrowTip);

  return group;
}

function applyNightLookToObject(object: THREE.Object3D, enabled: boolean): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material;
    if (Array.isArray(material)) {
      for (const mat of material) {
        if (mat instanceof THREE.MeshToonMaterial) applyNightToonLook(mat, enabled);
      }
      return;
    }
    if (material instanceof THREE.MeshToonMaterial) {
      applyNightToonLook(material, enabled);
    }
  });
}

function applyNightLookToMarkers(
  shipMarkers: Map<number, ShipMesh>,
  aircraftMarkers: Map<string, AircraftMarker>,
  enabled: boolean,
): void {
  for (const marker of shipMarkers.values()) applyNightLookToObject(marker, enabled);
  for (const marker of aircraftMarkers.values()) applyNightLookToObject(marker, enabled);
}

export function HarborScene({
  ships,
  aircraft,
  environment,
  onSceneReady,
}: HarborSceneProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const sceneInstanceRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const edgePassRef = useRef<ShaderPass | null>(null);
  const colorPassRef = useRef<ShaderPass | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const controlsRef = useRef<MapControls | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMoveEventRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMoveRafRef = useRef<number | null>(null);
  const hoverColorRef = useRef(new THREE.Color());
  const hoveredShipRef = useRef<ShipMesh | null>(null);
  const hoveredFerryRef = useRef<THREE.Line | null>(null);
  const animationRef = useRef<number | null>(null);
  const frameLoopTokenRef = useRef(0);
  const shipMarkersRef = useRef<Map<number, ShipMesh>>(new Map());
  const aircraftMarkersRef = useRef<Map<string, AircraftMarker>>(new Map());
  const ferryRouteTargetsRef = useRef<THREE.Line[]>([]);
  const tileRef = useRef<WaterTile[]>([]);
  const windParticlesRef = useRef<THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  > | null>(null);
  const coastlineObjectsRef = useRef<THREE.Object3D[]>([]);
  const raycastTargetsRef = useRef<ShipMesh[]>([]);
  const aircraftRaycastTargetsRef = useRef<AircraftMarker[]>([]);
  const labelSizesRef = useRef(
    new Map<string, { width: number; height: number }>(),
  );
  const labelElementsRef = useRef(new Map<string, HTMLDivElement>());
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fastestShipIndicatorRef = useRef<THREE.Group | null>(null);
  const fastestShipMmsiRef = useRef<number | null>(null);
  const nextFastestScanAtMsRef = useRef(0);
  const backgroundColorRef = useRef(new THREE.Color());
  const lastBackgroundRef = useRef(new THREE.Color());
  const skyMeshRef = useRef<THREE.Mesh | null>(null);
  const environmentRef = useRef(environment);
  const shipCategoryTexturesRef = useRef<ShipCategoryTextureMap | null>(null);
  const passengerFerryPrototypeRef = useRef<THREE.Object3D | null>(null);
  const containerShipPrototypeRef = useRef<THREE.Object3D | null>(null);
  const smallBoatPrototypeRef = useRef<THREE.Object3D | null>(null);
  const airplanePrototypesRef = useRef<AirplanePrototypeSet | null>(null);
  const sceneReadyEmittedRef = useRef(false);
  const [shipVisualAssetsRevision, setShipVisualAssetsRevision] = useState(0);
  const [aircraftVisualAssetsRevision, setAircraftVisualAssetsRevision] =
    useState(0);
  const shipVisualAssetsRevisionRef = useRef(shipVisualAssetsRevision);
  const aircraftVisualAssetsRevisionRef = useRef(aircraftVisualAssetsRevision);
  const [skyAutoMode, setSkyAutoMode] = useState(true);
  const [skyPanelOpen, setSkyPanelOpen] = useState(false);
  const [manualSkySettings, setManualSkySettings] = useState<SkySettings>(() =>
    getDefaultSkySettings(),
  );
  const skyAutoModeRef = useRef(skyAutoMode);
  const manualSkySettingsRef = useRef(manualSkySettings);
  const [lightingPanelOpen, setLightingPanelOpen] = useState(false);
  const [lightingOverride, setLightingOverride] = useState(false);
  const lightingOverrideRef = useRef(false);
  const lightingValuesRef = useRef({
    hemiIntensity: 1.1,
    sunIntensity: 0.7,
    exposure: 1.0,
    saturationBoost: 1.35,
    warmthShift: 0.035,
    edgeStrength: 0.9,
    edgeThreshold: 0.14,
    bloomStrength: 0.08,
    bloomRadius: 0.4,
    bloomThreshold: 0.92,
    hemiSkyColor: "#ddd8e8",
    hemiGroundColor: "#5a5468",
    sunColor: "#ffe0b2",
    toneMapping: THREE.LinearToneMapping as number,
    shadowsEnabled: false,
  });
  const [lightingValues, setLightingValues] = useState(() => ({
    ...lightingValuesRef.current,
  }));

  const [selectedShip, setSelectedShip] = useState<{
    ship: ShipData;
    x: number;
    y: number;
    sceneWidth: number;
    sceneHeight: number;
  } | null>(null);
  const [selectedFerryRoute, setSelectedFerryRoute] = useState<{
    route: FerryRouteInfo;
    x: number;
    y: number;
    sceneWidth: number;
    sceneHeight: number;
  } | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<{
    aircraft: AircraftData;
    x: number;
    y: number;
    sceneWidth: number;
    sceneHeight: number;
  } | null>(null);
  const selectedShipRef = useRef<typeof selectedShip>(null);
  const selectedFerryRouteRef = useRef<typeof selectedFerryRoute>(null);
  const selectedAircraftRef = useRef<typeof selectedAircraft>(null);
  const selectedShipMarkerRef = useRef<ShipMesh | null>(null);
  const selectedAircraftMarkerRef = useRef<AircraftMarker | null>(null);
  const tooltipOpenedAtMsRef = useRef<number>(0);
  const cameraFocusRef = useRef<{
    startMs: number;
    durationMs: number;
    fromCamera: THREE.Vector3;
    toCamera: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null>(null);
  const showDebugGrid =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("grid");

  useEffect(() => {
    selectedShipRef.current = selectedShip;
  }, [selectedShip]);
  useEffect(() => {
    selectedFerryRouteRef.current = selectedFerryRoute;
  }, [selectedFerryRoute]);
  useEffect(() => {
    selectedAircraftRef.current = selectedAircraft;
  }, [selectedAircraft]);

  const handleShipClick = useCallback(
    (ship: ShipData, worldPos: THREE.Vector3, marker?: ShipMesh) => {
      const sceneRect = sceneRef.current?.getBoundingClientRect();
      const camera = cameraRef.current;
      if (!sceneRect || !camera) return;
      const projected = worldPos.clone().project(camera);
      const x = (projected.x + 1) * 0.5 * sceneRect.width;
      const y = (-projected.y + 1) * 0.5 * sceneRect.height;
      tooltipOpenedAtMsRef.current = performance.now();
      selectedShipMarkerRef.current = marker ?? null;
      selectedAircraftMarkerRef.current = null;
      setSelectedAircraft(null);
      setSelectedFerryRoute(null);
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

  const handleFerryRouteClick = useCallback(
    (route: FerryRouteInfo, worldPos: THREE.Vector3) => {
      const sceneRect = sceneRef.current?.getBoundingClientRect();
      const camera = cameraRef.current;
      if (!sceneRect || !camera) return;
      const projected = worldPos.clone().project(camera);
      const x = (projected.x + 1) * 0.5 * sceneRect.width;
      const y = (-projected.y + 1) * 0.5 * sceneRect.height;
      tooltipOpenedAtMsRef.current = performance.now();
      selectedShipMarkerRef.current = null;
      selectedAircraftMarkerRef.current = null;
      setSelectedShip(null);
      setSelectedAircraft(null);
      setSelectedFerryRoute({
        route,
        x,
        y,
        sceneWidth: sceneRect.width,
        sceneHeight: sceneRect.height,
      });
    },
    [],
  );

  const handleAircraftClick = useCallback(
    (
      aircraftData: AircraftData,
      worldPos: THREE.Vector3,
      marker?: AircraftMarker,
    ) => {
      const sceneRect = sceneRef.current?.getBoundingClientRect();
      const camera = cameraRef.current;
      if (!sceneRect || !camera) return;
      const projected = worldPos.clone().project(camera);
      const x = (projected.x + 1) * 0.5 * sceneRect.width;
      const y = (-projected.y + 1) * 0.5 * sceneRect.height;
      tooltipOpenedAtMsRef.current = performance.now();
      selectedShipMarkerRef.current = null;
      selectedAircraftMarkerRef.current = marker ?? null;
      setSelectedShip(null);
      setSelectedFerryRoute(null);
      setSelectedAircraft({
        aircraft: aircraftData,
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
    setSelectedFerryRoute(null);
    setSelectedAircraft(null);
    selectedShipMarkerRef.current = null;
    selectedAircraftMarkerRef.current = null;
    tooltipOpenedAtMsRef.current = 0;
    cameraFocusRef.current = null;
  }, []);

  useEffect(() => {
    environmentRef.current = environment;
  }, [environment]);

  useEffect(() => {
    skyAutoModeRef.current = skyAutoMode;
  }, [skyAutoMode]);

  useEffect(() => {
    manualSkySettingsRef.current = manualSkySettings;
  }, [manualSkySettings]);

  useEffect(() => {
    lightingOverrideRef.current = lightingOverride;
  }, [lightingOverride]);

  useEffect(() => {
    lightingValuesRef.current = lightingValues;
  }, [lightingValues]);

  useEffect(() => {
    shipVisualAssetsRevisionRef.current = shipVisualAssetsRevision;
  }, [shipVisualAssetsRevision]);

  useEffect(() => {
    aircraftVisualAssetsRevisionRef.current = aircraftVisualAssetsRevision;
  }, [aircraftVisualAssetsRevision]);

  const handleLightingChange = useCallback(
    (key: string, value: number | string | boolean) => {
      setLightingValues((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handlePrintLighting = useCallback(() => {
    console.log(
      "[Harbor Watch] Lighting Debug Values:",
      JSON.stringify(lightingValuesRef.current, null, 2),
    );
  }, []);

  const handleSkySettingChange = useCallback(
    (key: SkySettingKey, value: number) => {
      setManualSkySettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleResetSkySettings = useCallback(() => {
    setManualSkySettings(getDefaultSkySettings());
  }, []);

  const announceSceneReady = useCallback(() => {
    if (sceneReadyEmittedRef.current) return;
    sceneReadyEmittedRef.current = true;
    onSceneReady?.();
  }, [onSceneReady]);

  /* ── Scene Setup ───────────────────────────────────────────────────── */

  useEffect(() => {
    const mount = sceneRef.current;
    if (!mount) return;
    const shipMarkers = shipMarkersRef.current;
    const ferryRouteTargets = ferryRouteTargetsRef.current;
    const tiles = tileRef.current;
    const coastlineObjects = coastlineObjectsRef.current;
    const debugObjects: THREE.Object3D[] = [];
    const raycastTargets = raycastTargetsRef.current;
    const labelSizes = labelSizesRef.current;
    const abortController = new AbortController();
    landPolygonRings.length = 0;
    raycasterRef.current.params.Line = { threshold: 8 };

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#c8c2d5");
    scene.fog = new THREE.FogExp2("#c8c2d5", 0.00018);
    sceneInstanceRef.current = scene;
    if (showDebugGrid) {
      const gridSize = Math.max(WORLD_WIDTH, WORLD_DEPTH) * 1.2;
      const divisions = Math.max(24, Math.round(gridSize / 60));
      const grid = new THREE.GridHelper(
        gridSize,
        divisions,
        "#31556c",
        "#27404f",
      );
      grid.position.y = SHIP_BASE_Y - 0.2;
      scene.add(grid);
      debugObjects.push(grid);
      const axes = new THREE.AxesHelper(120);
      axes.position.set(0, SHIP_BASE_Y + 0.1, 0);
      scene.add(axes);
      debugObjects.push(axes);
      const compass = createCompassDebugGroup();
      compass.position.set(
        WORLD_WIDTH * 0.38,
        SHIP_BASE_Y + 0.12,
        -WORLD_DEPTH * 0.38,
      );
      scene.add(compass);
      debugObjects.push(compass);
    }

    // Camera
    const camera = new THREE.PerspectiveCamera(
      40,
      mount.clientWidth / mount.clientHeight,
      2,
      5000,
    );
    // The initial polar angle (from Y-axis) determines the viewing elevation.
    // Locking this prevents camera angle changes that cause water flicker.
    const INITIAL_POLAR_ANGLE = Math.atan2(0.475, 0.67) * 1.23; // ~10% lower (more horizontal)
    camera.position.set(0, WORLD_DEPTH * 0.67, -WORLD_DEPTH * 0.475);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.LinearToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = false;
    // EffectComposer manages clearing via RenderPass — autoClear must be
    // false so the Water shader's onBeforeRender explicitly clears its
    // reflection target (Water.js line 329: "if autoClear === false").
    // With autoClear=true that clear was skipped, causing state leakage
    // from the nested reflection render into the EffectComposer pipeline.
    renderer.autoClear = false;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Post-processing pipeline (Ghibli cel-shading)
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.addPass(new RenderPass(scene, camera));

    const edgePass = new ShaderPass(GhibliEdgeShader);
    edgePass.uniforms.resolution.value.set(
      mount.clientWidth * renderer.getPixelRatio(),
      mount.clientHeight * renderer.getPixelRatio(),
    );
    edgePass.uniforms.edgeStrength.value = 0.9;
    edgePass.uniforms.edgeThreshold.value = 0.14;
    composer.addPass(edgePass);
    edgePassRef.current = edgePass;

    const colorPass = new ShaderPass(GhibliColorShader);
    composer.addPass(colorPass);
    colorPassRef.current = colorPass;

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(mount.clientWidth, mount.clientHeight),
      0.08,
      0.4,
      0.92,
    );
    // Widen the luminosity high-pass transition zone. The default (0.01)
    // is razor-sharp — sub-pixel luminance shifts from camera movement
    // cause pixels to pop in/out of bloom contribution every frame.
    // A softer ramp (0.3) keeps bloom contribution stable under motion.
    (bloomPass as any).highPassUniforms["smoothWidth"].value = 0.3;
    composer.addPass(bloomPass);
    bloomPassRef.current = bloomPass;

    composer.addPass(new OutputPass());
    composerRef.current = composer;

    // Controls
    const worldMaxSpan = Math.max(WORLD_WIDTH, WORLD_DEPTH);
    const controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableRotate = true;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 1.0;
    controls.minDistance = 12;
    controls.maxDistance = worldMaxSpan * 1.85;
    // Lock the polar angle to the initial elevation — prevents the camera
    // angle changes that cause water shader flicker.
    controls.minPolarAngle = INITIAL_POLAR_ANGLE;
    controls.maxPolarAngle = INITIAL_POLAR_ANGLE;
    controls.target.set(0, 0, 0);
    // Clamp pan so the camera can never see past the world edge.
    // Bounds are zoom-dependent: at max zoom-out the viewport shows most of
    // the world, so the target must stay near centre; at close zoom the user
    // needs to reach any point on the map.
    const clampPan = () => {
      const dist = camera.position.distanceTo(controls.target);
      const zoomT = THREE.MathUtils.clamp(
        (dist - controls.minDistance) /
          (controls.maxDistance - controls.minDistance),
        0,
        1,
      );
      // At close zoom (zoomT≈0) allow full map extent; at max zoom (zoomT≈1)
      // restrict to ~15% so the edge is never visible.
      const limitFraction = THREE.MathUtils.lerp(0.48, 0.15, zoomT);
      const halfX = WORLD_WIDTH * limitFraction;
      const halfZ = WORLD_DEPTH * limitFraction;
      controls.target.x = THREE.MathUtils.clamp(
        controls.target.x,
        -halfX,
        halfX,
      );
      controls.target.z = THREE.MathUtils.clamp(
        controls.target.z,
        -halfZ,
        halfZ,
      );
    };
    controls.addEventListener("change", clampPan);
    controls.update();
    controlsRef.current = controls;

    // Lighting — warm sun from southwest, purple-tinted ambient
    const hemiLight = new THREE.HemisphereLight("#ddd8e8", "#5a5468", 1.1);
    hemiLight.position.set(0, 600, 0);
    scene.add(hemiLight);
    hemiLightRef.current = hemiLight;

    const sunLight = new THREE.DirectionalLight("#ffe0b2", 0.7);
    sunLight.position.set(-400, 300, -350); // southwest
    sunLight.castShadow = false;
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    const skyMesh = createSkyBackdrop(scene);
    skyMeshRef.current = skyMesh;

    const fastestShipIndicator = createFastestShipIndicator();
    scene.add(fastestShipIndicator);
    fastestShipIndicatorRef.current = fastestShipIndicator;

    const windParticles = createWindParticles(scene);
    windParticlesRef.current = windParticles;

    const newTiles = createWaterTiles(scene);
    tiles.push(...newTiles);

    void (async () => {
      let visualAssetsUpdated = false;
      let aircraftAssetsUpdated = false;
      const visualLoadTasks: Promise<void>[] = [];

      try {
        if (!shipCategoryTexturesRef.current) {
          visualLoadTasks.push(
            loadShipCategoryTextures()
              .then((textures) => {
                if (abortController.signal.aborted) return;
                shipCategoryTexturesRef.current = textures;
                visualAssetsUpdated = true;
              })
              .catch((error) => {
                console.error(
                  "[harbor] Failed to load ship category textures",
                  error,
                );
              }),
          );
        }

        if (!passengerFerryPrototypeRef.current) {
          visualLoadTasks.push(
            loadPassengerFerryPrototype()
              .then((prototype) => {
                if (abortController.signal.aborted) return;
                passengerFerryPrototypeRef.current = prototype;
                visualAssetsUpdated = true;
              })
              .catch((error) => {
                console.error(
                  "[harbor] Failed to load passenger ferry model",
                  error,
                );
              }),
          );
        }

        if (!containerShipPrototypeRef.current) {
          visualLoadTasks.push(
            loadContainerShipPrototype()
              .then((prototype) => {
                if (abortController.signal.aborted) return;
                containerShipPrototypeRef.current = prototype;
                visualAssetsUpdated = true;
              })
              .catch((error) => {
                console.error(
                  "[harbor] Failed to load container ship model",
                  error,
                );
              }),
          );
        }

        if (!smallBoatPrototypeRef.current) {
          visualLoadTasks.push(
            loadSmallBoatPrototype()
              .then((prototype) => {
                if (abortController.signal.aborted) return;
                smallBoatPrototypeRef.current = prototype;
                visualAssetsUpdated = true;
              })
              .catch((error) => {
                console.error(
                  "[harbor] Failed to load small boat model",
                  error,
                );
              }),
          );
        }

        if (!airplanePrototypesRef.current) {
          visualLoadTasks.push(
            loadAirplanePrototypes()
              .then((prototypes) => {
                if (abortController.signal.aborted) return;
                airplanePrototypesRef.current = prototypes;
                aircraftAssetsUpdated = true;
              })
              .catch((error) => {
                console.error("[harbor] Failed to load airplane models", error);
              }),
          );
        }

        if (RENDER_LAND_POLYGONS) {
          await loadLandPolygons(scene, abortController.signal);
        }
        if (abortController.signal.aborted) return;

        if (RENDER_SMOKE_SKYLINE) {
          await loadSkylineSmoke(scene, abortController.signal);
        }
        if (abortController.signal.aborted) return;

        await loadFerryRoutes(scene, abortController.signal);
        if (!abortController.signal.aborted) {
          ferryRouteTargets.length = 0;
          ferryRouteTargets.push(...getFerryRouteTargets());
        }

        if (visualLoadTasks.length > 0) {
          await Promise.allSettled(visualLoadTasks);
        }
        if (visualAssetsUpdated && !abortController.signal.aborted) {
          setShipVisualAssetsRevision((prev) => prev + 1);
        }
        if (aircraftAssetsUpdated && !abortController.signal.aborted) {
          setAircraftVisualAssetsRevision((prev) => prev + 1);
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("[harbor] Scene bootstrap failed", error);
        }
      } finally {
        if (!abortController.signal.aborted) {
          announceSceneReady();
        }
      }
    })();

    // Resize
    const handleResize = () => {
      if (!rendererRef.current || !cameraRef.current || !sceneRef.current)
        return;
      const width = sceneRef.current.clientWidth;
      const height = sceneRef.current.clientHeight;
      if (width === 0 || height === 0) return;
      const pixelRatio = Math.min(window.devicePixelRatio, 2);
      rendererRef.current.setPixelRatio(pixelRatio);
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
      if (composerRef.current) {
        composerRef.current.setPixelRatio(pixelRatio);
        composerRef.current.setSize(width, height);
      }
      if (edgePassRef.current) {
        edgePassRef.current.uniforms.resolution.value.set(
          width * pixelRatio,
          height * pixelRatio,
        );
      }
    };
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(mount);
    requestAnimationFrame(() => handleResize());

    // Pointer events
    const handlePointerDown = (event: PointerEvent) => {
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };

    const setFerryLineColor = (line: THREE.Line, color: THREE.Color) => {
      const material = line.material;
      if (!Array.isArray(material)) {
        (material as THREE.LineDashedMaterial).color.copy(color);
      }
    };

    const processPointerMove = () => {
      pointerMoveRafRef.current = null;
      if (!sceneRef.current || !cameraRef.current) return;
      const pointerEvent = pointerMoveEventRef.current;
      if (!pointerEvent) return;
      const rect = sceneRef.current.getBoundingClientRect();
      pointerRef.current.x =
        ((pointerEvent.x - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y =
        -((pointerEvent.y - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current);

      raycastTargets.length = 0;
      const aircraftRaycastTargets = aircraftRaycastTargetsRef.current;
      aircraftRaycastTargets.length = 0;
      for (const marker of shipMarkers.values()) raycastTargets.push(marker);
      for (const marker of aircraftMarkersRef.current.values()) {
        aircraftRaycastTargets.push(marker);
      }
      const hits = raycasterRef.current.intersectObjects(raycastTargets, true);
      const hoveredMarker =
        hits.length > 0 ? getShipMarkerFromObject(hits[0].object) : null;
      const prevHovered = hoveredShipRef.current;
      const prevHoveredFerry = hoveredFerryRef.current;

      if (prevHovered && prevHovered !== hoveredMarker) {
        const prevData = getShipMarkerData(prevHovered);
        prevHovered.material.color.copy(prevData.baseColor);
      }
      if (hoveredMarker) {
        if (prevHoveredFerry) {
          const routeData = getFerryRouteData(prevHoveredFerry);
          setFerryLineColor(prevHoveredFerry, routeData.baseColor);
          hoveredFerryRef.current = null;
        }
        const hoveredData = getShipMarkerData(hoveredMarker);
        hoverColorRef.current
          .copy(hoveredData.baseColor)
          .offsetHSL(0, 0.12, 0.16);
        hoveredMarker.material.color.copy(hoverColorRef.current);
        mount.style.cursor = "pointer";
      } else {
        const aircraftHits = raycasterRef.current.intersectObjects(
          aircraftRaycastTargets,
          true,
        );
        const hoveredAircraft =
          aircraftHits.length > 0
            ? getAircraftMarkerFromObject(aircraftHits[0].object)
            : null;
        if (hoveredAircraft) {
          if (prevHoveredFerry) {
            const routeData = getFerryRouteData(prevHoveredFerry);
            setFerryLineColor(prevHoveredFerry, routeData.baseColor);
            hoveredFerryRef.current = null;
          }
          mount.style.cursor = "pointer";
          hoveredShipRef.current = hoveredMarker;
          return;
        }
        const ferryHits = raycasterRef.current.intersectObjects(
          ferryRouteTargets,
          true,
        );
        const hoveredFerry =
          ferryHits.length > 0
            ? getFerryRouteFromObject(ferryHits[0].object)
            : null;
        if (prevHoveredFerry && prevHoveredFerry !== hoveredFerry) {
          const routeData = getFerryRouteData(prevHoveredFerry);
          setFerryLineColor(prevHoveredFerry, routeData.baseColor);
        }
        if (hoveredFerry) {
          const routeData = getFerryRouteData(hoveredFerry);
          setFerryLineColor(hoveredFerry, routeData.hoverColor);
          mount.style.cursor = "pointer";
        } else {
          mount.style.cursor = "grab";
        }
        hoveredFerryRef.current = hoveredFerry;
      }
      hoveredShipRef.current = hoveredMarker;
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointerMoveEventRef.current = { x: event.clientX, y: event.clientY };
      if (pointerMoveRafRef.current != null) return;
      pointerMoveRafRef.current = requestAnimationFrame(processPointerMove);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current)
        return;
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!down) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6)
        return;

      const rect = sceneRef.current.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y =
        -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current);

      raycastTargets.length = 0;
      const aircraftRaycastTargets = aircraftRaycastTargetsRef.current;
      aircraftRaycastTargets.length = 0;
      for (const marker of shipMarkers.values()) raycastTargets.push(marker);
      for (const marker of aircraftMarkersRef.current.values()) {
        aircraftRaycastTargets.push(marker);
      }
      const hits = raycasterRef.current.intersectObjects(raycastTargets, true);
      const selectedShipMmsi = selectedShipRef.current?.ship.mmsi ?? null;
      let marker: ShipMesh | null = null;
      let selectedMarkerHit: ShipMesh | null = null;
      for (const hit of hits) {
        const candidate = getShipMarkerFromObject(hit.object);
        if (!candidate) continue;
        const candidateMmsi = getShipMarkerData(candidate).mmsi;
        if (selectedShipMmsi != null && candidateMmsi === selectedShipMmsi) {
          if (!selectedMarkerHit) selectedMarkerHit = candidate;
          continue;
        }
        marker = candidate;
        break;
      }
      if (!marker) marker = selectedMarkerHit;
      if (marker) {
        const markerData = getShipMarkerData(marker);
        const focusedShip = markerData.ship;
        if (selectedShipRef.current?.ship.mmsi === focusedShip.mmsi) {
          handleClose();
          return;
        }
        const zoomDist = THREE.MathUtils.clamp(
          markerData.radius * 3.8,
          Math.max(42, controls.minDistance + 8),
          Math.max(controls.minDistance + 8, controls.maxDistance * 0.42),
        );
        const azimuth = controls.getAzimuthalAngle();
        const sinP = Math.sin(INITIAL_POLAR_ANGLE);
        const cosP = Math.cos(INITIAL_POLAR_ANGLE);
        const nextCamera = new THREE.Vector3(
          marker.position.x + zoomDist * sinP * Math.sin(azimuth),
          marker.position.y + zoomDist * cosP,
          marker.position.z + zoomDist * sinP * Math.cos(azimuth),
        );
        cameraFocusRef.current = {
          startMs: performance.now(),
          durationMs: 900,
          fromCamera: camera.position.clone(),
          toCamera: nextCamera,
          fromTarget: controls.target.clone(),
          toTarget: marker.position.clone(),
        };
        handleShipClick(focusedShip, marker.position, marker);
        return;
      }

      const aircraftHits = raycasterRef.current.intersectObjects(
        aircraftRaycastTargets,
        true,
      );
      const aircraftMarker =
        aircraftHits.length > 0
          ? getAircraftMarkerFromObject(aircraftHits[0].object)
          : null;
      if (aircraftMarker) {
        const markerData = getAircraftMarkerData(aircraftMarker);
        const focusedAircraft = markerData.aircraft;
        if (selectedAircraftRef.current?.aircraft.hex === focusedAircraft.hex) {
          handleClose();
          return;
        }
        const zoomByClass = {
          light: 86,
          medium: 102,
          heavy: 118,
        } as const;
        const speedZoomBoost = THREE.MathUtils.clamp(
          markerData.aircraft.gs * 0.08,
          0,
          34,
        );
        const zoomDist = THREE.MathUtils.clamp(
          zoomByClass[markerData.sizeClass] + speedZoomBoost,
          Math.max(64, controls.minDistance + 14),
          Math.max(controls.minDistance + 14, controls.maxDistance * 0.62),
        );
        const azimuth = controls.getAzimuthalAngle();
        const sinP = Math.sin(INITIAL_POLAR_ANGLE);
        const cosP = Math.cos(INITIAL_POLAR_ANGLE);
        const nextCamera = new THREE.Vector3(
          aircraftMarker.position.x + zoomDist * sinP * Math.sin(azimuth),
          aircraftMarker.position.y + zoomDist * cosP,
          aircraftMarker.position.z + zoomDist * sinP * Math.cos(azimuth),
        );
        cameraFocusRef.current = {
          startMs: performance.now(),
          durationMs: 900,
          fromCamera: camera.position.clone(),
          toCamera: nextCamera,
          fromTarget: controls.target.clone(),
          toTarget: aircraftMarker.position.clone(),
        };
        handleAircraftClick(focusedAircraft, aircraftMarker.position, aircraftMarker);
        return;
      }

      const ferryHits = raycasterRef.current.intersectObjects(
        ferryRouteTargets,
        true,
      );
      if (ferryHits.length === 0) {
        handleClose();
        return;
      }
      const routeLine = getFerryRouteFromObject(ferryHits[0].object);
      if (!routeLine) {
        handleClose();
        return;
      }
      const routeData = getFerryRouteData(routeLine);
      handleFerryRouteClick(routeData.info, ferryHits[0].point.clone());
    };

    window.addEventListener("resize", handleResize);
    mount.addEventListener("pointerdown", handlePointerDown);
    mount.addEventListener("pointermove", handlePointerMove);
    mount.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);
    mount.style.cursor = "grab";

    // Animation loop
    let nextNightCheck = performance.now();
    let cachedNight = isNightTime();
    let appliedFerryNight = cachedNight;
    let appliedModelNight = cachedNight;
    let appliedShipVisualRevision = shipVisualAssetsRevisionRef.current;
    let appliedAircraftVisualRevision = aircraftVisualAssetsRevisionRef.current;
    let nextSkyUpdate = 0;
    let cachedSkySettings: ReturnType<typeof animateSky> | null = null;
    setFerryRouteNight(appliedFerryNight);
    applyNightLookToMarkers(shipMarkers, aircraftMarkersRef.current, cachedNight);
    const loopToken = frameLoopTokenRef.current + 1;
    frameLoopTokenRef.current = loopToken;

    const animate = (time: number) => {
      if (frameLoopTokenRef.current !== loopToken) return;
      if (
        !sceneInstanceRef.current ||
        !cameraRef.current ||
        !rendererRef.current
      )
        return;
      const t = time * 0.001;
      const env = environmentRef.current;

      if (time >= nextNightCheck) {
        cachedNight = isNightTime();
        nextNightCheck = time + 30_000;
      }

      const cameraDistance = camera.position.distanceTo(controls.target);
      animateWaterTiles(tiles, env, t, cachedNight);
      animateAtmosphere(
        sceneInstanceRef.current,
        env,
        windParticlesRef.current,
        hemiLightRef.current!,
        sunLightRef.current!,
        backgroundColorRef.current,
        cachedNight,
        cameraDistance,
      );
      // Only mutate scene.background when the color actually changed —
      // reassigning the setter every frame triggers internal Three.js state
      // invalidation that causes visible flicker with postprocessing.
      if (!lastBackgroundRef.current.equals(backgroundColorRef.current)) {
        (sceneInstanceRef.current.background as THREE.Color).copy(
          backgroundColorRef.current,
        );
        lastBackgroundRef.current.copy(backgroundColorRef.current);
      }
      disposeWindParticles(windParticlesRef.current);
      windParticlesRef.current = null;
      if (skyMeshRef.current) {
        // Throttle sky recomputation — sun angles only change once per minute,
        // weather only changes on fetch. Rewriting uniforms every frame causes
        // sub-pixel oscillation through the post-processing chain.
        const manualSky = skyAutoModeRef.current
          ? undefined
          : manualSkySettingsRef.current;
        if (time >= nextSkyUpdate || manualSky || !cachedSkySettings) {
          cachedSkySettings = animateSky(
            skyMeshRef.current,
            cachedNight,
            env,
            manualSky,
          );
          if (!manualSky) nextSkyUpdate = time + 30_000;
        }
        const appliedSky = cachedSkySettings;
        const targetExposure = lightingOverrideRef.current
          ? lightingValuesRef.current.exposure
          : appliedSky.exposure;
        const expDelta =
          targetExposure - rendererRef.current.toneMappingExposure;
        rendererRef.current.toneMappingExposure =
          Math.abs(expDelta) < 0.001
            ? targetExposure
            : rendererRef.current.toneMappingExposure + expDelta * 0.02;
      }

      // Apply lighting debug overrides after atmosphere has run
      if (lightingOverrideRef.current) {
        const lv = lightingValuesRef.current;
        hemiLightRef.current!.intensity = lv.hemiIntensity;
        hemiLightRef.current!.color.set(lv.hemiSkyColor);
        hemiLightRef.current!.groundColor.set(lv.hemiGroundColor);
        sunLightRef.current!.intensity = lv.sunIntensity;
        sunLightRef.current!.color.set(lv.sunColor);
        rendererRef.current.toneMapping = lv.toneMapping as THREE.ToneMapping;
        rendererRef.current.shadowMap.enabled = lv.shadowsEnabled;
        if (colorPassRef.current) {
          colorPassRef.current.uniforms.saturationBoost.value =
            lv.saturationBoost;
          colorPassRef.current.uniforms.warmthShift.value = lv.warmthShift;
        }
        if (edgePassRef.current) {
          edgePassRef.current.uniforms.edgeStrength.value = lv.edgeStrength;
          edgePassRef.current.uniforms.edgeThreshold.value = lv.edgeThreshold;
        }
        if (bloomPassRef.current) {
          // Lerp bloom parameters toward targets to prevent one-frame
          // "white-out" flashes from sudden value jumps — UnrealBloomPass
          // threshold changes are especially flicker-prone.
          // Snap to target when within epsilon to stop per-frame oscillation.
          const bloomLerp = 0.12;
          const bsDelta = lv.bloomStrength - bloomPassRef.current.strength;
          bloomPassRef.current.strength =
            Math.abs(bsDelta) < 0.001
              ? lv.bloomStrength
              : bloomPassRef.current.strength + bsDelta * bloomLerp;
          const brDelta = lv.bloomRadius - bloomPassRef.current.radius;
          bloomPassRef.current.radius =
            Math.abs(brDelta) < 0.001
              ? lv.bloomRadius
              : bloomPassRef.current.radius + brDelta * bloomLerp;
          const btDelta = lv.bloomThreshold - bloomPassRef.current.threshold;
          bloomPassRef.current.threshold =
            Math.abs(btDelta) < 0.001
              ? lv.bloomThreshold
              : bloomPassRef.current.threshold + btDelta * bloomLerp;
        }
      }
      if (cachedNight !== appliedFerryNight) {
        setFerryRouteNight(cachedNight);
        appliedFerryNight = cachedNight;
      }
      const latestShipVisualRevision = shipVisualAssetsRevisionRef.current;
      const latestAircraftVisualRevision = aircraftVisualAssetsRevisionRef.current;
      if (
        cachedNight !== appliedModelNight ||
        latestShipVisualRevision !== appliedShipVisualRevision ||
        latestAircraftVisualRevision !== appliedAircraftVisualRevision
      ) {
        applyNightLookToMarkers(
          shipMarkers,
          aircraftMarkersRef.current,
          cachedNight,
        );
        appliedModelNight = cachedNight;
        appliedShipVisualRevision = latestShipVisualRevision;
        appliedAircraftVisualRevision = latestAircraftVisualRevision;
      }
      const zoomProgress = THREE.MathUtils.clamp(
        (cameraDistance - controls.minDistance) /
          Math.max(1, controls.maxDistance - controls.minDistance),
        0,
        1,
      );
      // Base scale decreases naturally from close to mid-range
      const baseZoomScale = THREE.MathUtils.lerp(
        2.2,
        1.0,
        Math.pow(zoomProgress, 0.65),
      );
      // Far-distance boost kicks in past ~25% zoom-out, growing models for visibility
      const farBoost = Math.pow(Math.max(0, zoomProgress - 0.25), 2) * 3.5;
      const shipZoomScale = baseZoomScale + farBoost;
      animateShips(shipMarkers, t, shipZoomScale);
      animateAircraft(aircraftMarkersRef.current, t, shipZoomScale);
      const fastestShipIndicator = fastestShipIndicatorRef.current;
      if (fastestShipIndicator) {
        if (time >= nextFastestScanAtMsRef.current) {
          let fastestMmsi: number | null = null;
          let fastestSog = -Infinity;
          for (const marker of shipMarkers.values()) {
            if (!marker.visible) continue;
            const markerData = getShipMarkerData(marker);
            const reportedSog = sanitizeShipSpeedKnots(markerData.ship.sog);
            const observedSog = estimateObservedTelemetrySpeedKnots(markerData);
            if (observedSog < FASTEST_SHIP_MIN_OBSERVED_SPEED_KNOTS) continue;
            const candidateSog = Math.min(reportedSog, observedSog);
            if (!Number.isFinite(candidateSog) || candidateSog <= fastestSog) continue;
            fastestSog = candidateSog;
            fastestMmsi = markerData.mmsi;
          }
          fastestShipMmsiRef.current = fastestSog > 0.1 ? fastestMmsi : null;
          nextFastestScanAtMsRef.current = time + 60_000;
        }
        const fastestMmsi = fastestShipMmsiRef.current;
        const fastestMarker =
          fastestMmsi != null ? shipMarkers.get(fastestMmsi) ?? null : null;
        if (!fastestMarker || !fastestMarker.visible) {
          fastestShipIndicator.visible = false;
        } else {
          fastestShipIndicator.visible = true;
          fastestShipIndicator.position.copy(fastestMarker.position);
          fastestShipIndicator.position.y += 10.5;
          const pulse = 1 + Math.sin(t * 4.2) * 0.08;
          fastestShipIndicator.scale.setScalar(pulse);
          fastestShipIndicator.lookAt(
            camera.position.x,
            fastestShipIndicator.position.y,
            camera.position.z,
          );
        }
      }
      if (cameraFocusRef.current) {
        const focus = cameraFocusRef.current;
        const progress = THREE.MathUtils.clamp(
          (time - focus.startMs) / focus.durationMs,
          0,
          1,
        );
        const eased = progress * progress * (3 - 2 * progress);
        camera.position.lerpVectors(focus.fromCamera, focus.toCamera, eased);
        controls.target.lerpVectors(focus.fromTarget, focus.toTarget, eased);
        clampPan();
        if (progress >= 1) cameraFocusRef.current = null;
      }
      controls.update();
      const hasOpenTooltip =
        selectedShipRef.current != null ||
        selectedFerryRouteRef.current != null ||
        selectedAircraftRef.current != null;
      const tooltipCloseDistance = controls.maxDistance * 0.72;
      const tooltipOpenAgeMs = time - tooltipOpenedAtMsRef.current;
      const currentCameraDistance = camera.position.distanceTo(controls.target);
      let shouldCloseSelectedEntityOffscreen = false;
      const selectedMarker = selectedShipMarkerRef.current;
      if (selectedMarker && selectedShipRef.current && sceneRef.current) {
        const projected = selectedMarker.position.clone().project(camera);
        const offscreenMargin = 0.16;
        const offscreenX =
          projected.x < -1 - offscreenMargin ||
          projected.x > 1 + offscreenMargin;
        const offscreenY =
          projected.y < -1 - offscreenMargin ||
          projected.y > 1 + offscreenMargin;
        const behindCamera = projected.z > 1;
        shouldCloseSelectedEntityOffscreen =
          offscreenX || offscreenY || behindCamera;
      }
      const selectedAircraftMarker = selectedAircraftMarkerRef.current;
      if (
        !shouldCloseSelectedEntityOffscreen &&
        selectedAircraftMarker &&
        selectedAircraftRef.current &&
        sceneRef.current
      ) {
        const projected = selectedAircraftMarker.position.clone().project(camera);
        const offscreenMargin = 0.16;
        const offscreenX =
          projected.x < -1 - offscreenMargin ||
          projected.x > 1 + offscreenMargin;
        const offscreenY =
          projected.y < -1 - offscreenMargin ||
          projected.y > 1 + offscreenMargin;
        const behindCamera = projected.z > 1;
        shouldCloseSelectedEntityOffscreen =
          offscreenX || offscreenY || behindCamera;
      }
      if (
        hasOpenTooltip &&
        cameraFocusRef.current == null &&
        tooltipOpenAgeMs > 450 &&
        (currentCameraDistance >= tooltipCloseDistance ||
          shouldCloseSelectedEntityOffscreen)
      ) {
        handleClose();
      }
      if (selectedMarker && selectedShipRef.current && sceneRef.current) {
        const projected = selectedMarker.position.clone().project(camera);
        const nextX = (projected.x + 1) * 0.5 * sceneRef.current.clientWidth;
        const nextY = (-projected.y + 1) * 0.5 * sceneRef.current.clientHeight;
        setSelectedShip((prev) => {
          if (!prev) return prev;
          if (
            Math.abs(prev.x - nextX) < 0.5 &&
            Math.abs(prev.y - nextY) < 0.5 &&
            prev.sceneWidth === sceneRef.current!.clientWidth &&
            prev.sceneHeight === sceneRef.current!.clientHeight
          ) {
            return prev;
          }
          return {
            ...prev,
            x: nextX,
            y: nextY,
            sceneWidth: sceneRef.current!.clientWidth,
            sceneHeight: sceneRef.current!.clientHeight,
          };
        });
      }
      if (selectedAircraftMarker && selectedAircraftRef.current && sceneRef.current) {
        const projected = selectedAircraftMarker.position.clone().project(camera);
        const nextX = (projected.x + 1) * 0.5 * sceneRef.current.clientWidth;
        const nextY = (-projected.y + 1) * 0.5 * sceneRef.current.clientHeight;
        setSelectedAircraft((prev) => {
          if (!prev) return prev;
          if (
            Math.abs(prev.x - nextX) < 0.5 &&
            Math.abs(prev.y - nextY) < 0.5 &&
            prev.sceneWidth === sceneRef.current!.clientWidth &&
            prev.sceneHeight === sceneRef.current!.clientHeight
          ) {
            return prev;
          }
          return {
            ...prev,
            x: nextX,
            y: nextY,
            sceneWidth: sceneRef.current!.clientWidth,
            sceneHeight: sceneRef.current!.clientHeight,
          };
        });
      }

      if (sceneRef.current && cameraRef.current) {
        const labelOcclusionTargets: THREE.Mesh[] = [];
        for (const marker of aircraftMarkersRef.current.values()) {
          if (!marker.visible) continue;
          marker.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            if (!child.visible) return;
            labelOcclusionTargets.push(child);
          });
        }
        projectLabels(
          cameraRef.current,
          sceneRef.current,
          labelElementsRef.current,
          labelSizes,
          labelOcclusionTargets,
        );
      }

      if (composerRef.current) {
        composerRef.current.render();
        // The bloom pass's final blend material leaves the GPU with
        // depthMask=false, depthTest=false, blending=Additive.
        // renderer.state.reset() only clears Three.js's internal *cache*
        // to defaults — it does NOT issue GL calls to actually restore
        // the GPU state. So on the next frame, when RenderPass calls
        // renderer.clear(), Three.js sees its cache says depthMask=true
        // (the default) and skips the gl.depthMask(true) call. But the
        // GPU still has depthMask=false → depth buffer never clears →
        // stale depth values leak between frames → flicker on camera move.
        //
        // Fix: explicitly set the GPU back to sane defaults, THEN reset
        // the cache so it matches reality.
        const gl = rendererRef.current.getContext();
        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        rendererRef.current.state.reset();
      } else {
        rendererRef.current.clear();
        rendererRef.current.render(sceneInstanceRef.current, cameraRef.current);
      }
      if (frameLoopTokenRef.current === loopToken) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };
    animationRef.current = requestAnimationFrame(animate);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      mount.removeEventListener("pointerdown", handlePointerDown);
      mount.removeEventListener("pointermove", handlePointerMove);
      mount.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      if (pointerMoveRafRef.current != null) {
        cancelAnimationFrame(pointerMoveRafRef.current);
        pointerMoveRafRef.current = null;
      }
      pointerMoveEventRef.current = null;
      pointerDownRef.current = null;
      frameLoopTokenRef.current += 1;
      if (animationRef.current != null)
        cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      mount.style.cursor = "";
      const hovered = hoveredShipRef.current;
      if (hovered) {
        hovered.material.color.copy(getShipMarkerData(hovered).baseColor);
        hoveredShipRef.current = null;
      }
      const hoveredRoute = hoveredFerryRef.current;
      if (hoveredRoute) {
        const routeData = getFerryRouteData(hoveredRoute);
        setFerryLineColor(hoveredRoute, routeData.baseColor);
        hoveredFerryRef.current = null;
      }
      controls.dispose();
      controlsRef.current = null;
      if (skyMeshRef.current) {
        disposeSkyBackdrop(scene, skyMeshRef.current);
        skyMeshRef.current = null;
      }
      if (fastestShipIndicatorRef.current) {
        scene.remove(fastestShipIndicatorRef.current);
        disposeObject3D(fastestShipIndicatorRef.current);
        fastestShipIndicatorRef.current = null;
      }
      fastestShipMmsiRef.current = null;
      nextFastestScanAtMsRef.current = 0;
      if (composerRef.current) {
        composerRef.current.renderTarget1.dispose();
        composerRef.current.renderTarget2.dispose();
        composerRef.current = null;
      }
      edgePassRef.current = null;
      colorPassRef.current = null;
      bloomPassRef.current = null;
      renderer.dispose();
      if (mount.contains(renderer.domElement))
        mount.removeChild(renderer.domElement);
      rendererRef.current = null;
      cameraRef.current = null;
      sceneInstanceRef.current = null;
      shipMarkers.clear();
      for (const marker of aircraftMarkersRef.current.values()) {
        scene.remove(marker);
        marker.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (
              (child.userData as { sharedAircraftModelAsset?: boolean })
                .sharedAircraftModelAsset === true
            )
              return;
            child.geometry.dispose();
            if (child.material instanceof THREE.Material)
              child.material.dispose();
          }
        });
      }
      aircraftMarkersRef.current.clear();
      raycastTargets.length = 0;
      aircraftRaycastTargetsRef.current.length = 0;
      ferryRouteTargets.length = 0;
      labelSizes.clear();
      disposeFerryRoutes(scene);
      disposeWaterTiles(scene, tiles);
      for (const object of coastlineObjects) {
        scene.remove(object);
        if (object instanceof THREE.Line) object.geometry.dispose();
      }
      coastlineObjects.length = 0;
      for (const object of debugObjects) {
        scene.remove(object);
        disposeObject3D(object);
      }
      abortController.abort();
      landPolygonRings.length = 0;
    };
  }, [handleClose, handleShipClick, handleFerryRouteClick, announceSceneReady]);

  /* ── Ship Reconciliation ───────────────────────────────────────────── */

  useEffect(() => {
    const scene = sceneInstanceRef.current;
    if (!scene) return;
    reconcileShips(
      scene,
      ships,
      shipMarkersRef.current,
      hoveredShipRef,
      shipCategoryTexturesRef.current ?? undefined,
      passengerFerryPrototypeRef.current ?? undefined,
      containerShipPrototypeRef.current ?? undefined,
      smallBoatPrototypeRef.current ?? undefined,
    );
  }, [ships, shipVisualAssetsRevision]);

  /* ── Aircraft Reconciliation ─────────────────────────────────────────── */

  useEffect(() => {
    const scene = sceneInstanceRef.current;
    if (!scene) return;
    reconcileAircraft(
      scene,
      aircraft,
      aircraftMarkersRef.current,
      airplanePrototypesRef.current ?? undefined,
    );
  }, [aircraft, aircraftVisualAssetsRevision]);

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <div ref={sceneRef} className="harbor-scene">
      {environment.activeAlerts > 0 ? (
        <div className="harbor-alert-glow" />
      ) : null}
      <div className="harbor-label-layer" aria-hidden="true">
        {HARBOR_LABELS.map((label) => (
          <div
            key={label.id}
            ref={(el) => {
              if (el) labelElementsRef.current.set(label.id, el);
              else labelElementsRef.current.delete(label.id);
            }}
            className={`harbor-label harbor-label-${label.kind}${label.style ? ` harbor-label-${label.style}` : ""}`}
          >
            {label.text}
          </div>
        ))}
      </div>
      <div className="harbor-scene-overlay">
        Drag to pan, scroll to zoom, hover to inspect vessels and ferry routes.
      </div>
      {SHOW_SCENE_DEBUG_PANELS && (
        <>
          <div
            className="sky-controls"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="sky-controls-toggle"
              onClick={() => setSkyPanelOpen((open) => !open)}
            >
              {skyPanelOpen ? "Hide Sky Controls" : "Sky Controls"}
            </button>
            {skyPanelOpen && (
              <div className="sky-controls-panel">
                <div className="sky-controls-row">
                  <label className="sky-controls-check">
                    <input
                      type="checkbox"
                      checked={skyAutoMode}
                      onChange={(event) => setSkyAutoMode(event.target.checked)}
                    />
                    Auto (weather + time)
                  </label>
                  <button
                    type="button"
                    className="sky-controls-reset"
                    onClick={handleResetSkySettings}
                  >
                    Reset
                  </button>
                </div>
                {SKY_SLIDERS.map((slider) => {
                  const value = manualSkySettings[slider.key];
                  return (
                    <label key={slider.key} className="sky-control-row">
                      <span>{slider.label}</span>
                      <input
                        type="range"
                        min={slider.min}
                        max={slider.max}
                        step={slider.step}
                        value={value}
                        disabled={skyAutoMode}
                        onChange={(event) =>
                          handleSkySettingChange(
                            slider.key,
                            Number(event.target.value),
                          )
                        }
                      />
                      <output>{value.toFixed(slider.digits)}</output>
                    </label>
                  );
                })}
                {skyAutoMode ? (
                  <p className="sky-controls-note">
                    Auto mode uses live weather and time-of-day values. Disable
                    to tune manually.
                  </p>
                ) : null}
              </div>
            )}
          </div>
          <div
            className="lighting-controls"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="sky-controls-toggle"
              onClick={() => setLightingPanelOpen((open) => !open)}
            >
              {lightingPanelOpen ? "Hide Lighting" : "Lighting Debug"}
            </button>
            {lightingPanelOpen && (
              <div className="lighting-controls-panel">
                <div className="sky-controls-row">
                  <label className="sky-controls-check">
                    <input
                      type="checkbox"
                      checked={lightingOverride}
                      onChange={(e) => setLightingOverride(e.target.checked)}
                    />
                    Override
                  </label>
                  <button
                    type="button"
                    className="sky-controls-reset"
                    onClick={handlePrintLighting}
                  >
                    Print to Console
                  </button>
                </div>

                {(
                  [
                    {
                      key: "hemiIntensity",
                      label: "Hemi Int",
                      min: 0,
                      max: 3,
                      step: 0.01,
                      digits: 2,
                    },
                    {
                      key: "sunIntensity",
                      label: "Sun Int",
                      min: 0,
                      max: 3,
                      step: 0.01,
                      digits: 2,
                    },
                    {
                      key: "exposure",
                      label: "Exposure",
                      min: 0,
                      max: 3,
                      step: 0.01,
                      digits: 2,
                    },
                    {
                      key: "saturationBoost",
                      label: "Saturation",
                      min: 0,
                      max: 3,
                      step: 0.01,
                      digits: 2,
                    },
                    {
                      key: "warmthShift",
                      label: "Warmth",
                      min: -0.1,
                      max: 0.2,
                      step: 0.001,
                      digits: 3,
                    },
                    {
                      key: "edgeStrength",
                      label: "Edge Str",
                      min: 0,
                      max: 3,
                      step: 0.01,
                      digits: 2,
                    },
                    {
                      key: "edgeThreshold",
                      label: "Edge Thr",
                      min: 0,
                      max: 0.5,
                      step: 0.005,
                      digits: 3,
                    },
                    {
                      key: "bloomStrength",
                      label: "Bloom Str",
                      min: 0,
                      max: 2,
                      step: 0.01,
                      digits: 2,
                    },
                    {
                      key: "bloomRadius",
                      label: "Bloom Rad",
                      min: 0,
                      max: 2,
                      step: 0.01,
                      digits: 2,
                    },
                    {
                      key: "bloomThreshold",
                      label: "Bloom Thr",
                      min: 0,
                      max: 2,
                      step: 0.01,
                      digits: 2,
                    },
                  ] as const
                ).map((s) => (
                  <label key={s.key} className="sky-control-row">
                    <span>{s.label}</span>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={lightingValues[s.key]}
                      disabled={!lightingOverride}
                      onChange={(e) =>
                        handleLightingChange(s.key, Number(e.target.value))
                      }
                    />
                    <output>
                      {(lightingValues[s.key] as number).toFixed(s.digits)}
                    </output>
                  </label>
                ))}

                {(
                  [
                    { key: "hemiSkyColor", label: "Hemi Sky" },
                    { key: "hemiGroundColor", label: "Hemi Gnd" },
                    { key: "sunColor", label: "Sun Color" },
                  ] as const
                ).map((c) => (
                  <label key={c.key} className="lighting-color-row">
                    <span>{c.label}</span>
                    <input
                      type="color"
                      value={lightingValues[c.key]}
                      disabled={!lightingOverride}
                      onChange={(e) =>
                        handleLightingChange(c.key, e.target.value)
                      }
                    />
                  </label>
                ))}

                <label className="lighting-select-row">
                  <span>Tone Map</span>
                  <select
                    value={lightingValues.toneMapping}
                    disabled={!lightingOverride}
                    onChange={(e) =>
                      handleLightingChange("toneMapping", Number(e.target.value))
                    }
                  >
                    <option value={THREE.NoToneMapping}>None</option>
                    <option value={THREE.LinearToneMapping}>Linear</option>
                    <option value={THREE.ReinhardToneMapping}>Reinhard</option>
                    <option value={THREE.ACESFilmicToneMapping}>ACES Filmic</option>
                  </select>
                </label>

                <label className="sky-controls-check" style={{ marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={lightingValues.shadowsEnabled}
                    disabled={!lightingOverride}
                    onChange={(e) =>
                      handleLightingChange("shadowsEnabled", e.target.checked)
                    }
                  />
                  Shadows
                </label>
              </div>
            )}
          </div>
        </>
      )}
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
      {selectedFerryRoute && (
        <FerryRouteInfoCard
          route={selectedFerryRoute.route}
          x={selectedFerryRoute.x}
          y={selectedFerryRoute.y}
          sceneWidth={selectedFerryRoute.sceneWidth}
          sceneHeight={selectedFerryRoute.sceneHeight}
          onClose={handleClose}
        />
      )}
      {selectedAircraft && (
        <AircraftInfoCard
          aircraft={selectedAircraft.aircraft}
          x={selectedAircraft.x}
          y={selectedAircraft.y}
          sceneWidth={selectedAircraft.sceneWidth}
          sceneHeight={selectedAircraft.sceneHeight}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
