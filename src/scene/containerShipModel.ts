import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

interface ContainerShipMetrics {
  length: number;
  height: number;
  headingRotation: number;
}

const CONTAINER_SHIP_MODEL_URL = "/models/container-ship-optimized.glb";
const CONTAINER_SHIP_FALLBACK_MODEL_URL = "/models/Meshy_AI_Colorful_Container_Sh_0226194049_texture.glb";
const DRACO_DECODER_PATH = "/draco/";
const CONTAINER_SHIP_TARGET_LENGTH = 25;
const CONTAINER_SHIP_BASE_Y = 5.2;
const CONTAINER_SHIP_SINK_RATIO = 0.34;
const CONTAINER_SHIP_MODEL_NAME = "ship-category-model";
const CONTAINER_SHIP_METRICS_KEY = "__containerShipMetrics";
const CONTAINER_SHIP_SHARED_ASSET_KEY = "sharedShipModelAsset";
const CONTAINER_SHIP_STYLED_MATERIAL_KEY = "__containerShipStyledMaterial";

const _hsl = { h: 0, s: 0, l: 0 };

let containerShipLoadPromise: Promise<THREE.Object3D> | null = null;

function applyContainerShipLook(material: THREE.Material): void {
  const flagged = (material.userData as { __containerShipStyledMaterial?: boolean })[CONTAINER_SHIP_STYLED_MATERIAL_KEY];
  if (flagged) return;

  if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
    material.color.getHSL(_hsl);
    material.color.setHSL(
      _hsl.h,
      Math.min(1, _hsl.s * 1.2 + 0.05),
      Math.min(0.72, _hsl.l * 1.22 + 0.06),
    );
    material.metalness = Math.min(material.metalness, 0.08);
    material.roughness = Math.max(material.roughness, 0.58);
    material.emissive.copy(material.color).multiplyScalar(0.12);
    material.emissiveIntensity = 0.36;
    material.toneMapped = false;
    if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
    material.needsUpdate = true;
  }

  material.userData[CONTAINER_SHIP_STYLED_MATERIAL_KEY] = true;
}

function normalizePrototype(prototype: THREE.Object3D): ContainerShipMetrics {
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

  const metrics: ContainerShipMetrics = {
    length: planarLength,
    height: Math.max(size.y, 0.001),
    headingRotation,
  };
  prototype.userData[CONTAINER_SHIP_METRICS_KEY] = metrics;

  prototype.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = 6;
    child.userData[CONTAINER_SHIP_SHARED_ASSET_KEY] = true;
    if (Array.isArray(child.material)) {
      for (const material of child.material) applyContainerShipLook(material);
    } else {
      applyContainerShipLook(child.material);
    }
  });

  return metrics;
}

function getMetrics(prototype: THREE.Object3D): ContainerShipMetrics {
  const stored = prototype.userData[CONTAINER_SHIP_METRICS_KEY] as Partial<ContainerShipMetrics> | undefined;
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
          reject(new Error(`Container ship model has no scene: ${url}`));
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

export function loadContainerShipPrototype(): Promise<THREE.Object3D> {
  if (containerShipLoadPromise) return containerShipLoadPromise;

  containerShipLoadPromise = (async () => {
    try {
      const optimizedPrototype = await loadModel(CONTAINER_SHIP_MODEL_URL, true);
      normalizePrototype(optimizedPrototype);
      return optimizedPrototype;
    } catch {
      const fallbackPrototype = await loadModel(CONTAINER_SHIP_FALLBACK_MODEL_URL, false);
      normalizePrototype(fallbackPrototype);
      return fallbackPrototype;
    }
  })().catch((error) => {
    containerShipLoadPromise = null;
    throw error;
  });

  return containerShipLoadPromise;
}

export function createContainerShipModelInstance(
  prototype: THREE.Object3D,
  sizeScale: number,
): THREE.Object3D {
  const metrics = getMetrics(prototype);
  const visualScale = Math.max(sizeScale, 0.22);
  const targetLength = CONTAINER_SHIP_TARGET_LENGTH * visualScale;
  const modelScale = targetLength / Math.max(metrics.length, 0.001);
  const modelHeight = metrics.height * modelScale;
  const sinkOffset = modelHeight * CONTAINER_SHIP_SINK_RATIO;

  const instance = prototype.clone(true);
  instance.name = CONTAINER_SHIP_MODEL_NAME;
  instance.renderOrder = 6;
  instance.scale.setScalar(modelScale);
  instance.rotation.y = metrics.headingRotation;
  instance.position.set(0, CONTAINER_SHIP_BASE_Y * visualScale - sinkOffset, 0);

  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.renderOrder = 6;
    child.userData[CONTAINER_SHIP_SHARED_ASSET_KEY] = true;
  });

  return instance;
}
