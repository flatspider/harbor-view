import * as THREE from "three";
import { Water } from "three/examples/jsm/objects/Water.js";
import type { HarborEnvironment } from "../types/environment";
import { TILE_SIZE, WORLD_WIDTH, WORLD_DEPTH, type WaterTile } from "./constants";

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

const shaderTiles: ShaderWaterTile[] = [];
const _sunDirection = new THREE.Vector3();
const _waterColor = new THREE.Color();
const _currentOffset = new THREE.Vector2(0, 0);
let _lastCurrentTime = 0;
const WATER_NORMALS_URL = "https://threejs.org/examples/textures/waternormals.jpg";

// East is mirrored to negative X in world space. Keep the footprint biased east + slightly north.
const WATER_OVERSCAN_WEST = TILE_SIZE * 3;
const WATER_OVERSCAN_EAST = TILE_SIZE * 8;
const WATER_OVERSCAN_SOUTH = TILE_SIZE * 1;
const WATER_OVERSCAN_NORTH = TILE_SIZE * 2;
const WATER_SUBDIVISIONS_PER_TILE = 18;
const MIN_WATER_SUBDIVISIONS = 48;

function createWaterNormalsTexture(): THREE.Texture {
  const texture = new THREE.TextureLoader().load(WATER_NORMALS_URL);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function getSunDirection(night: boolean): THREE.Vector3 {
  const now = new Date();
  const hours = now.getHours() + now.getMinutes() / 60;
  const daylightT = THREE.MathUtils.clamp((hours - 6) / 12, 0, 1);

  const elevation = night ? -4 : 6 + Math.sin(daylightT * Math.PI) * 58;
  const azimuth = 180 + (daylightT - 0.5) * 130;

  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  return _sunDirection.setFromSphericalCoords(1, phi, theta).normalize();
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

  const minX = -WORLD_WIDTH * 0.5 - WATER_OVERSCAN_EAST;
  const maxX = WORLD_WIDTH * 0.5 + WATER_OVERSCAN_WEST;
  const minZ = -WORLD_DEPTH * 0.5 - WATER_OVERSCAN_SOUTH;
  const maxZ = WORLD_DEPTH * 0.5 + WATER_OVERSCAN_NORTH;

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

  const water = new Water(geometry, {
    textureWidth: 1024,
    textureHeight: 1024,
    waterNormals: normalTexture,
    sunDirection: new THREE.Vector3(0.2, 1, 0.12).normalize(),
    sunColor: "#ffffff",
    waterColor: "#214a66",
    distortionScale: 6.2,
    fog: scene.fog != null,
    alpha: 0.95,
  });

  water.rotation.x = -Math.PI / 2;
  water.position.set(centerX, 0, centerZ);
  water.receiveShadow = true;
  scene.add(water);

  const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
  const baseXZ = new Float32Array(positionAttr.count * 2);
  for (let i = 0; i < positionAttr.count; i += 1) {
    baseXZ[i * 2] = positionAttr.getX(i);
    baseXZ[i * 2 + 1] = positionAttr.getZ(i);
  }

  const lightnessOffset = 0;
  tiles.push({
    mesh: water as unknown as WaterTile["mesh"],
    positionAttr,
    baseXZ,
    lightnessOffset,
  });
  shaderTiles.push({ mesh: water, baseX: centerX, baseZ: centerZ, lightnessOffset, normalTexture });

  return tiles;
}

/** Animate Water shader uniforms each frame. */
export function animateWaterTiles(
  _tiles: WaterTile[],
  env: HarborEnvironment,
  t: number,
  night: boolean,
): void {
  // ── Current drift ──────────────────────────────────────────────────
  const now = performance.now() * 0.001; // seconds
  if (_lastCurrentTime === 0) _lastCurrentTime = now;
  const dt = now - _lastCurrentTime;
  _lastCurrentTime = now;

  if (dt < 1 && env.currentSpeedKnots > 0.05) {
    // Compass heading → math angle (clockwise from N → counter-clockwise from +X)
    const rad = THREE.MathUtils.degToRad(env.currentDirectionDeg);
    // Compass: 0°=N(+Z), 90°=E(-X in mirrored world space)
    const dx = -Math.sin(rad) * env.currentSpeedKnots * 0.35 * dt;
    const dz = Math.cos(rad) * env.currentSpeedKnots * 0.35 * dt;
    _currentOffset.x += dx;
    _currentOffset.y += dz;

    // Wrap to avoid float precision drift
    const WRAP = 10000;
    if (Math.abs(_currentOffset.x) > WRAP) _currentOffset.x %= WRAP;
    if (Math.abs(_currentOffset.y) > WRAP) _currentOffset.y %= WRAP;
  }

  for (const tile of shaderTiles) {
    tile.mesh.position.x = tile.baseX + _currentOffset.x;
    tile.mesh.position.z = tile.baseZ + _currentOffset.y;
  }

  const waveIntensity = THREE.MathUtils.clamp(env.waveHeightM / 1.7, 0.18, 2.4);
  // Lower size values produce broader, larger wave patterns in Water.js noise.
  const swellScale = 0.35 + waveIntensity * 0.6;
  const distortionScale = 4.0 + waveIntensity * 8.0 + env.windSpeedMph * 0.07;
  const waterTempNorm = THREE.MathUtils.clamp((env.seaSurfaceTempC - 2) / 22, 0, 1);
  const waterHue = 0.565 - waterTempNorm * 0.045;
  const waterSat = 0.5 + waterTempNorm * 0.08;
  const waterLight = night ? 0.12 + waterTempNorm * 0.03 : 0.2 + waterTempNorm * 0.05;

  _waterColor.setHSL(waterHue, waterSat, waterLight);
  const sunDirection = getSunDirection(night);
  const sunColor = night ? "#9caec9" : "#ffffff";

  for (const tile of shaderTiles) {
    const uniforms = getWaterUniforms(tile.mesh);
    if (!uniforms) continue;

    uniforms.time.value = t * (0.35 + waveIntensity * 0.14);
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
  tiles.length = 0;
  shaderTiles.length = 0;
}
