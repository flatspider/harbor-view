import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

interface PassengerFerryMetrics {
  length: number;
  height: number;
  headingRotation: number;
}

const PASSENGER_FERRY_MODEL_URL = "/models/passenger-ferry-optimized.glb";
const DRACO_DECODER_PATH = "/draco/";
const PASSENGER_FERRY_TARGET_LENGTH = 14.5;
const PASSENGER_FERRY_BASE_Y = 5.2;
const PASSENGER_FERRY_SINK_RATIO = 0.36;
const PASSENGER_FERRY_MODEL_NAME = "ship-category-model";
const PASSENGER_FERRY_METRICS_KEY = "__passengerFerryMetrics";
const PASSENGER_FERRY_SHARED_ASSET_KEY = "sharedPassengerFerryAsset";

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

export function loadPassengerFerryPrototype(): Promise<THREE.Object3D> {
  if (passengerFerryLoadPromise) return passengerFerryLoadPromise;

  passengerFerryLoadPromise = new Promise((resolve, reject) => {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.load(
      PASSENGER_FERRY_MODEL_URL,
      (gltf) => {
        const prototype = gltf.scene;
        if (!prototype) {
          dracoLoader.dispose();
          passengerFerryLoadPromise = null;
          reject(new Error(`Passenger ferry model has no scene: ${PASSENGER_FERRY_MODEL_URL}`));
          return;
        }

        normalizePrototype(prototype);
        dracoLoader.dispose();
        resolve(prototype);
      },
      undefined,
      (error) => {
        dracoLoader.dispose();
        passengerFerryLoadPromise = null;
        reject(error);
      },
    );
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
