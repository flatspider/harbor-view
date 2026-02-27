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
import { GhibliEdgeShader } from "../scene/ghibliEdgeShader";
import { GhibliColorShader } from "../scene/ghibliColorShader";

// Scene layer modules
import {
  WORLD_WIDTH,
  WORLD_DEPTH,
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
import { createWaterTiles, animateWaterTiles, disposeWaterTiles } from "../scene/ocean";
import { reconcileShips, animateShips } from "../scene/ships";
import { reconcileAircraft, animateAircraft, type AircraftMarker } from "../scene/airplanes";
import { createWindParticles, animateAtmosphere, disposeWindParticles } from "../scene/atmosphere";
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
import { loadShipCategoryTextures, type ShipCategoryTextureMap } from "../scene/shipTextures";
import { loadAirplanePrototype } from "../scene/airplaneModel";
import { loadContainerShipPrototype } from "../scene/containerShipModel";
import { loadPassengerFerryPrototype } from "../scene/passengerFerryModel";

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
  { key: "turbidity", label: "Turbidity", min: 0, max: 20, step: 0.1, digits: 1 },
  { key: "rayleigh", label: "Rayleigh", min: 0, max: 4, step: 0.01, digits: 2 },
  { key: "mieCoefficient", label: "Mie Coef", min: 0, max: 0.1, step: 0.0001, digits: 4 },
  { key: "mieDirectionalG", label: "Mie Dir G", min: 0, max: 1, step: 0.001, digits: 3 },
  { key: "elevation", label: "Elevation", min: -15, max: 90, step: 0.1, digits: 1 },
  { key: "azimuth", label: "Azimuth", min: 0, max: 360, step: 0.1, digits: 1 },
  { key: "exposure", label: "Exposure", min: 0, max: 2, step: 0.01, digits: 2 },
];

function createCompassLabelSprite(text: string, fontPx = 26): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.Sprite(new THREE.SpriteMaterial({ color: "#ffffff" }));
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
    ringPoints.push(new THREE.Vector3(-Math.sin(a) * radius, 0, Math.cos(a) * radius));
  }
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(ringPoints),
    new THREE.LineBasicMaterial({ color: "#6ba7c6", transparent: true, opacity: 0.85 }),
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
      -Math.sin(rad) * inner, 0, Math.cos(rad) * inner,
      -Math.sin(rad) * outer, 0, Math.cos(rad) * outer,
    );
  }
  const ticks = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(tickPositions, 3)),
    new THREE.LineBasicMaterial({ color: "#8ac0db", transparent: true, opacity: 0.9 }),
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
    const sprite = createCompassLabelSprite(label.text, label.deg % 90 === 0 ? 30 : 24);
    const rad = (label.deg * Math.PI) / 180;
    const labelRadius = radius + (label.deg % 90 === 0 ? 22 : 16);
    sprite.position.set(-Math.sin(rad) * labelRadius, 0.5, Math.cos(rad) * labelRadius);
    sprite.scale.set(label.deg % 90 === 0 ? 28 : 16, label.deg % 90 === 0 ? 9 : 6, 1);
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
    if (child instanceof THREE.Line || child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        for (const material of child.material) material.dispose();
      } else if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
  });
}

