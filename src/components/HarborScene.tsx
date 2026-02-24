import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
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
  mmsi: number;
  ship: ShipData;
  target: THREE.Vector3;
  wake: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

function getShipMarkerData(mesh: THREE.Object3D): ShipMarkerData {
  return mesh.userData as ShipMarkerData;
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
  return new THREE.Vector2(world.x, world.z);
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
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const animationRef = useRef<number | null>(null);
  const shipMarkersRef = useRef<
    Map<number, THREE.Mesh<THREE.ConeGeometry, THREE.MeshStandardMaterial>>
  >(new Map());
  const tileRef = useRef<THREE.Mesh[]>([]);
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));
  const cameraFocusOffsetRef = useRef(new THREE.Vector3(0, 420, 430));
  const modeRef = useRef<"overview" | "focus">("overview");
  const focusedShipRef = useRef<number | null>(null);
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
    modeRef.current = "overview";
    focusedShipRef.current = null;
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
    camera.position.set(0, 630, 760);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

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
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;
      const rect = sceneRef.current.getBoundingClientRect();
      pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current);

      const markers = Array.from(shipMarkers.values());
      const hits = raycasterRef.current.intersectObjects(markers, false);
      if (hits.length === 0) {
        handleClose();
        return;
      }

      const marker = hits[0].object as THREE.Mesh<
        THREE.ConeGeometry,
        THREE.MeshStandardMaterial
      >;
      const focusedShip = getShipMarkerData(marker).ship;
      modeRef.current = "focus";
      focusedShipRef.current = focusedShip.mmsi;
      handleShipClick(focusedShip, marker.position);
    };

    window.addEventListener("resize", handleResize);
    mount.addEventListener("pointerdown", handlePointerDown);

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

      if (modeRef.current === "focus" && focusedShipRef.current != null) {
        const focused = shipMarkers.get(focusedShipRef.current);
        if (focused) {
          cameraTargetRef.current.lerp(focused.position, 0.08);
          cameraFocusOffsetRef.current.lerp(new THREE.Vector3(0, 160, 190), 0.1);
        }
      } else {
        cameraTargetRef.current.lerp(new THREE.Vector3(0, 0, 0), 0.06);
        cameraFocusOffsetRef.current.lerp(new THREE.Vector3(0, 420, 430), 0.08);
      }

      const desiredCameraPos = cameraTargetRef.current.clone().add(cameraFocusOffsetRef.current);
      cameraRef.current.position.lerp(desiredCameraPos, 0.1);
      cameraRef.current.lookAt(cameraTargetRef.current);

      rendererRef.current.render(sceneInstanceRef.current, cameraRef.current);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", handleResize);
      mount.removeEventListener("pointerdown", handlePointerDown);
      if (animationRef.current != null) {
        cancelAnimationFrame(animationRef.current);
      }
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
        new THREE.ConeGeometry(8 * CATEGORY_SCALES[category], 30 * CATEGORY_SCALES[category], 8),
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

      hull.userData = {
        mmsi,
        ship,
        target,
        wake,
      } as ShipMarkerData;

      scene.add(hull);
      shipMarkersRef.current.set(mmsi, hull);
    }

    for (const [mmsi, marker] of shipMarkersRef.current.entries()) {
      if (nextShipIds.has(mmsi)) continue;
      scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
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
