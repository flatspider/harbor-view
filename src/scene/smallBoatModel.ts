import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { convertToToonMaterial } from "./convertToToon";

interface SmallBoatMetrics {
  length: number;
  height: number;
  headingRotation: number;
}

const SMALL_BOAT_MODEL_URL = "/models/small-boat-optimized.glb";
const SMALL_BOAT_FALLBACK_MODEL_URL = "/models/Meshy_AI_Sunset_Sail_0227212429_texture.glb";
const DRACO_DECODER_PATH = "/draco/";
const SMALL_BOAT_TARGET_LENGTH = 13;
const SMALL_BOAT_BASE_Y = 6;
const SMALL_BOAT_SINK_RATIO = 0.34;
const SMALL_BOAT_MODEL_NAME = "ship-category-model";
const SMALL_BOAT_METRICS_KEY = "__smallBoatMetrics";
const SMALL_BOAT_SHARED_ASSET_KEY = "sharedShipModelAsset";
const SMALL_BOAT_STYLED_MATERIAL_KEY = "__smallBoatStyledMaterial";

const _hsl = { h: 0, s: 0, l: 0 };

let smallBoatLoadPromise: Promise<THREE.Object3D> | null = null;

function applyToonSmallBoatMaterial(mesh: THREE.Mesh): void {
  const swap = (source: THREE.Material): THREE.MeshToonMaterial => {
    if ((source.userData as Record<string, unknown>)[SMALL_BOAT_STYLED_MATERIAL_KEY]) {
      return source as unknown as THREE.MeshToonMaterial;
    }

    const toon = convertToToonMaterial(source);
    toon.color.getHSL(_hsl);
    toon.color.setHSL(
      _hsl.h,
      Math.min(1, _hsl.s * 1.08 + 0.03),
      Math.min(0.72, _hsl.l * 1.12 + 0.04),
    );
    toon.emissive.copy(toon.color);
    toon.emissiveIntensity = 0.14;
    toon.needsUpdate = true;
    toon.userData[SMALL_BOAT_STYLED_MATERIAL_KEY] = true;

    if (source !== toon) source.dispose();
    return toon;
  };

  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map(swap);
  } else {
    mesh.material = swap(mesh.material);
  }
}

function normalizePrototype(prototype: THREE.Object3D): SmallBoatMetrics {
  prototype.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(prototype);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  prototype.position.x -= center.x;
  prototype.position.z -= center.z;
  prototype.position.y -= bounds.min.y;
  prototype.updateMatrixWorld(true);

  const planarLength = Math.max(size.x, size.z, 0.001);
  const headingRotation = size.x >= size.z ? Math.PI / 2 : 0;

  const metrics: SmallBoatMetrics = {
    length: planarLength,
    height: Math.max(size.y, 0.001),
    headingRotation,
  };
  prototype.userData[SMALL_BOAT_METRICS_KEY] = metrics;

  prototype.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = 6;
    child.userData[SMALL_BOAT_SHARED_ASSET_KEY] = true;
    applyToonSmallBoatMaterial(child);
  });

  return metrics;
}

function getMetrics(prototype: THREE.Object3D): SmallBoatMetrics {
  const stored = prototype.userData[SMALL_BOAT_METRICS_KEY] as Partial<SmallBoatMetrics> | undefined;
  if (
    stored &&
    typeof stored.length === "number" &&
    typeof stored.height === "number" &&
    typeof stored.headingRotation === "number"
  ) {
    return {
      length: stored.length,
      height: stored.height,
      headingRotation: stored.headingRotation,
    };
  }
  return normalizePrototype(prototype);
}

function loadModel(url: string, useDraco: boolean): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    const dracoLoader = useDraco ? new DRACOLoader() : null;
    if (dracoLoader) {
      dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
      loader.setDRACOLoader(dracoLoader);
    }

    loader.load(
      url,
      (gltf) => {
        dracoLoader?.dispose();
        if (!gltf.scene) {
          reject(new Error(`Small boat model has no scene: ${url}`));
          return;
        }
        resolve(gltf.scene);
      },
      undefined,
      (error) => {
        dracoLoader?.dispose();
        reject(error);
      },
    );
  });
}

export function loadSmallBoatPrototype(): Promise<THREE.Object3D> {
  if (smallBoatLoadPromise) return smallBoatLoadPromise;

  smallBoatLoadPromise = (async () => {
    try {
      const optimizedPrototype = await loadModel(SMALL_BOAT_MODEL_URL, true);
      normalizePrototype(optimizedPrototype);
      return optimizedPrototype;
    } catch {
      const fallbackPrototype = await loadModel(SMALL_BOAT_FALLBACK_MODEL_URL, false);
      normalizePrototype(fallbackPrototype);
      return fallbackPrototype;
    }
  })().catch((error) => {
    smallBoatLoadPromise = null;
    throw error;
  });

  return smallBoatLoadPromise;
}

export function createSmallBoatModelInstance(
  prototype: THREE.Object3D,
  sizeScale: number,
): THREE.Object3D {
  const metrics = getMetrics(prototype);
  const visualScale = Math.max(sizeScale, 0.22);
  const targetLength = SMALL_BOAT_TARGET_LENGTH * visualScale;
  const modelScale = targetLength / Math.max(metrics.length, 0.001);
  const modelHeight = metrics.height * modelScale;
  const sinkOffset = modelHeight * SMALL_BOAT_SINK_RATIO;

  const instance = prototype.clone(true);
  instance.name = SMALL_BOAT_MODEL_NAME;
  instance.renderOrder = 6;
  instance.scale.setScalar(modelScale);
  instance.rotation.y = metrics.headingRotation;
  instance.position.set(0, SMALL_BOAT_BASE_Y * visualScale - sinkOffset, 0);

  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.renderOrder = 6;
    child.userData[SMALL_BOAT_SHARED_ASSET_KEY] = true;
  });

  return instance;
}
