import * as THREE from "three";

/**
 * Create a cel-shading gradient map for MeshToonMaterial.
 * Uses NearestFilter so light bands snap to discrete steps
 * instead of blending smoothly — this is what gives the cartoon look.
 */
export function createToonGradientMap(steps = 4): THREE.DataTexture {
  const values = [90, 160, 215, 255];
  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    const v = values[i] ?? Math.round((i / (steps - 1)) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Shared gradient map instance — reuse across all toon materials. */
export const toonGradient = createToonGradientMap();
