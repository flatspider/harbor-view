import * as THREE from "three";
import type { ShipData } from "../types/ais";
import type { ShipCategory } from "../types/ais";
import { getShipCategory } from "../types/ais";
import {
  CATEGORY_STYLES,
  WORLD_UNITS_PER_METER,
  SHIP_BASE_Y,
  WAKE_WORLD_Y,
  WAKE_BASE_OPACITY,
  SHIP_COLLISION_PADDING,
  SHIP_PLACEMENT_STEP,
  SHIP_PLACEMENT_MAX_RADIUS,
  PERF_DEBUG,
  latLonToWorld,
  worldToLonLat,
  getShipMarkerData,
  type ShipCategoryStyle,
  type ShipMarkerData,
  type ShipMesh,
  type OccupiedSlot,
} from "./constants";
import { isPointOnLand } from "./land";
import { createPassengerFerryModelInstance } from "./passengerFerryModel";
import { toonGradient } from "./toonGradient";

/* ── Geometry Factories ──────────────────────────────────────────────── */

export function createShipGeometry(category: string, sizeScale: number): THREE.BufferGeometry {
  const scale = Math.max(sizeScale, 0.22);
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

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 2.3 * scale, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 1.2 * scale, 0);
  return geometry;
}

export function createWakeGeometry(): THREE.BufferGeometry {
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

export function createShipDetailMesh(
  category: ShipCategory,
  sizeScale: number,
  hullColor: THREE.Color,
): THREE.Mesh {
  const detailMaterial = new THREE.MeshToonMaterial({
    color: hullColor.clone().offsetHSL(0, -0.08, 0.18),
    gradientMap: toonGradient,
  });
  const scale = Math.max(sizeScale, 0.22);

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

function createShipCategorySprite(
  category: ShipCategory,
  sizeScale: number,
  textures?: Record<ShipCategory, THREE.Texture>,
): THREE.Sprite | null {
  if (!textures) return null;
  const texture = textures[category] ?? textures.other;
  if (!texture) return null;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });

  const sprite = new THREE.Sprite(material);
  const visualScale = Math.max(sizeScale, 0.22);
  const baseSize = 14 * visualScale;
  sprite.scale.set(baseSize, baseSize, 1);
  sprite.position.set(0, 5.2 * visualScale, 0);
  sprite.renderOrder = 6;
  sprite.name = SHIP_CATEGORY_SPRITE_NAME;
  return sprite;
}

const SHIP_DETAIL_NAME = "ship-detail";
const SHIP_CATEGORY_SPRITE_NAME = "ship-category-sprite";
const SHIP_CATEGORY_MODEL_NAME = "ship-category-model";
const SHIP_CATEGORY_VISUAL_NAMES = new Set([SHIP_CATEGORY_SPRITE_NAME, SHIP_CATEGORY_MODEL_NAME]);
const SHIP_SHARED_PASSENGER_ASSET_KEY = "sharedPassengerFerryAsset";

function shouldUsePassengerFerryModel(category: ShipCategory, passengerFerryPrototype?: THREE.Object3D): boolean {
  return category === "passenger" && Boolean(passengerFerryPrototype);
}

function shouldRenderShipDetail(category: ShipCategory, passengerFerryPrototype?: THREE.Object3D): boolean {
  return !shouldUsePassengerFerryModel(category, passengerFerryPrototype);
}

function isSharedPassengerFerryAsset(object: THREE.Object3D): boolean {
  return (object.userData as { sharedPassengerFerryAsset?: boolean })[SHIP_SHARED_PASSENGER_ASSET_KEY] === true;
}

function getShipCategoryVisual(parent: THREE.Object3D): THREE.Object3D | null {
  return parent.children.find((child) => SHIP_CATEGORY_VISUAL_NAMES.has(child.name)) ?? null;
}

