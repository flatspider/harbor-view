import * as THREE from "three";
import type { AircraftData } from "../types/aircraft";
import { getAircraftSizeClass, type AircraftSizeClass } from "../types/aircraft";
import { latLonToWorld, WORLD_UNITS_PER_METER, PERF_DEBUG } from "./constants";
import { toonGradient } from "./toonGradient";

/* ── Constants ─────────────────────────────────────────────────────────── */

const AIRCRAFT_BASE_COLOR = "#e8e0d0";
const AIRCRAFT_ACCENT_COLOR = "#c44d4d";
const AIRCRAFT_STALE_MS = 30_000;
const AIRCRAFT_PREDICTION_MAX_MS = 30_000;
const AIRCRAFT_CORRECTION_HALF_LIFE_MS = 1_900;

// Knots to world units per millisecond
const KNOTS_TO_WORLD_PER_MS = 0.0005144 * WORLD_UNITS_PER_METER;

// Size multipliers by class
const SIZE_SCALES: Record<AircraftSizeClass, number> = {
  light: 0.6,
  medium: 1.0,
  heavy: 1.5,
};

/* ── Altitude Compression ──────────────────────────────────────────────── */

/**
 * Convert barometric altitude (feet) to world-space Y using logarithmic compression.
 *
 * Target mapping:
 *   1,000 ft  ->  ~25y
 *   5,000 ft  ->  ~45y
 *  35,000 ft  ->  ~120y
 */
function altitudeToWorldY(altFeet: number): number {
  const clampedAlt = Math.max(altFeet, 100);
  // log(100) ~= 4.6, log(35000) ~= 10.5
  // Map that to roughly 15..120 range
  const logAlt = Math.log(clampedAlt);
  const minLog = Math.log(100);
  const maxLog = Math.log(40000);
  const t = (logAlt - minLog) / (maxLog - minLog);
  return 15 + t * 110;
}

/* ── Geometry Factory ──────────────────────────────────────────────────── */

/**
 * Procedural Ghibli-style airplane mesh.
 * Simple shapes: fuselage cylinder, wing box, tail fin, engine accents.
 */
function createAirplaneGroup(sizeClass: AircraftSizeClass): THREE.Group {
  const scale = SIZE_SCALES[sizeClass];
  const group = new THREE.Group();

  const bodyColor = new THREE.Color(AIRCRAFT_BASE_COLOR);
  const accentColor = new THREE.Color(AIRCRAFT_ACCENT_COLOR);

  const bodyMaterial = new THREE.MeshToonMaterial({
    color: bodyColor,
    gradientMap: toonGradient,
  });
  const accentMaterial = new THREE.MeshToonMaterial({
    color: accentColor,
    gradientMap: toonGradient,
  });

  // Fuselage — elongated cylinder along Z axis
  const fuselageLength = 5 * scale;
  const fuselageRadius = 0.6 * scale;
  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(fuselageRadius * 0.5, fuselageRadius, fuselageLength, 8),
    bodyMaterial,
  );
  fuselage.rotation.x = Math.PI / 2;
  group.add(fuselage);

  // Wings — flat box spanning perpendicular to fuselage
  const wingSpan = 7 * scale;
  const wingDepth = 1.8 * scale;
  const wingThickness = 0.2 * scale;
  const wings = new THREE.Mesh(
    new THREE.BoxGeometry(wingSpan, wingThickness, wingDepth),
    bodyMaterial,
  );
  wings.position.set(0, 0, -0.3 * scale);
  group.add(wings);

  // Tail vertical stabilizer
  const tailHeight = 1.4 * scale;
  const tailDepth = 1.0 * scale;
  const tailThickness = 0.15 * scale;
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(tailThickness, tailHeight, tailDepth),
    accentMaterial,
  );
  tail.position.set(0, tailHeight * 0.4, -fuselageLength * 0.42);
  group.add(tail);

  // Horizontal stabilizer
  const hStabSpan = 2.5 * scale;
  const hStab = new THREE.Mesh(
    new THREE.BoxGeometry(hStabSpan, wingThickness * 0.8, tailDepth * 0.8),
    bodyMaterial,
  );
  hStab.position.set(0, 0.15 * scale, -fuselageLength * 0.42);
  group.add(hStab);

  // Engine pods (only for medium and heavy)
  if (sizeClass !== "light") {
    const engineRadius = 0.35 * scale;
    const engineLength = 1.2 * scale;
    const engineGeometry = new THREE.CylinderGeometry(engineRadius, engineRadius, engineLength, 8);

    const leftEngine = new THREE.Mesh(engineGeometry, accentMaterial);
    leftEngine.rotation.x = Math.PI / 2;
    leftEngine.position.set(-1.6 * scale, -0.3 * scale, 0.1 * scale);
    group.add(leftEngine);

    const rightEngine = new THREE.Mesh(engineGeometry, accentMaterial);
    rightEngine.rotation.x = Math.PI / 2;
    rightEngine.position.set(1.6 * scale, -0.3 * scale, 0.1 * scale);
    group.add(rightEngine);

    // Heavy aircraft get two more engines
    if (sizeClass === "heavy") {
      const outerLeft = new THREE.Mesh(engineGeometry, accentMaterial);
      outerLeft.rotation.x = Math.PI / 2;
      outerLeft.position.set(-2.8 * scale, -0.3 * scale, 0.3 * scale);
      group.add(outerLeft);

      const outerRight = new THREE.Mesh(engineGeometry, accentMaterial);
      outerRight.rotation.x = Math.PI / 2;
      outerRight.position.set(2.8 * scale, -0.3 * scale, 0.3 * scale);
      group.add(outerRight);
    }
  }

  return group;
}

