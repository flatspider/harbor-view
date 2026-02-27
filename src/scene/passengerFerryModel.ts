import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { convertToToonMaterial } from "./convertToToon";

interface PassengerFerryMetrics {
  length: number;
  height: number;
  headingRotation: number;
}

const PASSENGER_FERRY_MODEL_URL = "/models/passenger-ferry-optimized.glb";
const PASSENGER_FERRY_FALLBACK_MODEL_URL = "/models/Meshy_AI_Orange_Ferry_at_Sea_0226181516_texture.glb";
const DRACO_DECODER_PATH = "/draco/";
const PASSENGER_FERRY_TARGET_LENGTH = 21;
const PASSENGER_FERRY_BASE_Y = 1;
const PASSENGER_FERRY_SINK_RATIO = 0.36;
const PASSENGER_FERRY_MODEL_NAME = "ship-category-model";
const PASSENGER_FERRY_METRICS_KEY = "__passengerFerryMetrics";
const PASSENGER_FERRY_SHARED_ASSET_KEY = "sharedShipModelAsset";
const PASSENGER_FERRY_STYLED_MATERIAL_KEY = "__passengerFerryStyledMaterial";

const _hsl = { h: 0, s: 0, l: 0 };

function applyToonFerryMaterial(mesh: THREE.Mesh): void {
  const swap = (source: THREE.Material): THREE.MeshToonMaterial => {
    if ((source.userData as Record<string, unknown>)[PASSENGER_FERRY_STYLED_MATERIAL_KEY]) {
      return source as unknown as THREE.MeshToonMaterial;
    }

    const toon = convertToToonMaterial(source);

    // Orange-lane hue correction on the toon color
    toon.color.getHSL(_hsl);
    let h = _hsl.h;
    let s = _hsl.s;
    let l = _hsl.l;
    if ((h < 0.04 || h > 0.96) && s > 0.25) h = 0.085;
    else if (h >= 0.04 && h <= 0.2) h = THREE.MathUtils.lerp(h, 0.1, 0.65);
    s = Math.min(1, s * 1.18 + 0.06);
    l = Math.min(0.68, l * 1.12 + 0.05);
    toon.color.setHSL(h, s, l);
    toon.emissive.copy(toon.color);
    toon.emissiveIntensity = 0.15;
    toon.needsUpdate = true;

    toon.userData[PASSENGER_FERRY_STYLED_MATERIAL_KEY] = true;

    // Dispose old PBR material (textures are shared via convertToToon cache)
    if (source !== toon) source.dispose();

    return toon;
  };

  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map(swap);
  } else {
    mesh.material = swap(mesh.material);
  }
}

let passengerFerryLoadPromise: Promise<THREE.Object3D> | null = null;

function normalizePrototype(prototype: THREE.Object3D): PassengerFerryMetrics {
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

  const metrics: PassengerFerryMetrics = {
    length: planarLength,
    height: Math.max(size.y, 0.001),
    headingRotation,
  };
  prototype.userData[PASSENGER_FERRY_METRICS_KEY] = metrics;

  prototype.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = 6;
    child.userData[PASSENGER_FERRY_SHARED_ASSET_KEY] = true;

    applyToonFerryMaterial(child);
  });

  return metrics;
}

function getMetrics(prototype: THREE.Object3D): PassengerFerryMetrics {
  const stored = prototype.userData[PASSENGER_FERRY_METRICS_KEY] as Partial<PassengerFerryMetrics> | undefined;
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
          reject(new Error(`Passenger ferry model has no scene: ${url}`));
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

export function loadPassengerFerryPrototype(): Promise<THREE.Object3D> {
  if (passengerFerryLoadPromise) return passengerFerryLoadPromise;

  passengerFerryLoadPromise = (async () => {
    try {
      const optimizedPrototype = await loadModel(PASSENGER_FERRY_MODEL_URL, true);
      normalizePrototype(optimizedPrototype);
      return optimizedPrototype;
    } catch {
      const fallbackPrototype = await loadModel(PASSENGER_FERRY_FALLBACK_MODEL_URL, false);
      normalizePrototype(fallbackPrototype);
      return fallbackPrototype;
    }
  })().catch((error) => {
    passengerFerryLoadPromise = null;
    throw error;
  });

  return passengerFerryLoadPromise;
}

export function createPassengerFerryModelInstance(
  prototype: THREE.Object3D,
  sizeScale: number,
): THREE.Object3D {
  const metrics = getMetrics(prototype);
  const visualScale = Math.max(sizeScale, 0.22);
  const targetLength = PASSENGER_FERRY_TARGET_LENGTH * visualScale;
  const modelScale = targetLength / Math.max(metrics.length, 0.001);
  const modelHeight = metrics.height * modelScale;
  const sinkOffset = modelHeight * PASSENGER_FERRY_SINK_RATIO;

  const instance = prototype.clone(true);
  instance.name = PASSENGER_FERRY_MODEL_NAME;
  instance.renderOrder = 6;
  instance.scale.setScalar(modelScale);
  instance.rotation.y = metrics.headingRotation;
  instance.position.set(0, PASSENGER_FERRY_BASE_Y * visualScale - sinkOffset, 0);

  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.renderOrder = 6;
    child.userData[PASSENGER_FERRY_SHARED_ASSET_KEY] = true;
  });

  return instance;
}