function createShipCategoryVisual(
  category: ShipCategory,
  sizeScale: number,
  categoryTextures: Record<ShipCategory, THREE.Texture> | undefined,
  passengerFerryPrototype?: THREE.Object3D,
): THREE.Object3D | null {
  if (shouldUsePassengerFerryModel(category, passengerFerryPrototype)) {
    return createPassengerFerryModelInstance(passengerFerryPrototype!, sizeScale);
  }
  return createShipCategorySprite(category, sizeScale, categoryTextures);
}

function removeShipCategoryVisual(parent: THREE.Object3D): void {
  const visuals = parent.children.filter((child) => SHIP_CATEGORY_VISUAL_NAMES.has(child.name));
  for (const visual of visuals) {
    if (visual instanceof THREE.Sprite) {
      if (visual.material instanceof THREE.Material) visual.material.dispose();
    }
    parent.remove(visual);
  }
}

function needsShipCategoryVisualRefresh(
  parent: THREE.Object3D,
  category: ShipCategory,
  categoryTextures: Record<ShipCategory, THREE.Texture> | undefined,
  passengerFerryPrototype?: THREE.Object3D,
): boolean {
  const visual = getShipCategoryVisual(parent);
  const wantsPassengerModel = shouldUsePassengerFerryModel(category, passengerFerryPrototype);
  if (wantsPassengerModel) {
    return visual?.name !== SHIP_CATEGORY_MODEL_NAME;
  }
  if (!categoryTextures) return false;
  return visual?.name !== SHIP_CATEGORY_SPRITE_NAME;
}

function syncShipDetailMesh(
  parent: THREE.Object3D,
  category: ShipCategory,
  sizeScale: number,
  hullColor: THREE.Color,
  passengerFerryPrototype?: THREE.Object3D,
): void {
  const existingDetail = parent.children.find((child) => child.name === SHIP_DETAIL_NAME);
  const wantsDetail = shouldRenderShipDetail(category, passengerFerryPrototype);

  if (!wantsDetail) {
    if (existingDetail instanceof THREE.Mesh) {
      if (existingDetail.material instanceof THREE.Material) existingDetail.material.dispose();
      existingDetail.geometry.dispose();
      parent.remove(existingDetail);
    }
    return;
  }

  if (existingDetail instanceof THREE.Mesh) {
    if (existingDetail.material instanceof THREE.Material) existingDetail.material.dispose();
    existingDetail.geometry.dispose();
    parent.remove(existingDetail);
  }

  const nextDetail = createShipDetailMesh(category, sizeScale, hullColor);
  nextDetail.name = SHIP_DETAIL_NAME;
  parent.add(nextDetail);
}

/* ── Ship Sizing & Collision ─────────────────────────────────────────── */

export function computeShipSizeScale(ship: ShipData, style: ShipCategoryStyle): number {
  const lengthM = ship.lengthM > 0 ? ship.lengthM : 110;
  const beamM = ship.beamM > 0 ? ship.beamM : 18;
  const targetLengthUnits = lengthM * WORLD_UNITS_PER_METER;
  const targetBeamUnits = beamM * WORLD_UNITS_PER_METER;
  const fromLength = targetLengthUnits / 22;
  const fromBeam = targetBeamUnits / 8;
  const blended = fromLength * 0.75 + fromBeam * 0.25;
  return Math.min(Math.max(blended * 3.0 * style.scale, 0.22), 1.3);
}

export function getShipCollisionRadius(ship: ShipData, style: ShipCategoryStyle): number {
  const length = ship.lengthM > 0 ? ship.lengthM : 85;
  const beam = ship.beamM > 0 ? ship.beamM : 18;
  const scaledHull = (length * 0.05 + beam * 0.22) * style.scale;
  return Math.min(Math.max(scaledHull, 16), 60);
}

const SHIP_BOUNDARY_SCALE_STEPS = [1, 0.86, 0.74, 0.62] as const;
const SHIP_LAND_CLEARANCE = 2.5;
const SHIP_BOUNDARY_SAMPLE_SPACING = 8;
const SHIP_WATER_FALLBACK_RADIUS = 120;

