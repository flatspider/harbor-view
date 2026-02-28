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
    toon.side = source.side;
    if (source.map) {
      toon.map = source.map;
      toon.map.colorSpace = THREE.SRGBColorSpace;
      // Preserve texture vibrancy: avoid multiplying albedo maps by a dim baseColorFactor.
      toon.color.setRGB(1, 1, 1);
      toon.fog = false;
      toon.transparent = false;
      toon.opacity = 1;
      toon.depthWrite = true;
      toon.depthTest = true;
      // Keep texture detail readable under low light by adding a subtle emissive map lift.
      toon.emissive.setRGB(1, 1, 1);
      toon.emissiveMap = toon.map;
      toon.emissiveIntensity = 0.18;
    } else {
      toon.fog = true;
      toon.transparent = source.transparent;
      toon.opacity = source.opacity;
      toon.depthWrite = source.depthWrite;
      toon.depthTest = source.depthTest;
      if (source.alphaMap) toon.alphaMap = source.alphaMap;
      toon.alphaTest = source.alphaTest;
      toon.side = source.side;
      // Keep a subtle emissive floor so shadows read, but avoid flattening contrast.
      toon.emissive.copy(source.color);
      toon.emissiveIntensity = 0.06;
    }
  }

  toon.toneMapped = true;
  toon.needsUpdate = true;

  toonCache.set(source, toon);
  return toon;
}
