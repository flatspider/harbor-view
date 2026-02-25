import * as THREE from "three";
import type { HarborEnvironment } from "../types/environment";
import { WORLD_WIDTH, WORLD_DEPTH, degToVectorOnWater, moodFromForecast } from "./constants";

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
): void {
  const mood = moodFromForecast(env.forecastSummary);

  // Fog
  const fog = scene.fog as THREE.Fog;
  if (mood === "fog") {
    fog.near = 350;
    fog.far = 1200;
  } else if (mood === "rain") {
    fog.near = 650;
    fog.far = 1700;
  } else {
    fog.near = 820;
    fog.far = 2300;
  }
  // Pressure-driven fog density modulation
  const pressureNorm = THREE.MathUtils.clamp((env.pressureHpa - 980) / 40, 0, 1);
  const pressureFogScale = 0.7 + pressureNorm * 0.3;
  fog.near *= pressureFogScale;
  fog.far *= pressureFogScale;

  if (night) {
    const nightFogBase = new THREE.Color("#1d2b3b");
    const nightFogMoon = new THREE.Color("#2a3d50");
    fog.color.copy(nightFogBase).lerp(nightFogMoon, env.moonIllumination);
  } else {
    fog.color.set(mood === "overcast" ? "#8ea2b0" : "#a7c5d8");
  }
  // backgroundColor kept in sync for fog edge matching (renderer clear color)
  backgroundColor.set(
    night ? "#203246" : mood === "rain" ? "#6f8ca1" : mood === "overcast" ? "#7ea2b8" : "#89b3cf",
  );

  // Lighting — moonlight modulates hemisphere intensity at night
  hemiLight.intensity = night ? 0.36 + env.moonIllumination * 0.18 : mood === "overcast" ? 0.58 : 0.84;
  sunLight.intensity = night ? 0.22 : mood === "rain" ? 0.55 : 1.05;

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