interface ResolvedShipTarget {
  target: THREE.Vector3 | null;
  boundaryScale: number;
}

export function getShipFootprintRadius(sizeScale: number): number {
  return Math.max(5.5, 13.5 * Math.max(sizeScale, 0.22));
}

function isWorldPointNavigable(x: number, z: number): boolean {
  const lonLat = worldToLonLat(x, z);
  if (!lonLat) return false;
  return !isPointOnLand(lonLat.lon, lonLat.lat);
}

function isWorldCircleNavigable(x: number, z: number, footprintRadius: number): boolean {
  if (!isWorldPointNavigable(x, z)) return false;
  const sampleRadius = Math.max(0, footprintRadius + SHIP_LAND_CLEARANCE);
  if (sampleRadius <= 0.01) return true;

  const sampleCount = Math.max(10, Math.floor((Math.PI * 2 * sampleRadius) / SHIP_BOUNDARY_SAMPLE_SPACING));
  for (let i = 0; i < sampleCount; i += 1) {
    const theta = (i / sampleCount) * Math.PI * 2;
    const sampleX = x + Math.cos(theta) * sampleRadius;
    const sampleZ = z + Math.sin(theta) * sampleRadius;
    if (!isWorldPointNavigable(sampleX, sampleZ)) return false;
  }
  return true;
}

function buildPlacementCandidates(
  desired: THREE.Vector3,
  mmsi: number,
  maxRadius: number,
  step: number,
): Array<{ x: number; z: number }> {
  const candidates: Array<{ x: number; z: number }> = [{ x: desired.x, z: desired.z }];
  const baseAngle = ((mmsi % 360) * Math.PI) / 180;

  for (let distance = step; distance <= maxRadius; distance += step) {
    const sampleCount = Math.max(10, Math.floor((Math.PI * 2 * distance) / (step * 1.45)));
    for (let i = 0; i < sampleCount; i += 1) {
      const theta = baseAngle + (i / sampleCount) * Math.PI * 2;
      candidates.push({
        x: desired.x + Math.cos(theta) * distance,
        z: desired.z + Math.sin(theta) * distance,
      });
    }
  }

  return candidates;
}

function getBoundaryScaleSteps(maxScale = 1): number[] {
  const minConfigured = SHIP_BOUNDARY_SCALE_STEPS[SHIP_BOUNDARY_SCALE_STEPS.length - 1];
  const clamped = Math.min(1, Math.max(maxScale, minConfigured));
  const steps: number[] = SHIP_BOUNDARY_SCALE_STEPS.filter((value) => value <= clamped + 0.0001);
  if (!steps.some((value) => Math.abs(value - clamped) < 0.0001)) {
    steps.push(clamped);
  }
  steps.sort((a, b) => b - a);
  return steps;
}

function intersectsOccupiedSlots(
  x: number,
  z: number,
  mmsi: number,
  collisionRadius: number,
  occupiedSlots: OccupiedSlot[],
): boolean {
  for (const occupied of occupiedSlots) {
    if (occupied.mmsi === mmsi) continue;
    const minDistance = collisionRadius + occupied.radius + SHIP_COLLISION_PADDING;
    const dx = x - occupied.x;
    const dz = z - occupied.z;
    if (dx * dx + dz * dz < minDistance * minDistance) return true;
  }
  return false;
}