export function HarborScene({ ships, aircraft, environment, onSceneReady }: HarborSceneProps) {
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
  const windParticlesRef = useRef<THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null>(null);
  const coastlineObjectsRef = useRef<THREE.Object3D[]>([]);
  const raycastTargetsRef = useRef<ShipMesh[]>([]);
  const labelSizesRef = useRef(new Map<string, { width: number; height: number }>());
  const labelElementsRef = useRef(new Map<string, HTMLDivElement>());
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const backgroundColorRef = useRef(new THREE.Color());
  const skyMeshRef = useRef<THREE.Mesh | null>(null);
  const environmentRef = useRef(environment);
  const shipCategoryTexturesRef = useRef<ShipCategoryTextureMap | null>(null);
  const passengerFerryPrototypeRef = useRef<THREE.Object3D | null>(null);
  const containerShipPrototypeRef = useRef<THREE.Object3D | null>(null);
  const airplanePrototypeRef = useRef<THREE.Object3D | null>(null);
  const sceneReadyEmittedRef = useRef(false);
  const [shipVisualAssetsRevision, setShipVisualAssetsRevision] = useState(0);
  const [aircraftVisualAssetsRevision, setAircraftVisualAssetsRevision] = useState(0);
  const [skyAutoMode, setSkyAutoMode] = useState(true);
  const [skyPanelOpen, setSkyPanelOpen] = useState(false);
  const [manualSkySettings, setManualSkySettings] = useState<SkySettings>(() => getDefaultSkySettings());
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
  const [lightingValues, setLightingValues] = useState(() => ({ ...lightingValuesRef.current }));

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
  const showDebugGrid =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("grid");

  const handleShipClick = useCallback(
    (ship: ShipData, worldPos: THREE.Vector3) => {
      const sceneRect = sceneRef.current?.getBoundingClientRect();
      const camera = cameraRef.current;
      if (!sceneRect || !camera) return;
      const projected = worldPos.clone().project(camera);
      const x = ((projected.x + 1) * 0.5) * sceneRect.width;
      const y = ((-projected.y + 1) * 0.5) * sceneRect.height;
      setSelectedFerryRoute(null);
      setSelectedShip({ ship, x, y, sceneWidth: sceneRect.width, sceneHeight: sceneRect.height });
    },
    [],
  );

  const handleFerryRouteClick = useCallback(
    (route: FerryRouteInfo, worldPos: THREE.Vector3) => {
      const sceneRect = sceneRef.current?.getBoundingClientRect();
      const camera = cameraRef.current;
      if (!sceneRect || !camera) return;
      const projected = worldPos.clone().project(camera);
      const x = ((projected.x + 1) * 0.5) * sceneRect.width;
      const y = ((-projected.y + 1) * 0.5) * sceneRect.height;
      setSelectedShip(null);
      setSelectedFerryRoute({ route, x, y, sceneWidth: sceneRect.width, sceneHeight: sceneRect.height });
    },
    [],
  );

  const handleClose = useCallback(() => {
    setSelectedShip(null);
    setSelectedFerryRoute(null);
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

  const handleLightingChange = useCallback((key: string, value: number | string | boolean) => {
    setLightingValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handlePrintLighting = useCallback(() => {
    console.log("[Harbor Watch] Lighting Debug Values:", JSON.stringify(lightingValuesRef.current, null, 2));
  }, []);

  const handleSkySettingChange = useCallback((key: SkySettingKey, value: number) => {
    setManualSkySettings((prev) => ({ ...prev, [key]: value }));
  }, []);

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
      const grid = new THREE.GridHelper(gridSize, divisions, "#31556c", "#27404f");
      grid.position.y = SHIP_BASE_Y - 0.2;
      scene.add(grid);
      debugObjects.push(grid);
      const axes = new THREE.AxesHelper(120);
      axes.position.set(0, SHIP_BASE_Y + 0.1, 0);
      scene.add(axes);
      debugObjects.push(axes);
      const compass = createCompassDebugGroup();
      compass.position.set(WORLD_WIDTH * 0.38, SHIP_BASE_Y + 0.12, -WORLD_DEPTH * 0.38);
      scene.add(compass);
      debugObjects.push(compass);
    }

    // Camera
    const camera = new THREE.PerspectiveCamera(40, mount.clientWidth / mount.clientHeight, 0.5, 5000);
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
    renderer.autoClear = true;
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
    bloomPass.enabled = false; // DIAG: disable bloom to test flicker
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
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.target.set(0, 0, 0);
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
                console.error("[harbor] Failed to load ship category textures", error);
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
                console.error("[harbor] Failed to load passenger ferry model", error);
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
                console.error("[harbor] Failed to load container ship model", error);
              }),
          );
        }

        if (!airplanePrototypeRef.current) {
          visualLoadTasks.push(
            loadAirplanePrototype()
              .then((prototype) => {
                if (abortController.signal.aborted) return;
                airplanePrototypeRef.current = prototype;
                aircraftAssetsUpdated = true;
              })
              .catch((error) => {
                console.error("[harbor] Failed to load airplane model", error);
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
      if (!rendererRef.current || !cameraRef.current || !sceneRef.current) return;
      const width = sceneRef.current.clientWidth;
      const height = sceneRef.current.clientHeight;
      console.warn(`[diag-resize] w=${width} h=${height}`, new Error().stack?.split("\n")[2]?.trim());
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
        edgePassRef.current.uniforms.resolution.value.set(width * pixelRatio, height * pixelRatio);
      }
    };
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(mount);
    requestAnimationFrame(() => handleResize());

    // Pointer events
    const handlePointerDown = (event: PointerEvent) => {
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
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
      pointerRef.current.x = ((pointerEvent.x - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((pointerEvent.y - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current);

      raycastTargets.length = 0;
      for (const marker of shipMarkers.values()) raycastTargets.push(marker);
      const hits = raycasterRef.current.intersectObjects(raycastTargets, true);
      const hoveredMarker = hits.length > 0 ? getShipMarkerFromObject(hits[0].object) : null;
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
        hoverColorRef.current.copy(hoveredData.baseColor).offsetHSL(0, 0.12, 0.16);
        hoveredMarker.material.color.copy(hoverColorRef.current);
        mount.style.cursor = "pointer";
      } else {
        const ferryHits = raycasterRef.current.intersectObjects(ferryRouteTargets, true);
        const hoveredFerry = ferryHits.length > 0 ? getFerryRouteFromObject(ferryHits[0].object) : null;
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
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;
      const down = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!down) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;

      const rect = sceneRef.current.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current);

      raycastTargets.length = 0;
      for (const marker of shipMarkers.values()) raycastTargets.push(marker);
      const hits = raycasterRef.current.intersectObjects(raycastTargets, true);
      const marker = hits.length > 0 ? getShipMarkerFromObject(hits[0].object) : null;
      if (marker) {
        const focusedShip = getShipMarkerData(marker).ship;
        controls.target.copy(marker.position);
        camera.position.lerp(marker.position.clone().add(new THREE.Vector3(0, 18, -22)), 0.9);
        controls.update();
        handleShipClick(focusedShip, marker.position);
        return;
      }

      const ferryHits = raycasterRef.current.intersectObjects(ferryRouteTargets, true);
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
    mount.style.cursor = "grab";

    // Animation loop
    let nextNightCheck = performance.now();
    let cachedNight = isNightTime();
    let appliedFerryNight = cachedNight;
    setFerryRouteNight(appliedFerryNight);
    const loopToken = frameLoopTokenRef.current + 1;
    frameLoopTokenRef.current = loopToken;

    let _diagFrameCount = 0;
    let _diagPrevDist = 0;
    const animate = (time: number) => {
      if (frameLoopTokenRef.current !== loopToken) return;
      if (!sceneInstanceRef.current || !cameraRef.current || !rendererRef.current) return;
      const t = time * 0.001;
      const env = environmentRef.current;
      _diagFrameCount++;

      const _diagDist = cameraRef.current.position.distanceTo(controls.target);
      const _diagJumped = Math.abs(_diagDist - _diagPrevDist) > 50;
      // Log every frame when close (after ship click) or on big camera jumps, else every 120 frames
      if (_diagDist < 100 || _diagJumped || _diagFrameCount % 120 === 0) {
        const cam = cameraRef.current;
        const childCount = sceneInstanceRef.current.children.length;
        const visibleChildren = sceneInstanceRef.current.children.filter((c) => c.visible).length;
        const waterVisible = tiles.filter((wt) => wt.mesh.visible).length;
        const skyVis = skyMeshRef.current?.visible ?? "none";
        console.log(
          `[diag] f=${_diagFrameCount} cam=(${cam.position.x.toFixed(1)},${cam.position.y.toFixed(1)},${cam.position.z.toFixed(1)}) ` +
          `tgt=(${controls.target.x.toFixed(1)},${controls.target.y.toFixed(1)},${controls.target.z.toFixed(1)}) ` +
          `d=${_diagDist.toFixed(1)} vis=${visibleChildren}/${childCount} water=${waterVisible}/${tiles.length} sky=${skyVis} ` +
          `exp=${rendererRef.current.toneMappingExposure.toFixed(3)} auto=${skyAutoModeRef.current}` +
          (_diagJumped ? ` JUMP(${_diagPrevDist.toFixed(0)}->${_diagDist.toFixed(0)})` : ""),
        );
      }
      _diagPrevDist = _diagDist;

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
      sceneInstanceRef.current.background = backgroundColorRef.current;
      if (skyMeshRef.current) {
        const appliedSky = animateSky(
          skyMeshRef.current,
          cachedNight,
          env,
          skyAutoModeRef.current ? undefined : manualSkySettingsRef.current,
        );
        const targetExposure = lightingOverrideRef.current
          ? lightingValuesRef.current.exposure
          : appliedSky.exposure;
        rendererRef.current.toneMappingExposure = THREE.MathUtils.lerp(
          rendererRef.current.toneMappingExposure,
          targetExposure,
          0.02,
        );
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
          colorPassRef.current.uniforms.saturationBoost.value = lv.saturationBoost;
          colorPassRef.current.uniforms.warmthShift.value = lv.warmthShift;
        }
        if (edgePassRef.current) {
          edgePassRef.current.uniforms.edgeStrength.value = lv.edgeStrength;
          edgePassRef.current.uniforms.edgeThreshold.value = lv.edgeThreshold;
        }
        if (bloomPassRef.current) {
          bloomPassRef.current.strength = lv.bloomStrength;
          bloomPassRef.current.radius = lv.bloomRadius;
          bloomPassRef.current.threshold = lv.bloomThreshold;
        }
      }
      if (cachedNight !== appliedFerryNight) {
        setFerryRouteNight(cachedNight);
        appliedFerryNight = cachedNight;
      }
      const zoomProgress = THREE.MathUtils.clamp(
        (cameraDistance - controls.minDistance) / Math.max(1, controls.maxDistance - controls.minDistance),
        0,
        1,
      );
      const shipZoomScale = THREE.MathUtils.lerp(2.2, 0.95, Math.pow(zoomProgress, 0.65));
      animateShips(shipMarkers, t, shipZoomScale);
      animateAircraft(aircraftMarkersRef.current, t, shipZoomScale);
      controls.update();

      if (sceneRef.current && cameraRef.current) {
        projectLabels(cameraRef.current, sceneRef.current, labelElementsRef.current, labelSizes);
      }

      if (composerRef.current) {
        composerRef.current.render();
      } else {
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
      if (pointerMoveRafRef.current != null) {
        cancelAnimationFrame(pointerMoveRafRef.current);
        pointerMoveRafRef.current = null;
      }
      pointerMoveEventRef.current = null;
      pointerDownRef.current = null;
      frameLoopTokenRef.current += 1;
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
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
      disposeWindParticles(windParticlesRef.current);
      windParticlesRef.current = null;
      if (skyMeshRef.current) {
        disposeSkyBackdrop(scene, skyMeshRef.current);
        skyMeshRef.current = null;
      }
      if (composerRef.current) {
        composerRef.current.renderTarget1.dispose();
        composerRef.current.renderTarget2.dispose();
        composerRef.current = null;
      }
      edgePassRef.current = null;
      colorPassRef.current = null;
      bloomPassRef.current = null;
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      rendererRef.current = null;
      cameraRef.current = null;
      sceneInstanceRef.current = null;
      shipMarkers.clear();
      for (const marker of aircraftMarkersRef.current.values()) {
        scene.remove(marker);
        marker.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if ((child.userData as { sharedAircraftModelAsset?: boolean }).sharedAircraftModelAsset === true) return;
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
          }
        });
      }
      aircraftMarkersRef.current.clear();
      raycastTargets.length = 0;
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
    );
  }, [ships, shipVisualAssetsRevision]);

  /* ── Aircraft Reconciliation ─────────────────────────────────────────── */

  useEffect(() => {
    const scene = sceneInstanceRef.current;
    if (!scene) return;
    reconcileAircraft(scene, aircraft, aircraftMarkersRef.current, airplanePrototypeRef.current ?? undefined);
  }, [aircraft, aircraftVisualAssetsRevision]);

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <div ref={sceneRef} className="harbor-scene">
      {environment.activeAlerts > 0 ? <div className="harbor-alert-glow" /> : null}
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
      <div
        className="sky-controls"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="sky-controls-toggle" onClick={() => setSkyPanelOpen((open) => !open)}>
          {skyPanelOpen ? "Hide Sky Controls" : "Sky Controls"}
        </button>
        {skyPanelOpen && (
          <div className="sky-controls-panel">
            <div className="sky-controls-row">
              <label className="sky-controls-check">
                <input type="checkbox" checked={skyAutoMode} onChange={(event) => setSkyAutoMode(event.target.checked)} />
                Auto (weather + time)
              </label>
              <button type="button" className="sky-controls-reset" onClick={handleResetSkySettings}>
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
                    onChange={(event) => handleSkySettingChange(slider.key, Number(event.target.value))}
                  />
                  <output>{value.toFixed(slider.digits)}</output>
                </label>
              );
            })}
            {skyAutoMode ? (
              <p className="sky-controls-note">Auto mode uses live weather and time-of-day values. Disable to tune manually.</p>
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
        <button type="button" className="sky-controls-toggle" onClick={() => setLightingPanelOpen((open) => !open)}>
          {lightingPanelOpen ? "Hide Lighting" : "Lighting Debug"}
        </button>
        {lightingPanelOpen && (
          <div className="lighting-controls-panel">
            <div className="sky-controls-row">
              <label className="sky-controls-check">
                <input type="checkbox" checked={lightingOverride} onChange={(e) => setLightingOverride(e.target.checked)} />
                Override
              </label>
              <button type="button" className="sky-controls-reset" onClick={handlePrintLighting}>
                Print to Console
              </button>
            </div>

            {/* Sliders */}
            {([
              { key: "hemiIntensity", label: "Hemi Int", min: 0, max: 3, step: 0.01, digits: 2 },
              { key: "sunIntensity", label: "Sun Int", min: 0, max: 3, step: 0.01, digits: 2 },
              { key: "exposure", label: "Exposure", min: 0, max: 3, step: 0.01, digits: 2 },
              { key: "saturationBoost", label: "Saturation", min: 0, max: 3, step: 0.01, digits: 2 },
              { key: "warmthShift", label: "Warmth", min: -0.1, max: 0.2, step: 0.001, digits: 3 },
              { key: "edgeStrength", label: "Edge Str", min: 0, max: 3, step: 0.01, digits: 2 },
              { key: "edgeThreshold", label: "Edge Thr", min: 0, max: 0.5, step: 0.005, digits: 3 },
              { key: "bloomStrength", label: "Bloom Str", min: 0, max: 2, step: 0.01, digits: 2 },
              { key: "bloomRadius", label: "Bloom Rad", min: 0, max: 2, step: 0.01, digits: 2 },
              { key: "bloomThreshold", label: "Bloom Thr", min: 0, max: 2, step: 0.01, digits: 2 },
            ] as const).map((s) => (
              <label key={s.key} className="sky-control-row">
                <span>{s.label}</span>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={lightingValues[s.key]}
                  disabled={!lightingOverride}
                  onChange={(e) => handleLightingChange(s.key, Number(e.target.value))}
                />
                <output>{(lightingValues[s.key] as number).toFixed(s.digits)}</output>
              </label>
            ))}

            {/* Color pickers */}
            {([
              { key: "hemiSkyColor", label: "Hemi Sky" },
              { key: "hemiGroundColor", label: "Hemi Gnd" },
              { key: "sunColor", label: "Sun Color" },
            ] as const).map((c) => (
              <label key={c.key} className="lighting-color-row">
                <span>{c.label}</span>
                <input
                  type="color"
                  value={lightingValues[c.key]}
                  disabled={!lightingOverride}
                  onChange={(e) => handleLightingChange(c.key, e.target.value)}
                />
              </label>
            ))}

            {/* Tone mapping dropdown */}
            <label className="lighting-select-row">
              <span>Tone Map</span>
              <select
                value={lightingValues.toneMapping}
                disabled={!lightingOverride}
                onChange={(e) => handleLightingChange("toneMapping", Number(e.target.value))}
              >
                <option value={THREE.NoToneMapping}>None</option>
                <option value={THREE.LinearToneMapping}>Linear</option>
                <option value={THREE.ReinhardToneMapping}>Reinhard</option>
                <option value={THREE.ACESFilmicToneMapping}>ACES Filmic</option>
              </select>
            </label>

            {/* Shadows checkbox */}
            <label className="sky-controls-check" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={lightingValues.shadowsEnabled}
                disabled={!lightingOverride}
                onChange={(e) => handleLightingChange("shadowsEnabled", e.target.checked)}
              />
              Shadows
            </label>
          </div>
        )}
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
    </div>
  );
}
