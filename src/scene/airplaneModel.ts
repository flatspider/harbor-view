import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { AircraftSizeClass } from "../types/aircraft";
import { convertToToonMaterial } from "./convertToToon";

interface AirplaneMetrics {
  length: number;
  headingRotation: number;
}

const AIRPLANE_MODEL_URL = "/models/airplane-optimized.glb";
const AIRPLANE_FALLBACK_MODEL_URL = "/models/Meshy_AI_Skybound_Ark_0226195620_texture.glb";
const DRACO_DECODER_PATH = "/draco/";
const AIRPLANE_MODEL_NAME = "aircraft-model";
const AIRPLANE_METRICS_KEY = "__airplaneMetrics";
const AIRPLANE_SHARED_ASSET_KEY = "sharedAircraftModelAsset";

const TARGET_LENGTH_BY_SIZE: Record<AircraftSizeClass, number> = {
  light: 9.5,
  medium: 14,
  heavy: 19,
};

let airplaneLoadPromise: Promise<THREE.Object3D> | null = null;

function normalizePrototype(prototype: THREE.Object3D): AirplaneMetrics {
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
  const metrics: AirplaneMetrics = {
    length: planarLength,
    headingRotation,
  };
  prototype.userData[AIRPLANE_METRICS_KEY] = metrics;

  prototype.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = 6;
    child.userData[AIRPLANE_SHARED_ASSET_KEY] = true;

    // Convert PBR materials to toon
    const swapMat = (source: THREE.Material): THREE.MeshToonMaterial => {
      const toon = convertToToonMaterial(source);
      if (source !== toon) source.dispose();
      return toon;
    };
    if (Array.isArray(child.material)) {
      child.material = child.material.map(swapMat);
    } else {
      child.material = swapMat(child.material);
    }
  });

  return metrics;
}

function getMetrics(prototype: THREE.Object3D): AirplaneMetrics {
  const stored = prototype.userData[AIRPLANE_METRICS_KEY] as Partial<AirplaneMetrics> | undefined;
  if (stored && typeof stored.length === "number" && typeof stored.headingRotation === "number") {
    return {
      length: stored.length,
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
          reject(new Error(`Airplane model has no scene: ${url}`));
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

export function loadAirplanePrototype(): Promise<THREE.Object3D> {
  if (airplaneLoadPromise) return airplaneLoadPromise;

  airplaneLoadPromise = (async () => {
    try {
      const optimizedPrototype = await loadModel(AIRPLANE_MODEL_URL, true);
      normalizePrototype(optimizedPrototype);
      return optimizedPrototype;
    } catch {
      const fallbackPrototype = await loadModel(AIRPLANE_FALLBACK_MODEL_URL, false);
      normalizePrototype(fallbackPrototype);
      return fallbackPrototype;
    }
  })().catch((error) => {
    airplaneLoadPromise = null;
    throw error;
  });

  return airplaneLoadPromise;
}

export function createAirplaneModelInstance(
  prototype: THREE.Object3D,
  sizeClass: AircraftSizeClass,
): THREE.Object3D {
  const metrics = getMetrics(prototype);
  const targetLength = TARGET_LENGTH_BY_SIZE[sizeClass];
  const modelScale = targetLength / Math.max(metrics.length, 0.001);

  const instance = prototype.clone(true);
  instance.name = AIRPLANE_MODEL_NAME;
  instance.renderOrder = 6;
  instance.scale.setScalar(modelScale);
  instance.rotation.y = metrics.headingRotation;

  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.renderOrder = 6;
    child.userData[AIRPLANE_SHARED_ASSET_KEY] = true;
  });

  return instance;
}
