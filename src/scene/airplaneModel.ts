import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { AircraftSizeClass } from "../types/aircraft";
import { convertToToonMaterial } from "./convertToToon";
import { captureBaseToonLook } from "./modelLook";

interface AirplaneMetrics {
  length: number;
  headingRotation: number;
}

export type AirplaneVariant = "glider" | "biplane" | "zeppelin";
export type AirplanePrototypeSet = Partial<Record<AirplaneVariant, THREE.Object3D>>;

const AIRPLANE_VARIANT_SOURCES: Record<AirplaneVariant, string[]> = {
  glider: [
    "/models/glider-optimized.glb",
    "/models/Meshy_AI_Blue_Winged_Sky_Racer_0227211314_texture.glb",
  ],
  biplane: [
    "/models/biplane-optimized.glb",
    "/models/Meshy_AI_Golden_Biplane_0227212937_texture.glb",
    "/models/Meshy_AI_Backyard_Aviator_0227203010_texture.glb",
  ],
  zeppelin: [
    "/models/zeppelin-optimized.glb",
    "/models/airplane-optimized.glb",
    "/models/Meshy_AI_Skybound_Ark_0226195620_texture.glb",
  ],
};
const DRACO_DECODER_PATH = "/draco/";
const AIRPLANE_MODEL_NAME = "aircraft-model";
const AIRPLANE_METRICS_KEY = "__airplaneMetrics";
const AIRPLANE_SHARED_ASSET_KEY = "sharedAircraftModelAsset";

const TARGET_LENGTH_BY_SIZE: Record<AircraftSizeClass, number> = {
  light: 9.5,
  medium: 14,
  heavy: 19,
};

let airplaneLoadPromise: Promise<AirplanePrototypeSet> | null = null;

function enforceOpaqueMaterial(material: THREE.Material): THREE.Material {
  material.transparent = false;
  material.opacity = 1;
  material.depthWrite = true;
  material.depthTest = true;
  material.alphaTest = 0;
  material.side = THREE.FrontSide;
  material.needsUpdate = true;
  return material;
}

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
      captureBaseToonLook(toon);
      if (source !== toon) source.dispose();
      return toon;
    };
    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => enforceOpaqueMaterial(swapMat(material)));
    } else {
      child.material = enforceOpaqueMaterial(swapMat(child.material));
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

async function loadFirstAvailableModel(urls: string[]): Promise<THREE.Object3D> {
  let lastError: unknown = null;
  for (const url of urls) {
    const prefersDraco = url.endsWith("-optimized.glb");
    try {
      return await loadModel(url, prefersDraco);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No airplane model URL could be loaded");
}

export function loadAirplanePrototypes(): Promise<AirplanePrototypeSet> {
  if (airplaneLoadPromise) return airplaneLoadPromise;

  airplaneLoadPromise = (async () => {
    const entries = await Promise.allSettled(
      (Object.keys(AIRPLANE_VARIANT_SOURCES) as AirplaneVariant[]).map(async (variant) => {
        const prototype = await loadFirstAvailableModel(AIRPLANE_VARIANT_SOURCES[variant]);
        normalizePrototype(prototype);
        return [variant, prototype] as const;
      }),
    );

    const loaded = Object.fromEntries(
      entries
        .filter(
          (entry): entry is PromiseFulfilledResult<readonly [AirplaneVariant, THREE.Object3D]> =>
            entry.status === "fulfilled",
        )
        .map((entry) => entry.value),
    ) as AirplanePrototypeSet;

    if (!loaded.glider && !loaded.biplane && !loaded.zeppelin) {
      throw new Error("Failed to load any aircraft model variants");
    }

    return loaded;
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
