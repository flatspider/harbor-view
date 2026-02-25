import * as THREE from "three";
import type { HarborEnvironment } from "../types/environment";
import {
  TILE_SIZE,
  TILE_VARIANTS,
  WORLD_WIDTH,
  WORLD_DEPTH,
  degToVectorOnWater,
  type WaterTile,
} from "./constants";

/* ── GLSL Shaders ────────────────────────────────────────────────────── */

const waterVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uWaveIntensity;
  uniform float uWaveSpeed;
  uniform vec2 uSwellDir;
  uniform float uTideOffset;
  uniform vec2 uTileOffset;

  varying float vHeight;
  varying vec2 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  // Simplex-style noise using sin combinations (GPU-friendly, no texture needed)
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // smoothstep
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.1;
      amplitude *= 0.48;
    }
    return value;
  }

  void main() {
    vec3 pos = position;
    vec2 worldXZ = pos.xy + uTileOffset;
    vWorldPos = worldXZ;

    // Multi-layered displacement
    float t = uTime * uWaveSpeed;
    float swellAxis = dot(worldXZ, uSwellDir);

    // Primary swell (large, directional)
    float swell = sin(swellAxis * 0.04 + t * 1.6) * 2.2 * uWaveIntensity;

    // Secondary chop (smaller, cross-directional)
    float chop = sin(worldXZ.x * 0.07 - worldXZ.y * 0.05 + t * 2.8) * 0.7 * uWaveIntensity;

    // Organic noise layer (fractal brownian motion)
    float noiseDisp = (fbm(worldXZ * 0.025 + t * 0.3) - 0.5) * 3.0 * uWaveIntensity;

    // Fine ripples
    float ripple = sin(worldXZ.x * 0.18 + t * 4.2) * sin(worldXZ.y * 0.14 - t * 3.5) * 0.35 * uWaveIntensity;

    float height = swell + chop + noiseDisp + ripple + uTideOffset;
    pos.z = height; // PlaneGeometry is in XY, rotated to XZ later; z = "up" before rotation

    vHeight = height;

    // Compute normal from neighboring displacement
    float dx = 0.5;
    vec2 px = worldXZ + vec2(dx, 0.0);
    vec2 pz = worldXZ + vec2(0.0, dx);
    float hx = sin(dot(px, uSwellDir) * 0.04 + t * 1.6) * 2.2 * uWaveIntensity
             + (fbm(px * 0.025 + t * 0.3) - 0.5) * 3.0 * uWaveIntensity;
    float hz = sin(dot(pz, uSwellDir) * 0.04 + t * 1.6) * 2.2 * uWaveIntensity
             + (fbm(pz * 0.025 + t * 0.3) - 0.5) * 3.0 * uWaveIntensity;
    vNormal = normalize(vec3(height - hx, dx, height - hz));

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const waterFragmentShader = /* glsl */ `
  uniform vec3 uWaterColor;
  uniform vec3 uDeepColor;
  uniform vec3 uSpecularColor;
  uniform float uNight;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  varying float vHeight;
  varying vec2 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    // Depth-based color mixing
    float depthFactor = smoothstep(-3.0, 4.0, vHeight);
    vec3 baseColor = mix(uDeepColor, uWaterColor, depthFactor);

    // Specular highlight (sun reflection on waves)
    vec3 viewDir = normalize(vViewPosition);
    vec3 lightDir = normalize(vec3(-0.5, 0.8, 0.3));
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(vNormal, halfDir), 0.0), 64.0);
    float specIntensity = mix(0.6, 0.15, uNight);
    vec3 specular = uSpecularColor * spec * specIntensity;

    // Foam on wave crests
    float foam = smoothstep(2.5, 4.0, vHeight) * 0.18;
    vec3 foamColor = vec3(0.85, 0.92, 0.95);

    vec3 color = baseColor + specular + foamColor * foam;

    // Fog
    float fogDepth = length(vViewPosition);
    float fogFactor = smoothstep(uFogNear, uFogFar, fogDepth);
    color = mix(color, uFogColor, fogFactor);

    gl_FragColor = vec4(color, 0.93);
  }
`;

/* ── Water Tile Creation ─────────────────────────────────────────────── */

interface ShaderWaterTile {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  lightnessOffset: number;
}

// We keep a parallel array of shader tiles for uniform updates
const shaderTiles: ShaderWaterTile[] = [];

/** Create the tiled water plane with displacement shader. */
export function createWaterTiles(scene: THREE.Scene): WaterTile[] {
  const tiles: WaterTile[] = [];
  shaderTiles.length = 0;

  for (let tx = 0; tx < WORLD_WIDTH / TILE_SIZE; tx += 1) {
    for (let tz = 0; tz < WORLD_DEPTH / TILE_SIZE; tz += 1) {
      const x = tx * TILE_SIZE - WORLD_WIDTH * 0.5 + TILE_SIZE * 0.5;
      const z = tz * TILE_SIZE - WORLD_DEPTH * 0.5 + TILE_SIZE * 0.5;
      const variant = (tx + tz) % TILE_VARIANTS;
      const lightnessOffset = (variant - (TILE_VARIANTS - 1) * 0.5) * 0.012;

      const geometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 20, 20);

      const material = new THREE.ShaderMaterial({
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uWaveIntensity: { value: 0.5 },
          uWaveSpeed: { value: 1.0 },
          uSwellDir: { value: new THREE.Vector2(0.7, 0.7) },
          uTideOffset: { value: 0 },
          uTileOffset: { value: new THREE.Vector2(x, z) },
          uWaterColor: { value: new THREE.Color("#3a84a8") },
          uDeepColor: { value: new THREE.Color("#1a4a6a") },
          uSpecularColor: { value: new THREE.Color("#f6e5b1") },
          uNight: { value: 0 },
          uFogColor: { value: new THREE.Color("#a7c5d8") },
          uFogNear: { value: 800 },
          uFogFar: { value: 2200 },
        },
        transparent: true,
        side: THREE.DoubleSide,
        fog: false, // We handle fog in the shader
      });

      const tile = new THREE.Mesh(geometry, material);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(x, 0, z);
      tile.receiveShadow = true;
      scene.add(tile);

      // Store the positionAttr/baseXZ for WaterTile interface compat
      const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
      const baseXZ = new Float32Array(positionAttr.count * 2);
      for (let i = 0; i < positionAttr.count; i += 1) {
        baseXZ[i * 2] = positionAttr.getX(i);
        baseXZ[i * 2 + 1] = positionAttr.getZ(i);
      }

      // Use 'as any' for the mesh type since WaterTile expects MeshStandardMaterial
      // but we're using ShaderMaterial. The WaterTile fields are still populated for compat.
      tiles.push({
        mesh: tile as unknown as WaterTile["mesh"],
        positionAttr,
        baseXZ,
        lightnessOffset,
      });

      shaderTiles.push({ mesh: tile, lightnessOffset });
    }
  }
  return tiles;
}