export function resolveShipTarget(
  desired: THREE.Vector3,
  mmsi: number,
  collisionRadius: number,
  footprintRadius: number,
  occupiedSlots: OccupiedSlot[],
  maxBoundaryScale = 1,
): ResolvedShipTarget {
  const boundaryScaleSteps = getBoundaryScaleSteps(maxBoundaryScale);

  for (const boundaryScale of boundaryScaleSteps) {
    const effectiveFootprintRadius = footprintRadius * boundaryScale;
    if (
      isWorldCircleNavigable(desired.x, desired.z, effectiveFootprintRadius) &&
      !intersectsOccupiedSlots(desired.x, desired.z, mmsi, collisionRadius, occupiedSlots)
    ) {
      return {
        target: desired.clone(),
        boundaryScale,
      };
    }
  }

  const candidates = buildPlacementCandidates(desired, mmsi, SHIP_PLACEMENT_MAX_RADIUS, SHIP_PLACEMENT_STEP);

  for (const boundaryScale of boundaryScaleSteps) {
    const effectiveFootprintRadius = footprintRadius * boundaryScale;
    for (const candidate of candidates) {
      if (candidate.x === desired.x && candidate.z === desired.z) continue;
      if (!isWorldCircleNavigable(candidate.x, candidate.z, effectiveFootprintRadius)) continue;
      if (intersectsOccupiedSlots(candidate.x, candidate.z, mmsi, collisionRadius, occupiedSlots)) continue;
      return {
        target: new THREE.Vector3(candidate.x, desired.y, candidate.z),
        boundaryScale,
      };
    }
  }

  return {
    target: null,
    boundaryScale: boundaryScaleSteps[boundaryScaleSteps.length - 1] ?? 1,
  };
}

function resolveWaterOnlyTarget(
  desired: THREE.Vector3,
  mmsi: number,
  footprintRadius: number,
  maxBoundaryScale = 1,
): ResolvedShipTarget {
  const boundaryScaleSteps = getBoundaryScaleSteps(maxBoundaryScale);

  for (const boundaryScale of boundaryScaleSteps) {
    const effectiveFootprintRadius = footprintRadius * boundaryScale;
    if (isWorldCircleNavigable(desired.x, desired.z, effectiveFootprintRadius)) {
      return {
        target: desired.clone(),
        boundaryScale,
      };
    }
  }

  const maxRadius = Math.min(SHIP_PLACEMENT_MAX_RADIUS, SHIP_WATER_FALLBACK_RADIUS);
  const candidates = buildPlacementCandidates(desired, mmsi, maxRadius, SHIP_PLACEMENT_STEP);

  for (const boundaryScale of boundaryScaleSteps) {
    const effectiveFootprintRadius = footprintRadius * boundaryScale;
    for (const candidate of candidates) {
      if (candidate.x === desired.x && candidate.z === desired.z) continue;
      if (!isWorldCircleNavigable(candidate.x, candidate.z, effectiveFootprintRadius)) continue;
      return {
        target: new THREE.Vector3(candidate.x, desired.y, candidate.z),
        boundaryScale,
      };
    }
  }

  return {
    target: null,
    boundaryScale: boundaryScaleSteps[boundaryScaleSteps.length - 1] ?? 1,
  };
}

/* ── Ship Reconciliation (create/update/remove) ──────────────────────── */

