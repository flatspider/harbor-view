import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import type { HarborEnvironment } from "../types/environment";
import { landPolygonRings, isPointOnLand } from "./land";
import { TILE_SIZE, WORLD_WIDTH, WORLD_DEPTH, latLonToWorld, worldToLonLat, setVisibleStable, type WaterTile } from "./constants";

interface ShaderWaterTile {
  mesh: Water;
  baseX: number;
  baseZ: number;
  lightnessOffset: number;
  normalTexture: THREE.Texture;
}

interface WaterUniforms {
  time: { value: number };
  size: { value: number };
  distortionScale: { value: number };
  waterColor: { value: THREE.Color };
  sunColor: { value: THREE.Color };
  sunDirection: { value: THREE.Vector3 };
}

interface CurrentArrowSample {
  helper: THREE.ArrowHelper;
  x: number;
  z: number;
}

interface FlowCell {
  x: number;
  z: number;
  radius: number;
  strength: number;
  clockwise: boolean;
}

interface WaterBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const shaderTiles: ShaderWaterTile[] = [];
const currentArrowSamples: CurrentArrowSample[] = [];
const currentArrowGroup = new THREE.Group();
let _resinBacking: THREE.Mesh | null = null;

const _sunDirection = new THREE.Vector3();
const _waterColor = new THREE.Color();
const _normalDrift = new THREE.Vector2(0, 0);
const _baseCurrentDirection = new THREE.Vector2();
const _perpCurrentDirection = new THREE.Vector2();
const _flowScratch = new THREE.Vector2();
const _flowScratchA = new THREE.Vector2();
const _flowScratchB = new THREE.Vector2();
const _directionScratch3 = new THREE.Vector3();

let _lastCurrentTime = 0;
let _landMaskApplied = false;
let _nextLandMaskProbeAt = 0;
let _waterShaderTime = 0;

const WATER_NORMALS_URL = "https://threejs.org/examples/textures/waternormals.jpg";
const WATER_SURFACE_Y = -1;
const WATER_RESIN_DEPTH = 1.8;
const LAND_MASK_DEPTH = 2.2;
const LAND_MASK_POLL_SECONDS = 1.2;
const CURRENT_ARROW_SPACING = 170;
const CURRENT_ARROW_Y_OFFSET = 1.5;
const MAX_ARROW_COUNT = 140;
const MIN_ARROW_SPEED = 0.14;
const FLOW_CELLS: FlowCell[] = [
  { x: WORLD_WIDTH * -0.18, z: WORLD_DEPTH * -0.2, radius: 360, strength: 0.5, clockwise: true },
  { x: WORLD_WIDTH * 0.16, z: WORLD_DEPTH * -0.06, radius: 320, strength: 0.42, clockwise: false },
  { x: WORLD_WIDTH * 0.04, z: WORLD_DEPTH * 0.18, radius: 280, strength: 0.36, clockwise: true },
];

const WATER_EDGE_MARGIN = 140;
const WATER_SUBDIVISIONS_PER_TILE = 18;
const MIN_WATER_SUBDIVISIONS = 48;
const FORCE_TEST_CURRENT = false;
const FORCED_CURRENT_KNOTS = 15;
const FORCED_CURRENT_DIRECTION_DEG = 0;
const UV_DRIFT_PER_KNOT = 0.00135;
const DAY_WATER_SUN_DIRECTION = new THREE.Vector3(-400, 300, -350).normalize();
const NIGHT_WATER_SUN_DIRECTION = new THREE.Vector3(-220, 260, -180).normalize();
const DAY_WATER_SUN_COLOR = "#ffe0b2";
const NIGHT_WATER_SUN_COLOR = "#9caec9";