/** Animate water tiles for one frame by updating shader uniforms. */
export function animateWaterTiles(
  _tiles: WaterTile[],
  env: HarborEnvironment,
  t: number,
  night: boolean,
): void {
  const waterTempNorm = Math.min(Math.max((env.seaSurfaceTempC - 2) / 22, 0), 1);
  const waveIntensity = Math.min(Math.max(env.waveHeightM / 2.2, 0.12), 1.9);
  const waveSpeed = 0.65 + waveIntensity * 1.45;
  const swellVec = degToVectorOnWater(env.swellDirectionDeg);
  const tideHeightOffset = Math.min(Math.max(env.tideLevelM * 1.3, -2.2), 2.4);
  const waterHue = 0.56 - waterTempNorm * 0.06;
  const waterSat = 0.48 + waterTempNorm * 0.12;
  const waterLightBase = night ? 0.2 + waterTempNorm * 0.05 : 0.34 + waterTempNorm * 0.08;

  const fogColor = night ? "#1d2b3b" : "#a7c5d8";
  const fogNear = night ? 350 : 820;
  const fogFar = night ? 1200 : 2200;

  const waterColor = new THREE.Color();
  const deepColor = new THREE.Color();

  for (const tile of shaderTiles) {
    const u = tile.mesh.material.uniforms;
    u.uTime.value = t;
    u.uWaveIntensity.value = waveIntensity;
    u.uWaveSpeed.value = waveSpeed;
    u.uSwellDir.value.set(swellVec.x, swellVec.y);
    u.uTideOffset.value = tideHeightOffset;
    u.uNight.value = night ? 1 : 0;

    waterColor.setHSL(waterHue, waterSat, waterLightBase + tile.lightnessOffset);
    deepColor.setHSL(waterHue + 0.02, waterSat + 0.08, (waterLightBase + tile.lightnessOffset) * 0.55);
    u.uWaterColor.value.copy(waterColor);
    u.uDeepColor.value.copy(deepColor);

    u.uFogColor.value.set(fogColor);
    u.uFogNear.value = fogNear;
    u.uFogFar.value = fogFar;
  }
}

/** Dispose water tile resources. */
export function disposeWaterTiles(scene: THREE.Scene, tiles: WaterTile[]): void {
  for (const tile of tiles) {
    scene.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    tile.mesh.material.dispose();
  }
  tiles.length = 0;
  shaderTiles.length = 0;
}