export function reconcileShips(
  scene: THREE.Scene,
  ships: Map<number, ShipData>,
  shipMarkers: Map<number, ShipMesh>,
  hoveredShipRef: { current: ShipMesh | null },
  categoryTextures?: Record<ShipCategory, THREE.Texture>,
  passengerFerryPrototype?: THREE.Object3D,
): void {
  const shipsEffectStart = performance.now();
  let skippedNoPosition = 0;
  let fallbackPlacements = 0;
  let createdMarkers = 0;
  let updatedMarkers = 0;
  let hiddenByBoundary = 0;

  const nextShipIds = new Set<number>();
  const occupiedSlots: OccupiedSlot[] = [];
  const orderedShips = Array.from(ships.values()).sort(
    (a, b) => (b.lengthM > 0 ? b.lengthM : 0) - (a.lengthM > 0 ? a.lengthM : 0),
  );

  for (const ship of orderedShips) {
    if (ship.lat === 0 && ship.lon === 0) {
      skippedNoPosition += 1;
      continue;
    }
    const mmsi = ship.mmsi;
    const category = getShipCategory(ship.shipType);
    const style = CATEGORY_STYLES[category];
    const baseTarget = latLonToWorld(ship.lat, ship.lon);
    const radius = getShipCollisionRadius(ship, style);
    const existing = shipMarkers.get(mmsi);
    const nextSizeScale = computeShipSizeScale(ship, style);
    const footprintRadius = getShipFootprintRadius(nextSizeScale);

    const collisionPlacement = resolveShipTarget(baseTarget, mmsi, radius, footprintRadius, occupiedSlots);
    let placementTarget = collisionPlacement.target;
    let boundaryScale = collisionPlacement.boundaryScale;
    if (!placementTarget) {
      fallbackPlacements += 1;
      const waterFallback = resolveWaterOnlyTarget(baseTarget, mmsi, footprintRadius);
      placementTarget = waterFallback.target;
      boundaryScale = waterFallback.boundaryScale;
    }

    if (existing) {
      const markerData = getShipMarkerData(existing);
      markerData.ship = ship;
      markerData.radius = radius;
      markerData.boundaryScale = boundaryScale;
      markerData.hiddenByBoundary = !placementTarget;
      if (placementTarget) markerData.target.copy(placementTarget);

      const needsGeometryRefresh =
        markerData.category !== category || Math.abs(markerData.sizeScale - nextSizeScale) > 0.04;
      const needsVisualRefresh =
        needsGeometryRefresh ||
        needsShipCategoryVisualRefresh(existing, category, categoryTextures, passengerFerryPrototype);
      const hasDetailMesh = existing.children.some((child) => child.name === SHIP_DETAIL_NAME);
      const wantsDetailMesh = shouldRenderShipDetail(category, passengerFerryPrototype);
      const needsDetailRefresh = needsGeometryRefresh || hasDetailMesh !== wantsDetailMesh;

      if (needsGeometryRefresh) {
        markerData.category = category;
        markerData.sizeScale = nextSizeScale;
        existing.geometry.dispose();
        existing.geometry = createShipGeometry(category, nextSizeScale);
        const material = existing.material;
        if (material instanceof THREE.MeshToonMaterial) {
          material.transparent = true;
          material.opacity = 0;
        }
      }

      const nextColor = new THREE.Color(style.color);
      markerData.baseColor.copy(nextColor);
      existing.material.color.copy(nextColor);
      markerData.wakeWidth = style.wakeWidth;
      markerData.wakeLength = style.wakeLength;

      if (needsDetailRefresh) {
        syncShipDetailMesh(existing, category, nextSizeScale, nextColor, passengerFerryPrototype);
      }
      if (needsVisualRefresh) {
        removeShipCategoryVisual(existing);
        const nextVisual = createShipCategoryVisual(category, nextSizeScale, categoryTextures, passengerFerryPrototype);
        if (nextVisual) existing.add(nextVisual);
      }
      if (needsGeometryRefresh) {
        const hitArea = existing.children.find((child) => child.name === "ship-hit-area");
        if (hitArea instanceof THREE.Mesh) {
          hitArea.geometry.dispose();
          hitArea.geometry = new THREE.SphereGeometry(
            Math.max(8, Math.min(40, ship.lengthM > 0 ? ship.lengthM * WORLD_UNITS_PER_METER * 1.05 : 14)),
            12,
            12,
          );
        }
      }

      if (markerData.hiddenByBoundary) {
        existing.visible = false;
        markerData.wake.visible = false;
        hiddenByBoundary += 1;
      } else if (placementTarget) {
        existing.visible = true;
        occupiedSlots.push({ mmsi, radius, x: placementTarget.x, z: placementTarget.z });
      }

      nextShipIds.add(mmsi);
      updatedMarkers += 1;
      continue;
    }

    // New ship — place in water with boundary + collision checks.
    if (!placementTarget) {
      hiddenByBoundary += 1;
      continue;
    }
    const spawnTarget = placementTarget;

    const hullGeometry = createShipGeometry(category, nextSizeScale);
    const hullColor = new THREE.Color(style.color);
    const hullMaterial = new THREE.MeshToonMaterial({
      color: hullColor,
      gradientMap: toonGradient,
      transparent: true,
      opacity: 0,
    });
    const hull = new THREE.Mesh(hullGeometry, hullMaterial) as ShipMesh;
    hull.castShadow = false;
    hull.position.copy(spawnTarget);
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

    syncShipDetailMesh(hull, category, nextSizeScale, hullColor, passengerFerryPrototype);

    const categoryVisual = createShipCategoryVisual(category, nextSizeScale, categoryTextures, passengerFerryPrototype);
    if (categoryVisual) {
      hull.add(categoryVisual);
    }

    const hitArea = new THREE.Mesh(
      new THREE.SphereGeometry(
        Math.max(8, Math.min(40, ship.lengthM > 0 ? ship.lengthM * WORLD_UNITS_PER_METER * 1.05 : 14)),
        12,
        12,
      ),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hitArea.name = "ship-hit-area";
    hull.add(hitArea);

    hull.userData = {
      isShipMarker: true,
      mmsi,
      ship,
      target: spawnTarget.clone(),
      wake,
      baseColor: hullColor.clone(),
      category,
      radius,
      wakeWidth: style.wakeWidth,
      wakeLength: style.wakeLength,
      sizeScale: nextSizeScale,
      boundaryScale,
      hiddenByBoundary: false,
    } as ShipMarkerData;

    scene.add(hull);
    shipMarkers.set(mmsi, hull);
    nextShipIds.add(mmsi);
    occupiedSlots.push({ mmsi, radius, x: spawnTarget.x, z: spawnTarget.z });
    createdMarkers += 1;
  }

  // Remove stale markers
  for (const [mmsi, marker] of shipMarkers.entries()) {
    if (nextShipIds.has(mmsi)) continue;
    removeShipCategoryVisual(marker);
    scene.remove(marker);
    if (hoveredShipRef.current === marker) hoveredShipRef.current = null;
    marker.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (isSharedPassengerFerryAsset(child)) return;
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        for (const material of child.material) material.dispose();
        return;
      }
      child.material.dispose();
    });
    shipMarkers.delete(mmsi);
  }

  const shipsEffectMs = performance.now() - shipsEffectStart;
  if (PERF_DEBUG) {
    if (shipsEffectMs > 16) {
      console.debug("[perf] ship reconcile", { ms: Number(shipsEffectMs.toFixed(2)), ships: ships.size });
    }
    console.debug("[perf] ship visibility", {
      apiShips: ships.size,
      renderedShips: nextShipIds.size,
      skippedNoPosition,
      createdMarkers,
      updatedMarkers,
      fallbackPlacements,
      hiddenByBoundary,
    });
  }
}

