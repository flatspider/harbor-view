import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { WORLD_WIDTH, WORLD_DEPTH, moodFromForecast } from "./constants";

interface SkyUniforms {
  turbidity: { value: number };
  rayleigh: { value: number };
  mieCoefficient: { value: number };
  mieDirectionalG: { value: number };
  sunPosition: { value: THREE.Vector3 };
  cloudScale: { value: number };
  cloudSpeed: { value: number };
  cloudCoverage: { value: number };
  cloudDensity: { value: number };
  cloudElevation: { value: number };
  time: { value: number };
}

const _sunPosition = new THREE.Vector3();

function getSunPosition(night: boolean): THREE.Vector3 {
  const now = new Date();
  const hours = now.getHours() + now.getMinutes() / 60;
  const daylightT = THREE.MathUtils.clamp((hours - 6) / 12, 0, 1);

  const elevation = night ? -6 : 2 + Math.sin(daylightT * Math.PI) * 68;
  const azimuth = 180 + (daylightT - 0.5) * 160;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);

  return _sunPosition.setFromSphericalCoords(1, phi, theta);
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
    !uniforms.sunPosition ||
    !uniforms.cloudScale ||
    !uniforms.cloudSpeed ||
    !uniforms.cloudCoverage ||
    !uniforms.cloudDensity ||
    !uniforms.cloudElevation ||
    !uniforms.time
  ) {
    return null;
  }
  return uniforms as SkyUniforms;
}

/** Create Three.js Sky object (same model as webgl_shaders_sky). */
export function createSkyBackdrop(scene: THREE.Scene): THREE.Mesh {
  const sky = new Sky();
  sky.scale.setScalar(Math.max(WORLD_WIDTH, WORLD_DEPTH) * 14);
  scene.add(sky);
  return sky;
}

/** Animate sky scattering/cloud uniforms each frame. */
export function animateSky(
  skyMesh: THREE.Mesh,
  night: boolean,
  forecastSummary: string,
): void {
  const uniforms = getSkyUniforms(skyMesh);
  if (!uniforms) return;

  const mood = moodFromForecast(forecastSummary);
  const cloudiness = mood === "rain" ? 0.42 : mood === "overcast" ? 0.34 : mood === "fog" ? 0.24 : 0.14;

  uniforms.turbidity.value = night ? 9.5 : 4.2 + cloudiness * 4.1;
  uniforms.rayleigh.value = night ? 0.18 : mood === "fog" ? 0.4 : 0.92;
  uniforms.mieCoefficient.value = night ? 0.009 : 0.0035 + cloudiness * 0.0028;
  uniforms.mieDirectionalG.value = night ? 0.88 : mood === "fog" ? 0.73 : 0.8;
  uniforms.cloudCoverage.value = night ? 0.24 : cloudiness;
  uniforms.cloudDensity.value = night ? 0.18 : THREE.MathUtils.clamp(cloudiness * 0.72, 0.09, 0.32);
  uniforms.cloudScale.value = 0.00016;
  uniforms.cloudSpeed.value = night ? 0.000035 : 0.00006;
  uniforms.cloudElevation.value = 0.5;
  uniforms.time.value = performance.now() * 0.00004;
  uniforms.sunPosition.value.copy(getSunPosition(night));
}

/** Dispose sky resources. */
export function disposeSkyBackdrop(scene: THREE.Scene, skyMesh: THREE.Mesh): void {
  scene.remove(skyMesh);
  skyMesh.geometry.dispose();
  (skyMesh.material as THREE.Material).dispose();
}
