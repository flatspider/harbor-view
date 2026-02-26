import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import type { HarborEnvironment } from "../types/environment";
import { WORLD_WIDTH, WORLD_DEPTH, moodFromForecast } from "./constants";

interface SkyUniforms {
  turbidity: { value: number };
  rayleigh: { value: number };
  mieCoefficient: { value: number };
  mieDirectionalG: { value: number };
  sunPosition: { value: THREE.Vector3 };
}

export interface SkySettings {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  elevation: number;
  azimuth: number;
  exposure: number;
}

const _sunPosition = new THREE.Vector3();
const SKY_DEFAULTS: SkySettings = {
  turbidity: 8,
  rayleigh: 3,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.7,
  elevation: 8,
  azimuth: 180,
  exposure: 0.72,
};

function getTimeSunAngles(night: boolean): { elevation: number; azimuth: number } {
  const now = new Date();
  const hours = now.getHours() + now.getMinutes() / 60;
  const daylightT = THREE.MathUtils.clamp((hours - 6) / 12, 0, 1);

  const elevation = night ? -6 : 2 + Math.sin(daylightT * Math.PI) * 68;
  const azimuth = 180 + (daylightT - 0.5) * 160;
  return { elevation, azimuth };
}

function getSkyUniforms(mesh: THREE.Mesh): SkyUniforms | null {
  const material = mesh.material as THREE.ShaderMaterial;
  const uniforms = material.uniforms as Partial<SkyUniforms> | undefined;
  if (!uniforms) return null;
  if (
    !uniforms.turbidity ||
    !uniforms.rayleigh ||
    !uniforms.mieCoefficient ||
    !uniforms.mieDirectionalG ||
    !uniforms.sunPosition
  ) {
    return null;
  }
  return uniforms as SkyUniforms;
}

function clampSettings(input: SkySettings): SkySettings {
  return {
    turbidity: THREE.MathUtils.clamp(input.turbidity, 0, 20),
    rayleigh: THREE.MathUtils.clamp(input.rayleigh, 0, 4),
    mieCoefficient: THREE.MathUtils.clamp(input.mieCoefficient, 0, 0.1),
    mieDirectionalG: THREE.MathUtils.clamp(input.mieDirectionalG, 0, 1),
    elevation: THREE.MathUtils.clamp(input.elevation, -15, 90),
    azimuth: THREE.MathUtils.euclideanModulo(input.azimuth, 360),
    exposure: THREE.MathUtils.clamp(input.exposure, 0, 2),
  };
}

export function getDefaultSkySettings(): SkySettings {
  return { ...SKY_DEFAULTS };
}

function getAutoSkySettings(night: boolean, env: HarborEnvironment): SkySettings {
  const mood = moodFromForecast(env.forecastSummary);
  const cloudiness = mood === "rain" ? 0.95 : mood === "overcast" ? 0.72 : mood === "fog" ? 0.86 : 0.25;
  const windFactor = THREE.MathUtils.clamp(env.windSpeedMph / 35, 0, 1);
  const { elevation, azimuth } = getTimeSunAngles(night);

  if (night) {
    const moonBoost = THREE.MathUtils.lerp(0.04, 0.22, THREE.MathUtils.clamp(env.moonIllumination, 0, 1));
    return clampSettings({
      turbidity: 12.5 + cloudiness * 2.4,
      rayleigh: 0.15 + moonBoost,
      mieCoefficient: 0.008 + cloudiness * 0.012,
      mieDirectionalG: 0.82 + windFactor * 0.1,
      elevation,
      azimuth,
      exposure: 0.2 + moonBoost * 0.9,
    });
  }

  const clearFactor = 1 - cloudiness;
  return clampSettings({
    turbidity: 6.4 + cloudiness * 7.2,
    rayleigh: mood === "fog" ? 0.4 : 1.2 + clearFactor * 2.1,
    mieCoefficient: 0.003 + cloudiness * 0.015,
    mieDirectionalG: mood === "fog" ? 0.7 : 0.74 + cloudiness * 0.18,
    elevation,
    azimuth,
    exposure: 0.5 + clearFactor * 0.4,
  });
}

/** Create Three.js Sky object (same model as webgl_shaders_sky). */
export function createSkyBackdrop(scene: THREE.Scene): THREE.Mesh {
  const sky = new Sky();
  sky.scale.setScalar(Math.max(WORLD_WIDTH, WORLD_DEPTH) * 14);
  scene.add(sky);
  return sky;
}

/** Animate sky scattering uniforms each frame. */
export function animateSky(
  skyMesh: THREE.Mesh,
  night: boolean,
  env: HarborEnvironment,
  manualSettings?: SkySettings,
): SkySettings {
  const uniforms = getSkyUniforms(skyMesh);
  const settings = manualSettings ? clampSettings(manualSettings) : getAutoSkySettings(night, env);
  if (!uniforms) return settings;

  uniforms.turbidity.value = settings.turbidity;
  uniforms.rayleigh.value = settings.rayleigh;
  uniforms.mieCoefficient.value = settings.mieCoefficient;
  uniforms.mieDirectionalG.value = settings.mieDirectionalG;

  const phi = THREE.MathUtils.degToRad(90 - settings.elevation);
  const theta = THREE.MathUtils.degToRad(settings.azimuth);
  uniforms.sunPosition.value.copy(_sunPosition.setFromSphericalCoords(1, phi, theta));

  return settings;
}

/** Dispose sky resources. */
export function disposeSkyBackdrop(scene: THREE.Scene, skyMesh: THREE.Mesh): void {
  scene.remove(skyMesh);
  skyMesh.geometry.dispose();
  (skyMesh.material as THREE.Material).dispose();
}