function createWaterNormalsTexture(): THREE.Texture {
  const texture = new THREE.TextureLoader().load(WATER_NORMALS_URL);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function getWaterBounds(): WaterBounds {
  const worldMinX = -WORLD_WIDTH * 0.5;
  const worldMaxX = WORLD_WIDTH * 0.5;
  const worldMinZ = -WORLD_DEPTH * 0.5;
  const worldMaxZ = WORLD_DEPTH * 0.5;

  if (landPolygonRings.length === 0) {
    return { minX: worldMinX, maxX: worldMaxX, minZ: worldMinZ, maxZ: worldMaxZ };
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of landPolygonRings) {
    if (ring.minLon < minLon) minLon = ring.minLon;
    if (ring.maxLon > maxLon) maxLon = ring.maxLon;
    if (ring.minLat < minLat) minLat = ring.minLat;
    if (ring.maxLat > maxLat) maxLat = ring.maxLat;
  }

  if (!Number.isFinite(minLon) || !Number.isFinite(maxLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
    return { minX: worldMinX, maxX: worldMaxX, minZ: worldMinZ, maxZ: worldMaxZ };
  }

  const westX = latLonToWorld(minLat, minLon).x;
  const eastX = latLonToWorld(minLat, maxLon).x;
  const southZ = latLonToWorld(minLat, minLon).z;
  const northZ = latLonToWorld(maxLat, minLon).z;

  return {
    minX: Math.min(worldMinX, westX, eastX) - WATER_EDGE_MARGIN,
    maxX: Math.max(worldMaxX, westX, eastX) + WATER_EDGE_MARGIN,
    minZ: Math.min(worldMinZ, southZ, northZ) - WATER_EDGE_MARGIN,
    maxZ: Math.max(worldMaxZ, southZ, northZ) + WATER_EDGE_MARGIN,
  };
}

function isLandAtWorldPoint(x: number, z: number, outOfBoundsIsLand = true): boolean {
  const lonLat = worldToLonLat(x, z);
  if (!lonLat) return outOfBoundsIsLand;
  return isPointOnLand(lonLat.lon, lonLat.lat);
}

function getCoastAttenuation(x: number, z: number, flow: THREE.Vector2): number {
  if (landPolygonRings.length === 0) return 1;
  if (isLandAtWorldPoint(x, z)) return 0;

  const dir = flow.lengthSq() > 0.0001 ? flow.clone().normalize() : _baseCurrentDirection;
  const side = _perpCurrentDirection.set(-dir.y, dir.x);

  let blockedWeight = 0;
  const front20X = x + dir.x * 20;
  const front20Z = z + dir.y * 20;
  const front40X = x + dir.x * 40;
  const front40Z = z + dir.y * 40;
  const left30X = x + side.x * 30;
  const left30Z = z + side.y * 30;
  const right30X = x - side.x * 30;
  const right30Z = z - side.y * 30;

  if (isLandAtWorldPoint(front20X, front20Z)) blockedWeight += 0.24;
  if (isLandAtWorldPoint(front40X, front40Z)) blockedWeight += 0.36;
  if (isLandAtWorldPoint(left30X, left30Z)) blockedWeight += 0.2;
  if (isLandAtWorldPoint(right30X, right30Z)) blockedWeight += 0.2;

  return THREE.MathUtils.clamp(1 - blockedWeight, 0.05, 1);
}

function computeFlowVectorAt(
  x: number,
  z: number,
  env: HarborEnvironment,
  t: number,
  out: THREE.Vector2,
): THREE.Vector2 {
  const headingRad = THREE.MathUtils.degToRad(env.currentDirectionDeg);
  _baseCurrentDirection.set(-Math.sin(headingRad), Math.cos(headingRad));

  const baseSpeed = Math.max(0, env.currentSpeedKnots) * 0.09;
  if (FORCE_TEST_CURRENT) {
    out.copy(_baseCurrentDirection).multiplyScalar(baseSpeed);
    const coastAttenuation = getCoastAttenuation(x, z, out);
    out.multiplyScalar(coastAttenuation);
    return out;
  }

  const alongWave = Math.sin((x + z) * 0.0024 + t * 0.24);
  const crossWave = Math.cos((x - z) * 0.0028 - t * 0.18);
  const ambroseBand = Math.exp(-Math.pow((z + WORLD_DEPTH * 0.22) / (WORLD_DEPTH * 0.15), 2)) * 0.26;
  const northChannelBand = Math.exp(
    -Math.pow((x - WORLD_WIDTH * 0.06) / (WORLD_WIDTH * 0.18), 2) -
      Math.pow((z - WORLD_DEPTH * 0.12) / (WORLD_DEPTH * 0.2), 2),
  ) * 0.2;
  const corridorBoost = 1 + ambroseBand + northChannelBand;

  out.copy(_baseCurrentDirection).multiplyScalar(baseSpeed * corridorBoost * (1 + alongWave * 0.15));
  _perpCurrentDirection
    .set(-_baseCurrentDirection.y, _baseCurrentDirection.x)
    .multiplyScalar(baseSpeed * crossWave * 0.22);
  out.add(_perpCurrentDirection);
  out.x += Math.sin(z * 0.004 + t * 0.13) * baseSpeed * 0.14;
  out.y += Math.cos(x * 0.003 - t * 0.1) * baseSpeed * 0.1;

  for (const cell of FLOW_CELLS) {
    const dx = x - cell.x;
    const dz = z - cell.z;
    const radiusSq = cell.radius * cell.radius;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radiusSq || distSq < 1) continue;

    const dist = Math.sqrt(distSq);
    const falloff = (1 - dist / cell.radius) ** 2;
    const swirl = cell.strength * baseSpeed * falloff;
    const invDist = 1 / dist;
    const tangentX = cell.clockwise ? dz * invDist : -dz * invDist;
    const tangentZ = cell.clockwise ? -dx * invDist : dx * invDist;
    out.x += tangentX * swirl;
    out.y += tangentZ * swirl;
  }

  const coastAttenuation = getCoastAttenuation(x, z, out);
  out.multiplyScalar(coastAttenuation);
  return out;
}

function applyLandMaskToTile(tile: ShaderWaterTile): void {
  const geometry = tile.mesh.geometry;
  const position = geometry.attributes.position as THREE.BufferAttribute;
  let changed = false;

  for (let i = 0; i < position.count; i += 1) {
    const localX = position.getX(i);
    const localY = position.getY(i);
    const worldX = tile.baseX + localX;
    const worldZ = tile.baseZ - localY;
    const nextZ = isLandAtWorldPoint(worldX, worldZ, false) ? -LAND_MASK_DEPTH : 0;
    if (position.getZ(i) !== nextZ) {
      position.setZ(i, nextZ);
      changed = true;
    }
  }

  if (!changed) return;

  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function maybeApplyLandMask(nowSeconds: number): void {
  if (_landMaskApplied) return;
  if (nowSeconds < _nextLandMaskProbeAt) return;
  _nextLandMaskProbeAt = nowSeconds + LAND_MASK_POLL_SECONDS;
  if (landPolygonRings.length === 0) return;

  for (const tile of shaderTiles) applyLandMaskToTile(tile);
  _landMaskApplied = true;
}

function createCurrentArrows(scene: THREE.Scene, minX: number, maxX: number, minZ: number, maxZ: number): void {
  currentArrowSamples.length = 0;
  currentArrowGroup.clear();
  currentArrowGroup.renderOrder = 10;

  const arrowColor = new THREE.Color("#E77B5A");

  for (let x = minX + CURRENT_ARROW_SPACING * 0.5; x < maxX; x += CURRENT_ARROW_SPACING) {
    for (let z = minZ + CURRENT_ARROW_SPACING * 0.5; z < maxZ; z += CURRENT_ARROW_SPACING) {
      if (currentArrowSamples.length >= MAX_ARROW_COUNT) break;
      if (landPolygonRings.length > 0 && isLandAtWorldPoint(x, z)) continue;

      const helper = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(x, WATER_SURFACE_Y + CURRENT_ARROW_Y_OFFSET, z),
        22,
        arrowColor,
        7.5,
        3.4,
      );
      const lineMaterial = helper.line.material;
      if (!Array.isArray(lineMaterial)) {
        lineMaterial.depthWrite = false;
        lineMaterial.depthTest = false;
      }
      const coneMaterial = helper.cone.material;
      if (!Array.isArray(coneMaterial)) {
        coneMaterial.depthWrite = false;
        coneMaterial.depthTest = false;
      }
      helper.renderOrder = 10;
      currentArrowGroup.add(helper);
      currentArrowSamples.push({ helper, x, z });
    }
    if (currentArrowSamples.length >= MAX_ARROW_COUNT) break;
  }

  if (currentArrowGroup.parent !== scene) scene.add(currentArrowGroup);
}

function animateCurrentArrows(env: HarborEnvironment, t: number): void {
  for (const sample of currentArrowSamples) {
    const flow = computeFlowVectorAt(sample.x, sample.z, env, t, _flowScratch);
    let speed = flow.length();

    if (isLandAtWorldPoint(sample.x, sample.z)) {
      setVisibleStable(sample.helper, false);
      continue;
    }

    if (speed < MIN_ARROW_SPEED) {
      const headingRad = THREE.MathUtils.degToRad(env.currentDirectionDeg);
      flow.set(-Math.sin(headingRad), Math.cos(headingRad)).multiplyScalar(MIN_ARROW_SPEED);
      speed = MIN_ARROW_SPEED;
    }

    setVisibleStable(sample.helper, true);
    _directionScratch3.set(flow.x, 0, flow.y).normalize();
    const pulse = 0.16 * Math.sin(t * 2.1 + (sample.x - sample.z) * 0.008);
    const length = THREE.MathUtils.clamp(18 + speed * 42, 18, 46);

    sample.helper.position.set(sample.x, WATER_SURFACE_Y + CURRENT_ARROW_Y_OFFSET + pulse, sample.z);
    sample.helper.setDirection(_directionScratch3);
    sample.helper.setLength(length, 7.5, 3.4);
  }
}

function getSunDirection(night: boolean): THREE.Vector3 {
  return _sunDirection.copy(night ? NIGHT_WATER_SUN_DIRECTION : DAY_WATER_SUN_DIRECTION);
}

function getWaterUniforms(mesh: Water): WaterUniforms | null {
  const material = mesh.material as THREE.ShaderMaterial;
  const uniforms = material.uniforms as Partial<WaterUniforms> | undefined;
  if (!uniforms) return null;
  if (
    !uniforms.time ||
    !uniforms.size ||
    !uniforms.distortionScale ||
    !uniforms.waterColor ||
    !uniforms.sunColor ||
    !uniforms.sunDirection
  ) {
    return null;
  }
  return uniforms as WaterUniforms;
}

/** Create one continuous Water surface (Three.js ocean example style). */
export function createWaterTiles(scene: THREE.Scene): WaterTile[] {
  const tiles: WaterTile[] = [];
  shaderTiles.length = 0;
  _landMaskApplied = false;
  _nextLandMaskProbeAt = 0;
  _lastCurrentTime = 0;
  _waterShaderTime = 0;
  _normalDrift.set(0, 0);

  const { minX, maxX, minZ, maxZ } = getWaterBounds();

  const width = maxX - minX;
  const depth = maxZ - minZ;
  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;

  const segmentsX = Math.max(
    MIN_WATER_SUBDIVISIONS,
    Math.ceil((width / TILE_SIZE) * WATER_SUBDIVISIONS_PER_TILE),
  );
  const segmentsZ = Math.max(
    MIN_WATER_SUBDIVISIONS,
    Math.ceil((depth / TILE_SIZE) * WATER_SUBDIVISIONS_PER_TILE),
  );

  const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
  const normalTexture = createWaterNormalsTexture();

  // ── Resin backing: dark plane beneath the water for depth ──
  const resinBacking = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({
      color: "#1a3d4a",
      emissive: "#0d1e26",
      emissiveIntensity: 0.25,
      roughness: 0.3,
      metalness: 0.1,
    }),
  );
  resinBacking.rotation.x = -Math.PI / 2;
  resinBacking.position.set(centerX, WATER_SURFACE_Y - WATER_RESIN_DEPTH, centerZ);
  resinBacking.renderOrder = 0;
  scene.add(resinBacking);
  _resinBacking = resinBacking;

  // ── Water surface shader ──
  const water = new Water(geometry, {
    textureWidth: 1024,
    textureHeight: 1024,
    waterNormals: normalTexture,
    sunDirection: DAY_WATER_SUN_DIRECTION.clone(),
    sunColor: DAY_WATER_SUN_COLOR,
    waterColor: "#2a8090",
    distortionScale: 3.4,
    fog: scene.fog != null,
    alpha: 0.82,
  });

  water.rotation.x = -Math.PI / 2;
  water.position.set(centerX, WATER_SURFACE_Y, centerZ);
  water.receiveShadow = true;
  water.renderOrder = 1;
  const waterMaterial = water.material as THREE.ShaderMaterial;
  waterMaterial.depthTest = true;
  waterMaterial.depthWrite = true;
  waterMaterial.transparent = true;
  scene.add(water);

  const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
  const baseXZ = new Float32Array(positionAttr.count * 2);
  for (let i = 0; i < positionAttr.count; i += 1) {
    baseXZ[i * 2] = positionAttr.getX(i);
    baseXZ[i * 2 + 1] = positionAttr.getY(i);
  }

  const lightnessOffset = 0;
  tiles.push({
    mesh: water as unknown as WaterTile["mesh"],
    positionAttr,
    baseXZ,
    lightnessOffset,
  });
  const shaderTile = { mesh: water, baseX: centerX, baseZ: centerZ, lightnessOffset, normalTexture };
  shaderTiles.push(shaderTile);
  if (landPolygonRings.length > 0) {
    applyLandMaskToTile(shaderTile);
    _landMaskApplied = true;
  }

  createCurrentArrows(scene, minX, maxX, minZ, maxZ);

  return tiles;
}