/* ── Per-Frame Ship Animation ────────────────────────────────────────── */

// AIS update interval for interpolation timing (typical: 2-10 seconds)
const AIS_UPDATE_INTERVAL_MS = 5000;
// Knots → world units per millisecond conversion
// 1 knot = 1.852 km/h = 0.0005144 m/s; scaled to world units
const KNOTS_TO_WORLD_PER_MS = (0.0005144 * WORLD_UNITS_PER_METER);

const _deadReckonTarget = new THREE.Vector3();

export function animateShips(
  shipMarkers: Map<number, ShipMesh>,
  t: number,
  zoomScale = 1,
): void {
  const now = Date.now();

  for (const marker of shipMarkers.values()) {
    const markerData = getShipMarkerData(marker);
    if (markerData.hiddenByBoundary) {
      marker.visible = false;
      markerData.wake.visible = false;
      continue;
    }
    marker.visible = true;

    const ship = markerData.ship;
    const isAnchored = ship.navStatus === 1;
    const isMoored = ship.navStatus === 5;
    const isMoving = ship.sog > 2.4;
    const currentEffectiveScale = marker.scale.x || 1;
    const currentZoomScale = currentEffectiveScale / Math.max(markerData.boundaryScale, 0.1);
    const blendedVisualScale = THREE.MathUtils.lerp(currentZoomScale, zoomScale, 0.35);
    marker.scale.setScalar(blendedVisualScale * markerData.boundaryScale);
    let followStrength = isMoored ? 0.08 : 0.12;

    // ── Time-based interpolation + dead reckoning ──
    if (isMoving && !isMoored) {
      const elapsed = now - ship.lastPositionUpdate;
      const interpT = Math.min(elapsed / AIS_UPDATE_INTERVAL_MS, 1);
      followStrength = 0.2;

      // Interpolate between previous and current known positions
      const interpLat = ship.prevLat + (ship.lat - ship.prevLat) * interpT;
      const interpLon = ship.prevLon + (ship.lon - ship.prevLon) * interpT;

      // Dead reckoning: if interpolation is complete, project forward using SOG/COG
      if (interpT >= 1) {
        const overshootMs = elapsed - AIS_UPDATE_INTERVAL_MS;
        const headingRad = (ship.cog * Math.PI) / 180;
        const distanceUnits = ship.sog * KNOTS_TO_WORLD_PER_MS * Math.min(overshootMs, 10000);
        const drTarget = latLonToWorld(ship.lat, ship.lon);
        // COG is clockwise from north; in world space: x = sin(heading), z = cos(heading)
        // But world coords are mirrored, so negate x
        _deadReckonTarget.set(
          drTarget.x - Math.sin(headingRad) * distanceUnits,
          markerData.target.y,
          drTarget.z + Math.cos(headingRad) * distanceUnits,
        );
        markerData.target.copy(_deadReckonTarget);
      } else {
        const interpTarget = latLonToWorld(interpLat, interpLon);
        markerData.target.copy(interpTarget);
      }
    }

    const runtimeFootprint = getShipFootprintRadius(markerData.sizeScale);
    if (!isWorldCircleNavigable(markerData.target.x, markerData.target.z, runtimeFootprint * markerData.boundaryScale)) {
      const waterFallback = resolveWaterOnlyTarget(
        markerData.target,
        markerData.mmsi,
        runtimeFootprint,
        markerData.boundaryScale,
      );
      if (!waterFallback.target) {
        markerData.hiddenByBoundary = true;
        marker.visible = false;
        markerData.wake.visible = false;
        continue;
      }
      markerData.boundaryScale = waterFallback.boundaryScale;
      markerData.target.copy(waterFallback.target);
      marker.scale.setScalar(blendedVisualScale * markerData.boundaryScale);
    }

    marker.position.lerp(markerData.target, followStrength);

    // Bobbing for anchored/moored vessels
    const bob = (isAnchored || isMoored)
      ? Math.sin(t * 2 + (markerData.mmsi % 11)) * (isAnchored ? 0.8 : 0.4)
      : 0;
    marker.position.y = SHIP_BASE_Y + bob;

    // Heading
    marker.rotation.y = (-ship.heading * Math.PI) / 180;

    // Wake
    const wake = markerData.wake;
    wake.visible = isMoving && !isMoored;
    const wakeScaleBase = markerData.sizeScale * markerData.boundaryScale;
    wake.scale.x = markerData.wakeWidth * wakeScaleBase * (0.58 + Math.min(ship.sog / 13, 1.05));
    wake.scale.z = markerData.wakeLength * wakeScaleBase * (0.72 + Math.min(ship.sog / 11, 1.24));
    wake.material.opacity = WAKE_BASE_OPACITY + Math.min(ship.sog / 55, 0.14);
  }
}
