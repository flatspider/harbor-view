import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import type { ShipData } from "../types/ais";
import { getShipCategory, NY_HARBOR_BOUNDS } from "../types/ais";
import { ShipInfoCard } from "./ShipInfoCard";

interface HarborSceneProps {
  ships: Map<number, ShipData>;
}

const CATEGORY_COLORS: Record<string, string> = {
  special: "#e6a817",
  passenger: "#ffffff",
  cargo: "#4a8cbf",
  tanker: "#c44d4d",
  other: "#8b9daa",
};

const CATEGORY_SCALES: Record<string, number> = {
  special: 0.8,
  passenger: 1,
  cargo: 1.15,
  tanker: 1.2,
  other: 0.9,
};

const WORLD_WIDTH = 1800;
const WORLD_DEPTH = 1200;
const TILE_SIZE = 120;
const TILE_VARIANTS = 4;
const LAND_BASE_HEIGHT = 12;

interface ShipMarkerData {
  isShipMarker: true;
  mmsi: number;
  ship: ShipData;
  target: THREE.Vector3;
  wake: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  baseColor: THREE.Color;
}

type ShipMesh = THREE.Mesh<THREE.ConeGeometry, THREE.MeshStandardMaterial>;

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

function createFallbackLand(scene: THREE.Scene): void {
  const landMaterial = new THREE.MeshStandardMaterial({
    color: "#5f6f4d",
    roughness: 0.95,
    metalness: 0.02,
  });

  const shorelineMaterial = new THREE.MeshStandardMaterial({
    color: "#99a47d",
    roughness: 1,
    metalness: 0,
  });

  const landMasses: Array<{ x: number; z: number; w: number; d: number; h: number }> = [
    { x: -540, z: 20, w: 320, d: 940, h: 16 },
    { x: 320, z: -40, w: 700, d: 340, h: 12 },
    { x: 420, z: 430, w: 760, d: 460, h: 12 },
  ];

  for (const mass of landMasses) {
    const land = new THREE.Mesh(
      new THREE.BoxGeometry(mass.w, mass.h, mass.d),
      landMaterial,
    );
    land.position.set(mass.x, mass.h * 0.5, mass.z);
    land.receiveShadow = true;
    scene.add(land);

    const shoreline = new THREE.Mesh(
      new THREE.BoxGeometry(mass.w + 18, 4, mass.d + 18),
      shorelineMaterial,
    );
    shoreline.position.set(mass.x, mass.h + 2, mass.z);
    shoreline.receiveShadow = true;
    scene.add(shoreline);
  }
}

export function HarborScene({ ships }: HarborSceneProps) {
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
  const tileRef = useRef<THREE.Mesh[]>([]);
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
    const mount = sceneRef.current;
    if (!mount) return;
    const shipMarkers = shipMarkersRef.current;
    const tiles = tileRef.current;

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
        tiles.push(tile);
      }
    }

    void (async () => {
      try {
        const response = await fetch("/assets/data/nyc-harbor-land.geojson");
        if (!response.ok) {
          createFallbackLand(scene);
          return;
        }
        const geojson = (await response.json()) as GeoJsonFeatureCollection;
        if (!addGeoJsonLand(scene, geojson)) {
          createFallbackLand(scene);
        }
      } catch {
        createFallbackLand(scene);
      }
    })();

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

      const markers = Array.from(shipMarkers.values());
      const hits = raycasterRef.current.intersectObjects(markers, true);
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

      const markers = Array.from(shipMarkers.values());
      const hits = raycasterRef.current.intersectObjects(markers, true);
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

    const animate = (time: number) => {
      if (!sceneInstanceRef.current || !cameraRef.current || !rendererRef.current) return;
      const t = time * 0.001;

      for (let i = 0; i < tiles.length; i += 1) {
        const tile = tiles[i];
        const geom = tile.geometry as THREE.PlaneGeometry;
        const attr = geom.attributes.position;
        for (let v = 0; v < attr.count; v += 1) {
          const x = attr.getX(v);
          const y = Math.sin((x + t * 120 + i * 11) * 0.03) * 1.1;
          attr.setY(v, y);
        }
        attr.needsUpdate = true;
      }

      for (const marker of shipMarkers.values()) {
        const markerData = getShipMarkerData(marker);
        marker.position.lerp(markerData.target, 0.14);
        marker.rotation.y = (-markerData.ship.heading * Math.PI) / 180;
        const wake = markerData.wake;
        wake.scale.x = 1 + Math.min(markerData.ship.sog / 12, 1.9);
        wake.material.opacity = 0.25 + Math.min(markerData.ship.sog / 45, 0.25);
      }

      controls.update();

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
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
      shipMarkers.clear();
      tiles.length = 0;
    };
  }, [handleClose, handleShipClick]);

  useEffect(() => {
    const scene = sceneInstanceRef.current;
    if (!scene) return;

    const nextShipIds = new Set<number>();

    for (const ship of ships.values()) {
      if (ship.lat === 0 && ship.lon === 0) continue;
      const mmsi = ship.mmsi;
      nextShipIds.add(mmsi);
      const target = latLonToWorld(ship.lat, ship.lon);
      const category = getShipCategory(ship.shipType);

      const existing = shipMarkersRef.current.get(mmsi);
      if (existing) {
        const markerData = getShipMarkerData(existing);
        markerData.ship = ship;
        markerData.target.copy(target);
        continue;
      }

      const hull = new THREE.Mesh(
        new THREE.ConeGeometry(4.5 * CATEGORY_SCALES[category], 16 * CATEGORY_SCALES[category], 8),
        new THREE.MeshStandardMaterial({
          color: CATEGORY_COLORS[category],
          roughness: 0.55,
          metalness: 0.2,
        }),
      );
      hull.castShadow = true;
      hull.position.copy(target);
      hull.position.y = 10;
      hull.rotation.x = Math.PI / 2;

      const wake = new THREE.Mesh(
        new THREE.PlaneGeometry(22, 7),
        new THREE.MeshBasicMaterial({
          color: "#d6edf9",
          transparent: true,
          opacity: 0.3,
        }),
      );
      wake.rotation.x = -Math.PI / 2;
      wake.position.set(0, -8, -16);
      hull.add(wake);

      const hitArea = new THREE.Mesh(
        new THREE.SphereGeometry(13 * CATEGORY_SCALES[category], 12, 12),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      hull.add(hitArea);

      hull.userData = {
        isShipMarker: true,
        mmsi,
        ship,
        target,
        wake,
        baseColor: new THREE.Color(CATEGORY_COLORS[category]),
      } as ShipMarkerData;

      scene.add(hull);
      shipMarkersRef.current.set(mmsi, hull);
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
      <div className="harbor-scene-overlay">
        Click a vessel to focus. Click water to return to harbor view.
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