/** Animate Water shader uniforms each frame. */
export function animateWaterTiles(
  _tiles: WaterTile[],
  env: HarborEnvironment,
  t: number,
  night: boolean,
): void {
  const effectiveEnv =
    FORCE_TEST_CURRENT
      ? {
          ...env,
          currentSpeedKnots: FORCED_CURRENT_KNOTS,
          currentDirectionDeg: FORCED_CURRENT_DIRECTION_DEG,
        }
      : env;

  // ── Current drift ──────────────────────────────────────────────────
  const now = performance.now() * 0.001;
  if (_lastCurrentTime === 0) _lastCurrentTime = now;
  const dt = now - _lastCurrentTime;
  _lastCurrentTime = now;

  maybeApplyLandMask(now);

  const centerFlow = computeFlowVectorAt(0, 0, effectiveEnv, t, _flowScratch);
  const centerSpeed = centerFlow.length();
  if (dt < 1) {
    const headingRad = THREE.MathUtils.degToRad(effectiveEnv.currentDirectionDeg);
    const dirX = -Math.sin(headingRad);
    const dirY = Math.cos(headingRad);
    const uvDrift = effectiveEnv.currentSpeedKnots * UV_DRIFT_PER_KNOT;
    _normalDrift.x += dirX * dt * uvDrift;
    _normalDrift.y -= dirY * dt * uvDrift;
    _normalDrift.x = THREE.MathUtils.euclideanModulo(_normalDrift.x, 1);
    _normalDrift.y = THREE.MathUtils.euclideanModulo(_normalDrift.y, 1);

    const currentTimeRate = 0.01 + effectiveEnv.currentSpeedKnots * 0.005 + effectiveEnv.windSpeedMph * 0.0015;
    _waterShaderTime += dt * currentTimeRate;
  }

  for (const tile of shaderTiles) {
    tile.mesh.position.x = tile.baseX;
    tile.mesh.position.y = WATER_SURFACE_Y;
    tile.mesh.position.z = tile.baseZ;
    tile.normalTexture.offset.set(_normalDrift.x, _normalDrift.y);
  }

  animateCurrentArrows(effectiveEnv, t);

  const springBoost = env.isSpringTide ? 1.15 : 1.0;
  const waveIntensity = THREE.MathUtils.clamp(env.waveHeightM / 1.7, 0.18, 2.4) * springBoost;
  const flowAhead = computeFlowVectorAt(200, 0, effectiveEnv, t, _flowScratchA);
  const flowBehind = computeFlowVectorAt(-200, 0, effectiveEnv, t, _flowScratchB);
  const shear = flowAhead.distanceTo(flowBehind);
  const knotEnergy = THREE.MathUtils.clamp(effectiveEnv.currentSpeedKnots / 16, 0, 6);
  const currentEnergy = THREE.MathUtils.clamp(centerSpeed * 0.55 + shear * 0.38 + knotEnergy * 0.22, 0, 2.6);
  const swellScale = 0.32 + waveIntensity * 0.54 - currentEnergy * 0.06;
  const distortionScale = 4.2 + waveIntensity * 7.6 + effectiveEnv.windSpeedMph * 0.06 + currentEnergy * 5.8;
  // Soft teal base (#4E8FA6) with subtle temperature modulation
  const waterTempNorm = THREE.MathUtils.clamp((env.seaSurfaceTempC - 2) / 22, 0, 1);
  const waterHue = 0.54 - waterTempNorm * 0.02;
  const waterSat = 0.52 + waterTempNorm * 0.06;
  const waterLight = night ? 0.22 + waterTempNorm * 0.04 : 0.42 + waterTempNorm * 0.06;

  _waterColor.setHSL(waterHue, waterSat, waterLight);
  const sunDirection = getSunDirection(night);
  const sunColor = night ? NIGHT_WATER_SUN_COLOR : DAY_WATER_SUN_COLOR;

  for (const tile of shaderTiles) {
    const uniforms = getWaterUniforms(tile.mesh);
    if (!uniforms) continue;

    uniforms.time.value = _waterShaderTime;
    uniforms.size.value = swellScale;
    uniforms.distortionScale.value = distortionScale;
    uniforms.waterColor.value.copy(_waterColor);
    uniforms.sunColor.value.set(sunColor);
    uniforms.sunDirection.value.copy(sunDirection);
  }
}

/** Dispose water resources. */
export function disposeWaterTiles(scene: THREE.Scene, tiles: WaterTile[]): void {
  for (const tile of shaderTiles) {
    scene.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    tile.mesh.material.dispose();
    tile.normalTexture.dispose();
  }

  if (_resinBacking) {
    scene.remove(_resinBacking);
    _resinBacking.geometry.dispose();
    (_resinBacking.material as THREE.Material).dispose();
    _resinBacking = null;
  }

  scene.remove(currentArrowGroup);
  currentArrowGroup.clear();
  currentArrowSamples.length = 0;

  tiles.length = 0;
  shaderTiles.length = 0;
  _landMaskApplied = false;
  _nextLandMaskProbeAt = 0;
  _lastCurrentTime = 0;
  _waterShaderTime = 0;
  _normalDrift.set(0, 0);
}
