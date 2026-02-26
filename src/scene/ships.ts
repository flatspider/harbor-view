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
  const detailMaterial = new THREE.MeshStandardMaterial({
    color: hullColor.clone().offsetHSL(0, -0.08, 0.18),
    roughness: 0.5,
    metalness: 0.14,
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

/* ── Ship Sizing & Collision ─────────────────────────────────────────── */

export function computeShipSizeScale(ship: ShipData, style: ShipCategoryStyle): number {
  const lengthM = ship.lengthM > 0 ? ship.lengthM : 110;
  const beamM = ship.beamM > 0 ? ship.beamM : 18;
  const targetLengthUnits = lengthM * WORLD_UNITS_PER_METER;
  const targetBeamUnits = beamM * WORLD_UNITS_PER_METER;
  const fromLength = targetLengthUnits / 22;
  const fromBeam = targetBeamUnits / 8;
  const blended = fromLength * 0.75 + fromBeam * 0.25;
  return Math.min(Math.max(blended * style.scale, 0.22), 1.1);
}

export function getShipCollisionRadius(ship: ShipData, style: ShipCategoryStyle): number {
  const length = ship.lengthM > 0 ? ship.lengthM : 85;
  const beam = ship.beamM > 0 ? ship.beamM : 18;
  const scaledHull = (length * 0.05 + beam * 0.22) * style.scale;
  return Math.min(Math.max(scaledHull, 16), 60);
}

function isWorldPointNavigable(x: number, z: number): boolean {
  const lonLat = worldToLonLat(x, z);
  if (!lonLat) return false;
  return !isPointOnLand(lonLat.lon, lonLat.lat);
}

export function resolveShipTarget(
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

/* ── Ship Reconciliation (create/update/remove) ──────────────────────── */

export function reconcileShips(
  scene: THREE.Scene,
  ships: Map<number, ShipData>,
  shipMarkers: Map<number, ShipMesh>,
  hoveredShipRef: { current: ShipMesh | null },
): void {
  const shipsEffectStart = performance.now();
  let skippedNoPosition = 0;
  let fallbackPlacements = 0;
  let createdMarkers = 0;
  let updatedMarkers = 0;

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

    if (existing) {
      const markerData = getShipMarkerData(existing);
      markerData.ship = ship;
      markerData.radius = radius;
      const nextTarget = isPointOnLand(ship.lon, ship.lat) ? markerData.target : baseTarget;
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
          hitArea.geometry = new THREE.SphereGeometry(
            Math.max(6, Math.min(24, ship.lengthM > 0 ? ship.lengthM * WORLD_UNITS_PER_METER * 0.35 : 9)),
            12,
            12,
          );
        }
      }

      nextShipIds.add(mmsi);
      occupiedSlots.push({ mmsi, radius, x: nextTarget.x, z: nextTarget.z });
      updatedMarkers += 1;
      continue;
    }

    // New ship — resolve collision-free placement
    const resolvedTarget = resolveShipTarget(baseTarget, mmsi, radius, occupiedSlots);
    const spawnTarget = resolvedTarget ?? baseTarget;
    if (!resolvedTarget) fallbackPlacements += 1;

    const hullGeometry = createShipGeometry(category, nextSizeScale);
    const hullColor = new THREE.Color(style.color);
    const hull = new THREE.Mesh(
      hullGeometry,
      new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.55, metalness: 0.2 }),
    ) as ShipMesh;
    hull.castShadow = true;
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

    const detail = createShipDetailMesh(category, nextSizeScale, hullColor);
    detail.name = "ship-detail";
    hull.add(detail);

    const hitArea = new THREE.Mesh(
      new THREE.SphereGeometry(
        Math.max(6, Math.min(24, ship.lengthM > 0 ? ship.lengthM * WORLD_UNITS_PER_METER * 0.35 : 9)),
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
    scene.remove(marker);
    if (hoveredShipRef.current === marker) hoveredShipRef.current = null;
    marker.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
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
    const ship = markerData.ship;
    const isAnchored = ship.navStatus === 1;
    const isMoored = ship.navStatus === 5;
    const isMoving = ship.sog > 2.4;
    const blendedVisualScale = THREE.MathUtils.lerp(marker.scale.x || 1, zoomScale, 0.18);
    marker.scale.setScalar(blendedVisualScale);

    // ── Time-based interpolation + dead reckoning ──
    if (isMoving && !isMoored) {
      const elapsed = now - ship.lastPositionUpdate;
      const interpT = Math.min(elapsed / AIS_UPDATE_INTERVAL_MS, 1);

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

      // Smooth approach to interpolated target
      marker.position.lerp(markerData.target, 0.2);
    } else {
      // Stationary: gently approach target
      marker.position.lerp(markerData.target, isMoored ? 0.08 : 0.12);
    }

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
    const wakeScaleBase = Math.max(markerData.sizeScale, 0.28);
    wake.scale.x = markerData.wakeWidth * wakeScaleBase * (0.58 + Math.min(ship.sog / 13, 1.05));
    wake.scale.z = markerData.wakeLength * wakeScaleBase * (0.72 + Math.min(ship.sog / 11, 1.24));
    wake.material.opacity = WAKE_BASE_OPACITY + Math.min(ship.sog / 55, 0.14);
  }
}