/* ── Marker Data Type ──────────────────────────────────────────────────── */

export interface AircraftMarkerData {
  isAircraftMarker: true;
  hex: string;
  aircraft: AircraftData;
  target: THREE.Vector3;
  motion: {
    anchorPosition: THREE.Vector3;
    anchorTimeMs: number;
    correction: THREE.Vector3;
    speedKnots: number;
    courseDeg: number;
    lastAnimateTimeMs: number;
  };
  sizeClass: AircraftSizeClass;
}

export type AircraftMarker = THREE.Group;

function getAircraftMarkerData(group: THREE.Object3D): AircraftMarkerData {
  return group.userData as AircraftMarkerData;
}

function projectPositionFromCourseAndSpeed(
  anchor: THREE.Vector3,
  courseDeg: number,
  speedKnots: number,
  elapsedMs: number,
): THREE.Vector3 {
  if (speedKnots <= 0 || elapsedMs <= 0) return anchor.clone();
  const courseRad = (courseDeg * Math.PI) / 180;
  const distanceUnits = speedKnots * KNOTS_TO_WORLD_PER_MS * elapsedMs;
  return new THREE.Vector3(
    anchor.x - Math.sin(courseRad) * distanceUnits,
    anchor.y,
    anchor.z + Math.cos(courseRad) * distanceUnits,
  );
}

function applyExponentialCorrectionDecay(correction: THREE.Vector3, dtMs: number): void {
  if (dtMs <= 0) return;
  const decay = Math.exp((-Math.LN2 * dtMs) / AIRCRAFT_CORRECTION_HALF_LIFE_MS);
  correction.multiplyScalar(decay);
}

function updateAircraftMotionFromTelemetry(
  data: AircraftMarkerData,
  measuredTarget: THREE.Vector3,
  measuredAtMs: number,
  speedKnots: number,
  trackDeg: number,
): void {
  const sampleTime = Math.max(0, measuredAtMs);
  const previousMotion = data.motion;
  const predictedAtSample = projectPositionFromCourseAndSpeed(
    previousMotion.anchorPosition,
    previousMotion.courseDeg,
    previousMotion.speedKnots,
    Math.min(Math.max(0, sampleTime - previousMotion.anchorTimeMs), AIRCRAFT_PREDICTION_MAX_MS),
  ).add(previousMotion.correction);

  const residual = measuredTarget.clone().sub(predictedAtSample);
  previousMotion.correction.add(residual);
  previousMotion.anchorPosition.copy(measuredTarget);
  previousMotion.anchorTimeMs = sampleTime;
  previousMotion.speedKnots = Math.max(0, speedKnots);
  previousMotion.courseDeg = Number.isFinite(trackDeg) ? trackDeg : previousMotion.courseDeg;
}

/* ── Reconciliation ────────────────────────────────────────────────────── */

