import * as THREE from "three";
import { WORLD_WIDTH, WORLD_DEPTH, moodFromForecast } from "./constants";

/**
 * Ghibli-style procedural sky background.
 *
 * Creates a large vertical plane behind the scene with vertex-colored
 * gradient bands that shift with time of day and weather mood.
 */

export interface SkyPalette {
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  haze: THREE.Color;
}

const PALETTES = {
  dayClear: {
    zenith: new THREE.Color("#4a7fb5"),
    mid: new THREE.Color("#7db8d9"),
    horizon: new THREE.Color("#c8dfe8"),
    haze: new THREE.Color("#e8d8c4"),
  },
  dayOvercast: {
    zenith: new THREE.Color("#7a8fa0"),
    mid: new THREE.Color("#99aab5"),
    horizon: new THREE.Color("#bcc7ce"),
    haze: new THREE.Color("#c8c0b6"),
  },
  dayRain: {
    zenith: new THREE.Color("#5e6f7e"),
    mid: new THREE.Color("#7a8c99"),
    horizon: new THREE.Color("#9aabb5"),
    haze: new THREE.Color("#a09a92"),
  },
  dayFog: {
    zenith: new THREE.Color("#8a9caa"),
    mid: new THREE.Color("#a5b5bf"),
    horizon: new THREE.Color("#c0ccd2"),
    haze: new THREE.Color("#d0ccc6"),
  },
  goldenHour: {
    zenith: new THREE.Color("#5b7ca0"),
    mid: new THREE.Color("#c49a6c"),
    horizon: new THREE.Color("#e8b87a"),
    haze: new THREE.Color("#f0d0a0"),
  },
  night: {
    zenith: new THREE.Color("#0d1520"),
    mid: new THREE.Color("#1a2840"),
    horizon: new THREE.Color("#243550"),
    haze: new THREE.Color("#1e2d42"),
  },
} as const;

function getSkyPalette(night: boolean, mood: string): SkyPalette {
  if (night) return PALETTES.night;
  const hour = new Date().getHours();
  if ((hour >= 6 && hour < 8) || (hour >= 17 && hour < 19)) return PALETTES.goldenHour;
  if (mood === "fog") return PALETTES.dayFog;
  if (mood === "rain") return PALETTES.dayRain;
  if (mood === "overcast") return PALETTES.dayOvercast;
  return PALETTES.dayClear;
}

// We use 5 rows of vertices for smooth gradient bands.
const SKY_ROWS = 5;
const SKY_WIDTH = WORLD_WIDTH * 4;
const SKY_HEIGHT = WORLD_DEPTH * 2.5;

/** Create the sky backdrop mesh and add it to the scene. */
export function createSkyBackdrop(scene: THREE.Scene): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(SKY_WIDTH, SKY_HEIGHT, 1, SKY_ROWS - 1);
  const colors = new Float32Array(SKY_ROWS * 2 * 3); // 2 verts per row, 3 components
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    fog: false,
    // Plane sits in front of the camera and must render from its back-facing side.
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  // Position far behind the scene, facing the camera
  mesh.position.set(0, SKY_HEIGHT * 0.28, WORLD_DEPTH * 1.8);
  scene.add(mesh);
  return mesh;
}

/** Update sky colors for current conditions. */
export function animateSky(
  skyMesh: THREE.Mesh,
  night: boolean,
  forecastSummary: string,
): void {
  const mood = moodFromForecast(forecastSummary);
  const palette = getSkyPalette(night, mood);
  const colorAttr = skyMesh.geometry.attributes.color as THREE.BufferAttribute;
  const arr = colorAttr.array as Float32Array;

  // Rows from bottom (horizon/haze) to top (zenith).
  // With SKY_ROWS=5: row 0 = bottom, row 4 = top
  const bandColors = [
    palette.haze,
    palette.horizon,
    palette.mid,
    palette.mid.clone().lerp(palette.zenith, 0.5),
    palette.zenith,
  ];

  for (let row = 0; row < SKY_ROWS; row++) {
    const color = bandColors[row];
    // Two vertices per row (left and right)
    const i = row * 2;
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
    arr[(i + 1) * 3] = color.r;
    arr[(i + 1) * 3 + 1] = color.g;
    arr[(i + 1) * 3 + 2] = color.b;
  }

  colorAttr.needsUpdate = true;
}
