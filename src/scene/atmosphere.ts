import * as THREE from "three";
import type { HarborEnvironment } from "../types/environment";
import { WORLD_WIDTH, WORLD_DEPTH, degToVectorOnWater, moodFromForecast } from "./constants";

const BASE_FOG_DENSITY = 0.00018;
const CLEAR_DAY_FOG = new THREE.Color("#c8c2d5");
const OVERCAST_DAY_FOG = new THREE.Color("#b4afc0");
const RAIN_DAY_BACKGROUND = new THREE.Color("#9898ab");
const NIGHT_FOG_BASE = new THREE.Color("#1a2434");
const NIGHT_FOG_MOON = new THREE.Color("#28364a");

const DAY_HEMI_SKY = new THREE.Color("#ddd8e8");
const DAY_HEMI_GROUND = new THREE.Color("#3a3548");
const DAY_SUN_COLOR = new THREE.Color("#ffd699");
const NIGHT_HEMI_SKY = new THREE.Color("#8ea2c4");
const NIGHT_HEMI_GROUND = new THREE.Color("#1f2533");
const NIGHT_SUN_COLOR = new THREE.Color("#9caec9");

/** Create wind particle system. */
export function createWindParticles(scene: THREE.Scene): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const count = 450;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * WORLD_WIDTH;
    positions[i * 3 + 1] = 18 + Math.random() * 40;
    positions[i * 3 + 2] = (Math.random() - 0.5) * WORLD_DEPTH;
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: "#f4fbff",
    size: 1.8,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const particles = new THREE.Points(geometry, material);
  particles.renderOrder = 8;
  scene.add(particles);
  return particles;
}

/** Update atmosphere for one frame: fog, lighting, background, wind. */
export function animateAtmosphere(
  scene: THREE.Scene,
  env: HarborEnvironment,
  windParticles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null,
  hemiLight: THREE.HemisphereLight,
  sunLight: THREE.DirectionalLight,
  backgroundColor: THREE.Color,
  night: boolean,
  cameraDistance: number,
): void {
  const mood = moodFromForecast(env.forecastSummary);

  // Fog — exponential, deepens naturally with distance
  const fog = scene.fog as THREE.FogExp2;
  const baseDensity =
    mood === "fog" ? BASE_FOG_DENSITY * 2.5 : mood === "rain" ? BASE_FOG_DENSITY * 1.5 : BASE_FOG_DENSITY;
  const pressureNorm = THREE.MathUtils.clamp((env.pressureHpa - 980) / 40, 0, 1);
  const zoomNorm = THREE.MathUtils.clamp((cameraDistance - 350) / (WORLD_DEPTH * 0.75), 0, 1);
  const cameraFogBoost = THREE.MathUtils.lerp(0.96, 1.08, zoomNorm);
  fog.density = baseDensity * (1.3 - pressureNorm * 0.3) * cameraFogBoost;

  if (night) {
    fog.color.copy(NIGHT_FOG_BASE).lerp(NIGHT_FOG_MOON, env.moonIllumination);
  } else {
    fog.color.copy(mood === "overcast" ? OVERCAST_DAY_FOG : CLEAR_DAY_FOG);
  }

  // backgroundColor kept in sync for fog edge matching (renderer clear color)
  if (night) {
    backgroundColor.copy(NIGHT_FOG_BASE);
  } else if (mood === "rain") {
    backgroundColor.copy(RAIN_DAY_BACKGROUND);
  } else {
    backgroundColor.copy(fog.color);
  }

  if (night) {
    hemiLight.color.copy(NIGHT_HEMI_SKY);
    hemiLight.groundColor.copy(NIGHT_HEMI_GROUND);
    sunLight.color.copy(NIGHT_SUN_COLOR);
  } else {
    hemiLight.color.copy(DAY_HEMI_SKY);
    hemiLight.groundColor.copy(DAY_HEMI_GROUND);
    sunLight.color.copy(DAY_SUN_COLOR);
  }

  // Lighting — moonlight modulates hemisphere intensity at night
  hemiLight.intensity = night ? 0.34 + env.moonIllumination * 0.16 : mood === "overcast" ? 0.76 : 0.92;
  sunLight.intensity = night ? 0.2 : mood === "rain" ? 0.45 : mood === "overcast" ? 0.82 : 1.25;

  // Wind particles
  if (windParticles) {
    const windAttr = windParticles.geometry.attributes.position as THREE.BufferAttribute;
    const windDir = degToVectorOnWater(env.windDirectionDeg);
    const speed = 0.4 + env.windSpeedMph * 0.06;
    for (let i = 0; i < windAttr.count; i += 1) {
      const x = windAttr.getX(i) + windDir.x * speed;
      const z = windAttr.getZ(i) + windDir.y * speed;
      windAttr.setX(i, x > WORLD_WIDTH * 0.55 ? -WORLD_WIDTH * 0.55 : x < -WORLD_WIDTH * 0.55 ? WORLD_WIDTH * 0.55 : x);
      windAttr.setZ(i, z > WORLD_DEPTH * 0.55 ? -WORLD_DEPTH * 0.55 : z < -WORLD_DEPTH * 0.55 ? WORLD_DEPTH * 0.55 : z);
    }
    windAttr.needsUpdate = true;
    windParticles.material.opacity = 0.12 + Math.min(env.windSpeedMph / 35, 0.45);
    windParticles.material.size = 1.4 + Math.min(env.windSpeedMph / 30, 1.2);
  }
}

/** Dispose wind particle resources. */
export function disposeWindParticles(
  particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null,
): void {
  if (!particles) return;
  particles.geometry.dispose();
  particles.material.dispose();
}