export function reconcileAircraft(
  scene: THREE.Scene,
  aircraftMap: Map<string, AircraftData>,
  markers: Map<string, AircraftMarker>,
): void {
  const reconcileStart = performance.now();
  let created = 0;
  let updated = 0;

  const nextHexes = new Set<string>();

  for (const ac of aircraftMap.values()) {
    const hex = ac.hex;
    nextHexes.add(hex);

    const existing = markers.get(hex);
    const sizeClass = getAircraftSizeClass(ac.category);

    if (existing) {
      const data = getAircraftMarkerData(existing);
      data.aircraft = ac;

      // Update target position
      const worldPos = latLonToWorld(ac.lat, ac.lon);
      const measuredTarget = new THREE.Vector3(worldPos.x, altitudeToWorldY(ac.alt_baro), worldPos.z);
      updateAircraftMotionFromTelemetry(data, measuredTarget, ac.lastSeen, ac.gs, ac.track);
      data.target.copy(measuredTarget);

      // Rebuild geometry if size class changed
      if (data.sizeClass !== sizeClass) {
        data.sizeClass = sizeClass;
        // Remove old children and rebuild
        while (existing.children.length > 0) {
          const child = existing.children[0];
          existing.remove(child);
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
          }
        }
        const newGroup = createAirplaneGroup(sizeClass);
        for (const child of [...newGroup.children]) {
          newGroup.remove(child);
          existing.add(child);
        }
      }

      updated += 1;
      continue;
    }

    // New aircraft — create marker
    const worldPos = latLonToWorld(ac.lat, ac.lon);
    const targetY = altitudeToWorldY(ac.alt_baro);
    const target = new THREE.Vector3(worldPos.x, targetY, worldPos.z);

    const group = createAirplaneGroup(sizeClass);
    group.position.copy(target);
    group.userData = {
      isAircraftMarker: true,
      hex,
      aircraft: ac,
      target: target.clone(),
      motion: {
        anchorPosition: target.clone(),
        anchorTimeMs: ac.lastSeen,
        correction: new THREE.Vector3(),
        speedKnots: Math.max(0, ac.gs),
        courseDeg: Number.isFinite(ac.track) ? ac.track : 0,
        lastAnimateTimeMs: Date.now(),
      },
      sizeClass,
    } as AircraftMarkerData;

    scene.add(group);
    markers.set(hex, group);
    created += 1;
  }

  // Remove stale markers
  for (const [hex, marker] of markers.entries()) {
    if (nextHexes.has(hex)) continue;
    scene.remove(marker);
    marker.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        for (const mat of child.material) mat.dispose();
        return;
      }
      if (child.material instanceof THREE.Material) child.material.dispose();
    });
    markers.delete(hex);
  }

  const reconcileMs = performance.now() - reconcileStart;
  if (PERF_DEBUG) {
    if (reconcileMs > 8) {
      console.debug("[perf] aircraft reconcile", { ms: Number(reconcileMs.toFixed(2)), count: aircraftMap.size });
    }
    console.debug("[perf] aircraft visibility", {
      apiAircraft: aircraftMap.size,
      rendered: nextHexes.size,
      created,
      updated,
    });
  }
}

/* ── Per-Frame Animation ───────────────────────────────────────────────── */

export function animateAircraft(
  markers: Map<string, AircraftMarker>,
  t: number,
  zoomScale = 1,
): void {
  const now = Date.now();

  for (const marker of markers.values()) {
    const data = getAircraftMarkerData(marker);
    const ac = data.aircraft;

    // Hide stale aircraft
    if (now - ac.lastSeen > AIRCRAFT_STALE_MS) {
      marker.visible = false;
      continue;
    }
    marker.visible = true;

    const motion = data.motion;
    const elapsedSinceAnchor = Math.min(
      Math.max(0, now - motion.anchorTimeMs),
      AIRCRAFT_PREDICTION_MAX_MS,
    );
    const predicted = projectPositionFromCourseAndSpeed(
      motion.anchorPosition,
      motion.courseDeg,
      motion.speedKnots,
      elapsedSinceAnchor,
    );
    const frameDt = Math.max(0, now - motion.lastAnimateTimeMs);
    applyExponentialCorrectionDecay(motion.correction, frameDt);
    motion.lastAnimateTimeMs = now;
    data.target.copy(predicted.add(motion.correction));

    marker.position.lerp(data.target, 0.16);

    // Heading — rotate to face direction of travel
    // Track is clockwise from north, Three.js Y rotation is CCW
    marker.rotation.y = THREE.MathUtils.lerp(marker.rotation.y, (-ac.track * Math.PI) / 180, 0.22);

    // Gentle banking animation for flavor
    const bankAngle = Math.sin(t * 0.5 + (ac.hex.charCodeAt(0) % 13)) * 0.04;
    marker.rotation.z = bankAngle;

    // Scale by zoom
    const sizeScale = SIZE_SCALES[data.sizeClass];
    const visualScale = sizeScale * zoomScale * 0.8;
    marker.scale.setScalar(visualScale);
  }
}
