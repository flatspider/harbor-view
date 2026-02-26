import * as THREE from "three";
import { toonGradient } from "./toonGradient";

const toonCache = new WeakMap<THREE.Material, THREE.MeshToonMaterial>();

/**
 * Convert a GLTF PBR material (MeshStandardMaterial / MeshPhysicalMaterial)
 * to a MeshToonMaterial that matches the project's cel-shading style.
 *
 * Carries over: color, map, transparency, side, depth settings.
 * Strips: metalness, roughness, normalMap.
 * Adds a low emissive fill to prevent toon shadows from going too dark.
 *
 * Uses a WeakMap cache so shared GLTF materials produce one toon material.
 */
export function convertToToonMaterial(source: THREE.Material): THREE.MeshToonMaterial {
  const cached = toonCache.get(source);
  if (cached) return cached;

  const toon = new THREE.MeshToonMaterial({ gradientMap: toonGradient });

  if (
    source instanceof THREE.MeshStandardMaterial ||
    source instanceof THREE.MeshPhysicalMaterial
  ) {
    toon.color.copy(source.color);
    if (source.map) {
      toon.map = source.map;
      toon.map.colorSpace = THREE.SRGBColorSpace;
    }
    toon.transparent = source.transparent;
    toon.opacity = source.opacity;
    if (source.alphaMap) toon.alphaMap = source.alphaMap;
    toon.alphaTest = source.alphaTest;
    toon.side = source.side;
    toon.depthWrite = source.depthWrite;
    toon.depthTest = source.depthTest;

    // Low emissive fill prevents toon shadows from going pitch black
    toon.emissive.copy(source.color);
    toon.emissiveIntensity = 0.15;
  }

  toon.toneMapped = true;
  toon.needsUpdate = true;

  toonCache.set(source, toon);
  return toon;
}
