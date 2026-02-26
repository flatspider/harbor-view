import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import type { ShipData } from "../types/ais";
import type { HarborEnvironment } from "../types/environment";
import { ShipInfoCard } from "./ShipInfoCard";
import { FerryRouteInfoCard } from "./FerryRouteInfoCard";

// Scene layer modules
import {
  WORLD_WIDTH,
  WORLD_DEPTH,
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

interface HarborSceneProps {
  ships: Map<number, ShipData>;
  environment: HarborEnvironment;
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
  const hoveredFerryRef = useRef<THREE.Line | null>(null);
  const animationRef = useRef<number | null>(null);
  const shipMarkersRef = useRef<Map<number, ShipMesh>>(new Map());
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
  const [skyAutoMode, setSkyAutoMode] = useState(true);
  const [skyPanelOpen, setSkyPanelOpen] = useState(false);
  const [manualSkySettings, setManualSkySettings] = useState<SkySettings>(() => getDefaultSkySettings());
  const skyAutoModeRef = useRef(skyAutoMode);
  const manualSkySettingsRef = useRef(manualSkySettings);
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

  const handleSkySettingChange = useCallback((key: SkySettingKey, value: number) => {
    setManualSkySettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleResetSkySettings = useCallback(() => {
    setManualSkySettings(getDefaultSkySettings());
  }, []);

  /* ── Scene Setup ───────────────────────────────────────────────────── */

  useEffect(() => {
    const mount = sceneRef.current;
    if (!mount) return;
    const shipMarkers = shipMarkersRef.current;
    const ferryRouteTargets = ferryRouteTargetsRef.current;
    const tiles = tileRef.current;
    const coastlineObjects = coastlineObjectsRef.current;
    const raycastTargets = raycastTargetsRef.current;
    const labelSizes = labelSizesRef.current;
    const abortController = new AbortController();
    landPolygonRings.length = 0;
    raycasterRef.current.params.Line = { threshold: 8 };

    // Scene
    const scene = new THREE.Scene();
    // Scene background is handled via renderer clear color in the animation loop.
    scene.fog = new THREE.Fog("#a7c5d8", 800, 2200);
    sceneInstanceRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(40, mount.clientWidth / mount.clientHeight, 1, 5000);
    camera.position.set(0, WORLD_DEPTH * 0.67, -WORLD_DEPTH * 0.475);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor("#89b3cf", 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.62;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const worldMaxSpan = Math.max(WORLD_WIDTH, WORLD_DEPTH);
    const controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableRotate = false;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 1.0;
    controls.minDistance = 80;
    controls.maxDistance = worldMaxSpan * 1.85;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.target.set(0, 0, 0);
    controls.update();
    controlsRef.current = controls;

    // Lighting
    const hemiLight = new THREE.HemisphereLight("#d9eef8", "#8b6d4a", 0.85);
    hemiLight.position.set(0, 600, 0);
    scene.add(hemiLight);
    hemiLightRef.current = hemiLight;

    const sunLight = new THREE.DirectionalLight("#ffb347", 1.3);
    sunLight.position.set(-500, 180, 400);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    const skyMesh = createSkyBackdrop(scene);
    skyMeshRef.current = skyMesh;

    const windParticles = createWindParticles(scene);
    windParticlesRef.current = windParticles;

    void (async () => {
      if (RENDER_LAND_POLYGONS) {
        await loadLandPolygons(scene, abortController.signal);
      }
      if (abortController.signal.aborted) return;

      const newTiles = createWaterTiles(scene);
      tiles.push(...newTiles);

      if (RENDER_SMOKE_SKYLINE) {
        await loadSkylineSmoke(scene, abortController.signal);
      }
      if (abortController.signal.aborted) return;
      await loadFerryRoutes(scene, abortController.signal);
      ferryRouteTargets.length = 0;
      ferryRouteTargets.push(...getFerryRouteTargets());
    })();

    // Resize
    const handleResize = () => {
      if (!rendererRef.current || !cameraRef.current || !sceneRef.current) return;
      const width = sceneRef.current.clientWidth;
      const height = sceneRef.current.clientHeight;
      if (width === 0 || height === 0) return;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
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

    const handlePointerMove = (event: PointerEvent) => {
      if (!sceneRef.current || !cameraRef.current) return;
      const rect = sceneRef.current.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
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
        hoveredMarker.material.color.copy(hoveredData.baseColor.clone().offsetHSL(0, 0.12, 0.16));
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
        camera.position.lerp(marker.position.clone().add(new THREE.Vector3(0, 203, -142)), 0.75);
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

    const animate = (time: number) => {
      if (!sceneInstanceRef.current || !cameraRef.current || !rendererRef.current) return;
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
      rendererRef.current.setClearColor(backgroundColorRef.current, 1);
      if (skyMeshRef.current) {
        const appliedSky = animateSky(
          skyMeshRef.current,
          cachedNight,
          env,
          skyAutoModeRef.current ? undefined : manualSkySettingsRef.current,
        );
        rendererRef.current.toneMappingExposure = appliedSky.exposure;
      }
      setFerryRouteNight(cachedNight);
      const zoomProgress = THREE.MathUtils.clamp(
        (cameraDistance - controls.minDistance) / Math.max(1, controls.maxDistance - controls.minDistance),
        0,
        1,
      );
      const shipZoomScale = THREE.MathUtils.lerp(0.9, 5.6, Math.pow(zoomProgress, 0.65));
      animateShips(shipMarkers, t, shipZoomScale);
      controls.update();

      if (sceneRef.current && cameraRef.current) {
        projectLabels(cameraRef.current, sceneRef.current, labelElementsRef.current, labelSizes);
      }

      rendererRef.current.render(sceneInstanceRef.current, cameraRef.current);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      mount.removeEventListener("pointerdown", handlePointerDown);
      mount.removeEventListener("pointermove", handlePointerMove);
      mount.removeEventListener("pointerup", handlePointerUp);
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
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
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      shipMarkers.clear();
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
      abortController.abort();
      landPolygonRings.length = 0;
    };
  }, [handleClose, handleShipClick, handleFerryRouteClick]);

  /* ── Ship Reconciliation ───────────────────────────────────────────── */

  useEffect(() => {
    const scene = sceneInstanceRef.current;
    if (!scene) return;
    reconcileShips(scene, ships, shipMarkersRef.current, hoveredShipRef);
  }, [ships]);

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
