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
import { createContainerShipModelInstance } from "./containerShipModel";
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
  shape.moveTo(0, 1.6);
  shape.lineTo(-2.8, -9.5);
  shape.lineTo(2.8, -9.5);
  shape.lineTo(0, -3.1);
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
const SHIP_SHARED_MODEL_ASSET_KEY = "sharedShipModelAsset";

function getShipModelPrototype(
  category: ShipCategory,
  passengerFerryPrototype?: THREE.Object3D,
  containerShipPrototype?: THREE.Object3D,
): THREE.Object3D | undefined {
  if (category === "cargo") return containerShipPrototype;
  return passengerFerryPrototype;
}

function shouldUseShipModel(
  category: ShipCategory,
  passengerFerryPrototype?: THREE.Object3D,
  containerShipPrototype?: THREE.Object3D,
): boolean {
  return Boolean(getShipModelPrototype(category, passengerFerryPrototype, containerShipPrototype));
}

function shouldRenderShipDetail(
  category: ShipCategory,
  passengerFerryPrototype?: THREE.Object3D,
  containerShipPrototype?: THREE.Object3D,
): boolean {
  return !shouldUseShipModel(category, passengerFerryPrototype, containerShipPrototype);
}

function isSharedPassengerFerryAsset(object: THREE.Object3D): boolean {
  return (object.userData as { sharedShipModelAsset?: boolean })[SHIP_SHARED_MODEL_ASSET_KEY] === true;
}

function getShipCategoryVisual(parent: THREE.Object3D): THREE.Object3D | null {
  return parent.children.find((child) => SHIP_CATEGORY_VISUAL_NAMES.has(child.name)) ?? null;
}

function hasVisibleShipBody(marker: ShipMesh): boolean {
  const hullVisible = marker.material.opacity > 0.02;
  const categoryVisual = getShipCategoryVisual(marker);
  return hullVisible || categoryVisual !== null;
}

function createShipCategoryVisual(
  category: ShipCategory,
  sizeScale: number,
  categoryTextures: Record<ShipCategory, THREE.Texture> | undefined,
  passengerFerryPrototype?: THREE.Object3D,
  containerShipPrototype?: THREE.Object3D,
): THREE.Object3D | null {
  if (category === "cargo" && containerShipPrototype) {
    return createContainerShipModelInstance(containerShipPrototype, sizeScale);
  }
  if (passengerFerryPrototype) {
    return createPassengerFerryModelInstance(passengerFerryPrototype, sizeScale);
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
  containerShipPrototype?: THREE.Object3D,
): boolean {
  const visual = getShipCategoryVisual(parent);
  const wantsModel = shouldUseShipModel(category, passengerFerryPrototype, containerShipPrototype);
  if (wantsModel) {
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
  containerShipPrototype?: THREE.Object3D,
): void {
  const existingDetail = parent.children.find((child) => child.name === SHIP_DETAIL_NAME);
  const wantsDetail = shouldRenderShipDetail(category, passengerFerryPrototype, containerShipPrototype);

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
const SHIP_POSITION_RECONCILE_EPSILON = 0.000015;
const SHIP_BOUNDARY_RECHECK_INTERVAL_MS = 900;
const SHIP_BOUNDARY_RECHECK_MOVING_INTERVAL_MS = 450;
const SHIP_PREDICTION_MAX_MS = 25_000;
const SHIP_CORRECTION_HALF_LIFE_MS = 2_500;
const SHIP_MAX_SPEED_KNOTS = 55;
const AIS_SOG_UNAVAILABLE_THRESHOLD = 102.2;
const SHIP_POSITION_NOISE_RADIUS = 0.55;
const SHIP_MOTION_DEBUG =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("shipMotionDebug");
const SHIP_MOTION_LOG_INTERVAL_MS = 3_000;
const shipMotionLastLogAt = new Map<number, number>();
const SHIP_CORRECTION_INJECT_GAIN = 0.12;
const SHIP_MAX_CORRECTION_UNITS = 22;
const SHIP_TARGET_DAMPING_TAU_MS = 2200;
const SHIP_POSITION_DAMPING_TAU_MOVING_MS = 1600;
const SHIP_POSITION_DAMPING_TAU_IDLE_MS = 2600;
const SHIP_RENDER_LIMIT = 80;
const SHIP_INVALID_POSITION_HIDE_STRIKES = 4;

interface ResolvedShipTarget {
  target: THREE.Vector3 | null;
  boundaryScale: number;
}

function projectPositionFromCourseAndSpeed(
  anchor: THREE.Vector3,
  courseDeg: number,
  speedKnots: number,
  elapsedMs: number,
): THREE.Vector3 {
  if (speedKnots <= 0 || elapsedMs <= 0) return anchor.clone();
  const headingRad = (courseDeg * Math.PI) / 180;
  const distanceUnits = speedKnots * KNOTS_TO_WORLD_PER_MS * elapsedMs;
  return new THREE.Vector3(
    anchor.x - Math.sin(headingRad) * distanceUnits,
    anchor.y,
    anchor.z + Math.cos(headingRad) * distanceUnits,
  );
}

function angularDifferenceDeg(a: number, b: number): number {
  const delta = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return delta;
}

function sanitizeShipSpeedKnots(rawSog: number, observedKnots?: number): number {
  if (!Number.isFinite(rawSog) || rawSog <= 0) return 0;
  if (rawSog >= AIS_SOG_UNAVAILABLE_THRESHOLD) return 0;

  const candidateA = rawSog;
  const candidateB = rawSog / 10;

  let chosen = candidateA;
  if (Number.isFinite(observedKnots) && observedKnots! > 0.3 && observedKnots! < 120) {
    const errorA = Math.abs(candidateA - observedKnots!);
    const errorB = Math.abs(candidateB - observedKnots!);
    if (errorB + 0.2 < errorA) {
      chosen = candidateB;
    }
  } else if (Number.isInteger(rawSog) && rawSog >= 35) {
    // Heuristic for feeds that provide tenths-of-knot integers.
    chosen = candidateB;
  }

  return Math.min(Math.max(0, chosen), SHIP_MAX_SPEED_KNOTS);
}

function sanitizeCourseDeg(rawCog: number, fallbackDeg = 0, observedCourseDeg?: number): number {
  if (!Number.isFinite(rawCog)) return fallbackDeg;
  const candidateA = ((rawCog % 360) + 360) % 360;
  const candidateB = (((rawCog / 10) % 360) + 360) % 360;

  let chosen = rawCog > 360 ? candidateB : candidateA;
  if (Number.isFinite(observedCourseDeg)) {
    const diffChosen = angularDifferenceDeg(chosen, observedCourseDeg!);
    if (diffChosen > 120) {
      const diffA = angularDifferenceDeg(candidateA, observedCourseDeg!);
      const diffB = angularDifferenceDeg(candidateB, observedCourseDeg!);
      chosen = diffB + 4 < diffA ? candidateB : candidateA;
      if (angularDifferenceDeg(chosen, observedCourseDeg!) > 130) {
        chosen = observedCourseDeg!;
      }
    }
  }

  return chosen;
}

function clampVectorLength(vector: THREE.Vector3, maxLength: number): void {
  const length = vector.length();
  if (length <= maxLength || length === 0) return;
  vector.multiplyScalar(maxLength / length);
}

function freezeShipMotion(marker: ShipMesh, markerData: ShipMarkerData): void {
  markerData.motion.prevAnchorPosition.copy(marker.position);
  markerData.motion.prevAnchorTimeMs = markerData.motion.anchorTimeMs;
  markerData.motion.anchorPosition.copy(marker.position);
  markerData.motion.anchorTimeMs = Date.now();
  markerData.motion.speedKnots = 0;
  markerData.motion.correction.set(0, 0, 0);
  markerData.target.copy(marker.position);
}

function estimateObservedSpeedKnots(from: THREE.Vector3, to: THREE.Vector3, dtMs: number): number {
  if (dtMs <= 0) return 0;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distanceUnits = Math.hypot(dx, dz);
  const distanceMeters = distanceUnits / WORLD_UNITS_PER_METER;
  const mps = distanceMeters / (dtMs / 1000);
  return mps / 0.5144;
}

function estimateObservedCourseDeg(from: THREE.Vector3, to: THREE.Vector3): number | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx * dx + dz * dz < 0.0001) return null;
  const radians = Math.atan2(-dx, dz);
  return (((radians * 180) / Math.PI) + 360) % 360;
}

function applyExponentialCorrectionDecay(correction: THREE.Vector3, dtMs: number): void {
  if (dtMs <= 0) return;
  const decay = Math.exp((-Math.LN2 * dtMs) / SHIP_CORRECTION_HALF_LIFE_MS);
  correction.multiplyScalar(decay);
}

function updateShipMotionFromTelemetry(
  markerData: ShipMarkerData,
  measuredTarget: THREE.Vector3,
  measuredAtMs: number,
  sog: number,
  headingDeg: number,
  observedKnots?: number,
  observedCourseDeg?: number,
): void {
  const sampleTime = Math.max(0, measuredAtMs);
  const previousMotion = markerData.motion;
  if (sampleTime > previousMotion.anchorTimeMs) {
    previousMotion.prevAnchorPosition.copy(previousMotion.anchorPosition);
    previousMotion.prevAnchorTimeMs = previousMotion.anchorTimeMs;
  }
  const sanitizedSpeed = sanitizeShipSpeedKnots(sog, observedKnots);
  const sanitizedCourse = sanitizeCourseDeg(headingDeg, previousMotion.courseDeg, observedCourseDeg);
  const predictedAtSample = projectPositionFromCourseAndSpeed(
    previousMotion.anchorPosition,
    previousMotion.courseDeg,
    previousMotion.speedKnots,
    Math.min(Math.max(0, sampleTime - previousMotion.anchorTimeMs), SHIP_PREDICTION_MAX_MS),
  ).add(previousMotion.correction);

  const residual = measuredTarget.clone().sub(predictedAtSample);
  if (residual.lengthSq() > SHIP_POSITION_NOISE_RADIUS * SHIP_POSITION_NOISE_RADIUS) {
    previousMotion.correction.addScaledVector(residual, SHIP_CORRECTION_INJECT_GAIN);
    clampVectorLength(previousMotion.correction, SHIP_MAX_CORRECTION_UNITS);
  }
  previousMotion.anchorPosition.copy(measuredTarget);
  previousMotion.anchorTimeMs = sampleTime;
  previousMotion.speedKnots = sanitizedSpeed;
  previousMotion.courseDeg = sanitizedCourse;

  if (SHIP_MOTION_DEBUG && Number.isFinite(observedKnots) && Number.isFinite(observedCourseDeg)) {
    const courseDelta = angularDifferenceDeg(sanitizedCourse, observedCourseDeg!);
    const speedDelta = Math.abs(sanitizedSpeed - observedKnots!);
    const now = Date.now();
    const lastLogAt = shipMotionLastLogAt.get(markerData.mmsi) ?? 0;
    if (now - lastLogAt >= SHIP_MOTION_LOG_INTERVAL_MS) {
      const mismatch = courseDelta > 60 || speedDelta > 8;
      shipMotionLastLogAt.set(markerData.mmsi, now);
      console.info(mismatch ? "[ship-motion][mismatch]" : "[ship-motion]", {
        mmsi: markerData.mmsi,
        rawSog: sog,
        chosenSog: Number(sanitizedSpeed.toFixed(2)),
        observedSog: Number(observedKnots!.toFixed(2)),
        rawHeading: headingDeg,
        chosenCog: Number(sanitizedCourse.toFixed(1)),
        observedCog: Number(observedCourseDeg!.toFixed(1)),
        speedDelta: Number(speedDelta.toFixed(2)),
        courseDelta: Number(courseDelta.toFixed(1)),
      });
    }
  }
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

/* ── Ship Reconciliation (create/update/remove) ──────────────────────── */

export function reconcileShips(
  scene: THREE.Scene,
  ships: Map<number, ShipData>,
  shipMarkers: Map<number, ShipMesh>,
  hoveredShipRef: { current: ShipMesh | null },
  categoryTextures?: Record<ShipCategory, THREE.Texture>,
  passengerFerryPrototype?: THREE.Object3D,
  containerShipPrototype?: THREE.Object3D,
): void {
  const shipsEffectStart = performance.now();
  let skippedNoPosition = 0;
  let skippedOnLand = 0;
  let skippedByBudget = 0;
  let createdMarkers = 0;
  let updatedMarkers = 0;
  let hiddenByBoundary = 0;

  const nextShipIds = new Set<number>();
  const occupiedSlots: OccupiedSlot[] = [];
  const waterShips: ShipData[] = [];
  for (const ship of ships.values()) {
    if (ship.lat === 0 && ship.lon === 0) {
      skippedNoPosition += 1;
      continue;
    }
    const hasExistingMarker = shipMarkers.has(ship.mmsi);
    if (isPointOnLand(ship.lon, ship.lat) && !hasExistingMarker) {
      skippedOnLand += 1;
      continue;
    }
    waterShips.push(ship);
  }
  const orderedShips = waterShips.sort((a, b) => {
    const aMoving = sanitizeShipSpeedKnots(a.sog) > 1.2 ? 1 : 0;
    const bMoving = sanitizeShipSpeedKnots(b.sog) > 1.2 ? 1 : 0;
    if (aMoving !== bMoving) return bMoving - aMoving;
    const aLength = a.lengthM > 0 ? a.lengthM : 0;
    const bLength = b.lengthM > 0 ? b.lengthM : 0;
    if (aLength !== bLength) return bLength - aLength;
    return b.lastPositionUpdate - a.lastPositionUpdate;
  });
  if (orderedShips.length > SHIP_RENDER_LIMIT) {
    skippedByBudget = orderedShips.length - SHIP_RENDER_LIMIT;
  }
  const renderShips = orderedShips.slice(0, SHIP_RENDER_LIMIT);

  for (const ship of renderShips) {
    const mmsi = ship.mmsi;
    const category = getShipCategory(ship.shipType);
    const style = CATEGORY_STYLES[category];
    const radius = getShipCollisionRadius(ship, style);
    const sanitizedSog = sanitizeShipSpeedKnots(ship.sog);
    const isMoored = ship.navStatus === 5;
    const existing = shipMarkers.get(mmsi);
    const nextSizeScale = computeShipSizeScale(ship, style);
    const footprintRadius = getShipFootprintRadius(nextSizeScale);
    let placementTarget: THREE.Vector3 | null = null;
    let boundaryScale = 1;

    if (existing) {
      const markerData = getShipMarkerData(existing);
      const previousShip = markerData.ship;
      const needsPlacementResolve =
        markerData.hiddenByBoundary ||
        Math.abs(ship.lat - previousShip.lat) > SHIP_POSITION_RECONCILE_EPSILON ||
        Math.abs(ship.lon - previousShip.lon) > SHIP_POSITION_RECONCILE_EPSILON;

      if (isMoored || sanitizedSog <= 0) {
        placementTarget = markerData.target;
        boundaryScale = markerData.boundaryScale;
      } else if (needsPlacementResolve) {
        const baseTarget = latLonToWorld(ship.lat, ship.lon);
        // Moving vessels should follow telemetry directly; collision re-packing causes visible hopping.
        if (sanitizedSog > 1.2) {
          placementTarget = baseTarget;
          boundaryScale = markerData.boundaryScale;
        } else {
          const collisionPlacement = resolveShipTarget(baseTarget, mmsi, radius, footprintRadius, occupiedSlots);
          placementTarget = collisionPlacement.target;
          boundaryScale = collisionPlacement.boundaryScale;
        }
      } else {
        placementTarget = markerData.target;
        boundaryScale = markerData.boundaryScale;
      }

      markerData.ship = ship;
      markerData.radius = radius;
      markerData.boundaryScale = boundaryScale;
      if (!placementTarget) {
        markerData.invalidPositionStrikes += 1;
        if (markerData.invalidPositionStrikes < SHIP_INVALID_POSITION_HIDE_STRIKES) {
          placementTarget = markerData.target;
          markerData.hiddenByBoundary = false;
        } else {
          markerData.hiddenByBoundary = true;
        }
      } else {
        markerData.invalidPositionStrikes = 0;
        markerData.hiddenByBoundary = false;
      }
      markerData.nextBoundaryCheckAt = Date.now() + SHIP_BOUNDARY_RECHECK_INTERVAL_MS;
      if (placementTarget) {
        if (isMoored || sanitizedSog <= 0) {
          freezeShipMotion(existing, markerData);
        } else {
          const currentTelemetryWorld = latLonToWorld(ship.lat, ship.lon);
          const prevTelemetryWorld = latLonToWorld(previousShip.lat, previousShip.lon);
          const telemetryDtMs = Math.max(750, ship.lastPositionUpdate - previousShip.lastPositionUpdate);
          const observedKnots = estimateObservedSpeedKnots(prevTelemetryWorld, currentTelemetryWorld, telemetryDtMs);
          const observedCourseDeg = estimateObservedCourseDeg(prevTelemetryWorld, currentTelemetryWorld) ?? undefined;
          updateShipMotionFromTelemetry(
            markerData,
            placementTarget,
            ship.lastPositionUpdate,
            ship.sog,
            ship.heading,
            observedKnots,
            observedCourseDeg,
          );
        }
      }

      const needsGeometryRefresh =
        markerData.category !== category || Math.abs(markerData.sizeScale - nextSizeScale) > 0.04;
      const needsVisualRefresh =
        needsGeometryRefresh ||
        needsShipCategoryVisualRefresh(
          existing,
          category,
          categoryTextures,
          passengerFerryPrototype,
          containerShipPrototype,
        );
      const hasDetailMesh = existing.children.some((child) => child.name === SHIP_DETAIL_NAME);
      const wantsDetailMesh = shouldRenderShipDetail(category, passengerFerryPrototype, containerShipPrototype);
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
      const rendersAsModel = shouldUseShipModel(category, passengerFerryPrototype, containerShipPrototype);
      existing.material.opacity = rendersAsModel ? 0 : 1;
      markerData.wakeWidth = style.wakeWidth;
      markerData.wakeLength = style.wakeLength;

      if (needsDetailRefresh) {
        syncShipDetailMesh(existing, category, nextSizeScale, nextColor, passengerFerryPrototype, containerShipPrototype);
      }
      if (needsVisualRefresh) {
        removeShipCategoryVisual(existing);
        const nextVisual = createShipCategoryVisual(
          category,
          nextSizeScale,
          categoryTextures,
          passengerFerryPrototype,
          containerShipPrototype,
        );
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

    const baseTarget = latLonToWorld(ship.lat, ship.lon);
    const collisionPlacement = resolveShipTarget(baseTarget, mmsi, radius, footprintRadius, occupiedSlots);
    placementTarget = collisionPlacement.target;
    boundaryScale = collisionPlacement.boundaryScale;

    // New ship — render only when direct placement is valid.
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
      opacity: shouldUseShipModel(category, passengerFerryPrototype, containerShipPrototype) ? 0 : 1,
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
    wake.position.set(0, -SHIP_BASE_Y + WAKE_WORLD_Y, -4);
    wake.rotation.y = Math.PI;
    wake.renderOrder = 4;
    hull.add(wake);

    syncShipDetailMesh(hull, category, nextSizeScale, hullColor, passengerFerryPrototype, containerShipPrototype);

    const categoryVisual = createShipCategoryVisual(
      category,
      nextSizeScale,
      categoryTextures,
      passengerFerryPrototype,
      containerShipPrototype,
    );
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
      motion: {
        prevAnchorPosition: spawnTarget.clone(),
        prevAnchorTimeMs: ship.lastPositionUpdate,
        anchorPosition: spawnTarget.clone(),
        anchorTimeMs: ship.lastPositionUpdate,
        correction: new THREE.Vector3(),
        speedKnots: sanitizeShipSpeedKnots(ship.sog),
        courseDeg: sanitizeCourseDeg(ship.heading, ship.cog),
        lastAnimateTimeMs: Date.now(),
      },
      wake,
      baseColor: hullColor.clone(),
      category,
      radius,
      wakeWidth: style.wakeWidth,
      wakeLength: style.wakeLength,
      sizeScale: nextSizeScale,
      boundaryScale,
      hiddenByBoundary: false,
      invalidPositionStrikes: 0,
      nextBoundaryCheckAt: Date.now() + SHIP_BOUNDARY_RECHECK_INTERVAL_MS,
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
      skippedOnLand,
      skippedByBudget,
      createdMarkers,
      updatedMarkers,
      hiddenByBoundary,
    });
  }
}

/* ── Per-Frame Ship Animation ────────────────────────────────────────── */
// Knots → world units per millisecond conversion
// 1 knot = 1.852 km/h = 0.0005144 m/s; scaled to world units
const KNOTS_TO_WORLD_PER_MS = (0.0005144 * WORLD_UNITS_PER_METER);

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
    const sanitizedSog = sanitizeShipSpeedKnots(ship.sog);
    const isAnchored = ship.navStatus === 1;
    const isMoored = ship.navStatus === 5;
    const isMoving = sanitizedSog > 2.4;
    const currentEffectiveScale = marker.scale.x || 1;
    const currentZoomScale = currentEffectiveScale / Math.max(markerData.boundaryScale, 0.1);
    const blendedVisualScale = THREE.MathUtils.lerp(currentZoomScale, zoomScale, 0.35);
    marker.scale.setScalar(blendedVisualScale * markerData.boundaryScale);
    const motion = markerData.motion;
    const frameDt = Math.max(0, now - motion.lastAnimateTimeMs);
    const elapsedSinceAnchor = Math.min(
      Math.max(0, now - motion.anchorTimeMs),
      SHIP_PREDICTION_MAX_MS,
    );
    const predicted = projectPositionFromCourseAndSpeed(
      motion.anchorPosition,
      motion.courseDeg,
      motion.speedKnots,
      elapsedSinceAnchor,
    );
    applyExponentialCorrectionDecay(motion.correction, frameDt);
    motion.lastAnimateTimeMs = now;
    const desiredTarget = predicted.add(motion.correction);
    const targetAlpha = 1 - Math.exp(-frameDt / SHIP_TARGET_DAMPING_TAU_MS);
    markerData.target.lerp(desiredTarget, THREE.MathUtils.clamp(targetAlpha, 0, 1));

    const boundaryRecheckInterval = isMoving
      ? SHIP_BOUNDARY_RECHECK_MOVING_INTERVAL_MS
      : SHIP_BOUNDARY_RECHECK_INTERVAL_MS;
    if (!Number.isFinite(markerData.nextBoundaryCheckAt)) {
      markerData.nextBoundaryCheckAt = now;
    }
    if (now >= markerData.nextBoundaryCheckAt) {
      markerData.nextBoundaryCheckAt = now + boundaryRecheckInterval;
      const runtimeFootprint = getShipFootprintRadius(markerData.sizeScale);
      if (!isWorldCircleNavigable(markerData.target.x, markerData.target.z, runtimeFootprint * markerData.boundaryScale)) {
        markerData.invalidPositionStrikes += 1;
        if (markerData.invalidPositionStrikes >= SHIP_INVALID_POSITION_HIDE_STRIKES) {
          markerData.hiddenByBoundary = true;
          marker.visible = false;
          markerData.wake.visible = false;
          continue;
        }
      } else {
        markerData.invalidPositionStrikes = 0;
        markerData.hiddenByBoundary = false;
      }
    }

    const positionTau = isMoving && !isMoored ? SHIP_POSITION_DAMPING_TAU_MOVING_MS : SHIP_POSITION_DAMPING_TAU_IDLE_MS;
    const positionAlpha = 1 - Math.exp(-frameDt / positionTau);
    marker.position.lerp(markerData.target, THREE.MathUtils.clamp(positionAlpha, 0, 1));

    // Bobbing for anchored/moored vessels
    const bob = (isAnchored || isMoored)
      ? Math.sin(t * 2 + (markerData.mmsi % 11)) * (isAnchored ? 0.8 : 0.4)
      : 0;
    marker.position.y = SHIP_BASE_Y + bob;

    // Heading
    marker.rotation.y = THREE.MathUtils.lerp(
      marker.rotation.y,
      (-ship.heading * Math.PI) / 180,
      0.1,
    );

    // Wake
    const wake = markerData.wake;
    wake.visible = marker.visible && isMoving && !isMoored && hasVisibleShipBody(marker);
    const wakeScaleBase = markerData.sizeScale * markerData.boundaryScale;
    wake.scale.x = markerData.wakeWidth * wakeScaleBase * (0.24 + Math.min(sanitizedSog / 34, 0.24));
    wake.scale.z = markerData.wakeLength * wakeScaleBase * (0.2 + Math.min(sanitizedSog / 30, 0.22));
    wake.material.opacity = WAKE_BASE_OPACITY + Math.min(sanitizedSog / 55, 0.14);
  }
}
